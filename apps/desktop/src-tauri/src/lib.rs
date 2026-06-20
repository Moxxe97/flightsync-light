use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::time::{Duration, Instant};
use tauri::Manager;

/// Starts a local TCP listener. Returns the port number.
///
/// Flow (OAuth authorization-code):
///   One connection — Google's code-flow redirect arrives here
///                    (GET /?code=…&state=… in the URL query string,
///                    readable directly by Rust). We parse the query,
///                    serve a final "you may return to the app" page, and
///                    call window.__flightSyncOAuthCb({code,state}) on the
///                    main WebviewWindow via eval(). The JS side exchanges
///                    the code for tokens itself (PKCE).
///
///   No fragment-bounce HTML and no second connection are needed anymore:
///   the code/state live in the query, not the URL fragment, so a single
///   request carries everything.
// Fixed port — must match an entry in the OAuth client's
// "Authorized redirect URIs". Google's Web client type doesn't
// allow arbitrary ports, only exact URI matches.
const OAUTH_PORT: u16 = 8765;

// Give up waiting for a connection after this long. Matches the JS-side 5-minute
// OAuth timeout so a cancelled sign-in (the redirect never arrives) doesn't leave
// the accept() blocked forever holding port 8765 — which would make the next
// sign-in attempt fail to bind until the app is restarted.
const ACCEPT_TIMEOUT: Duration = Duration::from_secs(5 * 60);

// Cap how much of an incoming request we read. Our HTTP request line is well
// under this; the bound stops a local process from streaming unbounded data
// into memory (audit R2).
const MAX_REQUEST_BYTES: u64 = 8 * 1024;

// Per-connection read timeout so one silent connection can't wedge the listener
// thread (and hold port 8765) until the app restarts (audit R3).
const READ_TIMEOUT: Duration = Duration::from_secs(10);

/// Code (or error) extracted from the loopback redirect query string.
#[derive(Default)]
struct CallbackResult {
    code: String,
    state: String,
    error: String,
}

/// Extract the request target (path + optional query) from an HTTP request
/// line like `GET /cb?access_token=… HTTP/1.1`. Returns `None` if the line is
/// malformed (missing method/target).
fn request_target(request_line: &str) -> Option<&str> {
    request_line.split_whitespace().nth(1)
}

/// The code-flow redirect lands on `/?code=…&state=…` (redirect_uri is the
/// bare loopback origin). Anything else — bare `/`, old `/cb`, favicon — is a
/// stray request.
fn is_callback_path(target: &str) -> bool {
    matches!(target.split_once('?'), Some(("/", q)) if !q.is_empty())
}

/// Parse the redirect query string into a code/state (or error). Uses the same
/// minimal percent-decode as before (the auth code is percent-encoded by
/// Google — `4/0A…` arrives as `4%2F0A…`).
fn parse_callback_query(query: &str) -> CallbackResult {
    let mut result = CallbackResult::default();
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            let decoded = v
                .replace("%2B", "+")
                .replace("%2F", "/")
                .replace("%3D", "=")
                .replace("%20", " ");
            match k {
                "code" => result.code = decoded,
                "state" => result.state = decoded,
                "error" => result.error = decoded,
                _ => {}
            }
        }
    }
    result
}

/// Read just the request line from a stream, bounded in both bytes (R2) and
/// time (R3). Returns the raw request line (may retain trailing CRLF).
fn read_request_line(stream: &TcpStream) -> String {
    let _ = stream.set_read_timeout(Some(READ_TIMEOUT));
    let mut request_line = String::new();
    let mut reader = BufReader::new(stream.take(MAX_REQUEST_BYTES));
    let _ = reader.read_line(&mut request_line);
    request_line
}

/// Best-effort: half-close the write side after responding so the peer can read
/// our response before the socket is fully dropped, rather than being RST'd
/// mid-read (audit R8).
fn finish_response(stream: &TcpStream) {
    let _ = stream.shutdown(Shutdown::Write);
}

// Accept a single connection, returning Err(TimedOut) once `deadline` passes
// instead of blocking indefinitely. A single deadline is shared across every
// accept in the loop so the listener never holds port 8765 longer than
// ACCEPT_TIMEOUT in total — including the cancelled / stray-path cases
// (audit R5/R6). On timeout the caller drops the listener, freeing the port.
fn accept_until(
    listener: &TcpListener,
    deadline: Instant,
) -> std::io::Result<(TcpStream, std::net::SocketAddr)> {
    listener.set_nonblocking(true)?;
    let result = loop {
        match listener.accept() {
            Ok(pair) => break Ok(pair),
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    break Err(std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "accept timed out",
                    ));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => break Err(e),
        }
    };
    // Restore blocking mode for the returned stream so the existing read/write code works.
    let _ = listener.set_nonblocking(false);
    if let Ok((ref s, _)) = result {
        let _ = s.set_nonblocking(false);
    }
    result
}

#[tauri::command]
fn start_oauth_listener(app: tauri::AppHandle) -> Result<u16, String> {
    let listener = TcpListener::bind(format!("127.0.0.1:{}", OAUTH_PORT))
        .map_err(|e| format!("Could not bind 127.0.0.1:{} ({}). Close any other app using this port and try again.", OAUTH_PORT, e))?;
    // The bind above always targets OAUTH_PORT, so the bound port is exactly
    // that — no need to query the socket (which forced an unwrap; audit R1).
    let port = OAUTH_PORT;

    std::thread::spawn(move || {
        // Single overall deadline shared across every accept in the loop so the
        // listener never holds port 8765 longer than ACCEPT_TIMEOUT in total —
        // including the cancelled / stray-path cases (R5/R6).
        let deadline = Instant::now() + ACCEPT_TIMEOUT;

        // ── Single connection: Google's code-flow redirect ────────
        // The code/state live in the query string, so one request carries
        // everything — no fragment-bounce HTML, no second connection.
        // Stray connections (anything that isn't the `/?code=…` callback) get a
        // 404 and we keep waiting within the SAME deadline, so a probe can't
        // consume the handshake slot (audit R4). Bounded by the shared deadline
        // (R5/R6).
        loop {
            let (mut stream, _) = match accept_until(&listener, deadline) {
                Ok(pair) => pair,
                Err(_) => return, // deadline reached (or cancelled): release port
            };

            let request_line = read_request_line(&stream);
            let target = request_target(&request_line).unwrap_or("");

            if !is_callback_path(target) {
                // Not the redirect — 404 and keep waiting for the real one.
                let _ = stream.write_all(
                    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                );
                finish_response(&stream);
                drop(stream);
                continue;
            }

            // Parse query: /?code=…&state=…  or  /?error=…
            let query = target
                .split_once('?')
                .map(|(_, q)| q)
                .unwrap_or_default();
            let result = parse_callback_query(query);

            // Serve a final page so the auth window shows a friendly message
            // instead of a blank 200 with no body.
            let html = "<!DOCTYPE html><html><body style='font-family:sans-serif;\
                text-align:center;padding:60px;background:#0a0f1e;color:#e2e8f0'>\
                <h2>\u{2713} Connect\u{00e9} \u{2014} retournez dans FlightSync Light.</h2>\
                </body></html>";
            let resp = format!(
                "HTTP/1.1 200 OK\r\n\
                 Content-Type: text/html; charset=utf-8\r\n\
                 Content-Length: {}\r\n\
                 Connection: close\r\n\r\n{}",
                html.len(),
                html
            );
            let _ = stream.write_all(resp.as_bytes());
            finish_response(&stream);
            drop(stream);

            let payload = if !result.error.is_empty() {
                serde_json::json!({ "error": result.error })
            } else {
                serde_json::json!({ "code": result.code, "state": result.state })
            };

            let payload_str = serde_json::to_string(&payload)
                .unwrap_or_else(|_| "{}".to_string());
            // Tauri WebView eval (not JS eval-of-untrusted-data): this injects a
            // call to the page's own __flightSyncOAuthCb handler. The payload is
            // serde_json-serialized, so it's structurally safe to interpolate.
            let js = format!(
                "if(typeof window.__flightSyncOAuthCb==='function')\
                 window.__flightSyncOAuthCb({});",
                payload_str
            );

            // Surface delivery failures so a hung sign-in is diagnosable (R7).
            match app.get_webview_window("main") {
                Some(win) => {
                    if let Err(e) = win.eval(&js) {
                        log::error!("OAuth callback eval failed on main window: {}", e);
                    }
                }
                None => {
                    log::error!(
                        "OAuth callback could not be delivered: main webview window not found"
                    );
                }
            }

            // Close the dedicated auth window now that the code is captured.
            if let Some(auth) = app.get_webview_window("google-auth") {
                let _ = auth.close();
            }

            return;
        }
    });

    Ok(port)
}

/// open_google_auth_window takes a caller-supplied URL from JS. Only Google's
/// OAuth page is ever legitimate (audit #25).
fn is_allowed_auth_url(auth_url: &str) -> bool {
    match auth_url.parse::<url::Url>() {
        Ok(u) => u.scheme() == "https" && u.host_str() == Some("accounts.google.com"),
        Err(_) => false,
    }
}

/// Open Google OAuth (authorization-code flow) in a dedicated WebviewWindow.
/// The redirect back to 127.0.0.1 is handled by start_oauth_listener. This is a
/// Mac-only app, so there is no mobile/system-browser variant.
#[tauri::command]
fn open_google_auth_window(app: tauri::AppHandle, auth_url: String) -> Result<(), String> {
    if !is_allowed_auth_url(&auth_url) {
        return Err("auth_url refusée: seul https://accounts.google.com est autorisé".into());
    }

    // Close any leftover auth window
    if let Some(existing) = app.get_webview_window("google-auth") {
        let _ = existing.close();
    }

    let url: url::Url = auth_url.parse().map_err(|e: url::ParseError| e.to_string())?;

    tauri::WebviewWindowBuilder::new(
        &app,
        "google-auth",
        tauri::WebviewUrl::External(url),
    )
    .title("Connexion Google")
    .inner_size(480.0, 640.0)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

const KEYCHAIN_SERVICE: &str = "com.flightsynclight.app";
const KEYCHAIN_USER: &str = "google-refresh-token";

#[tauri::command]
fn save_refresh_token(token: String) -> Result<(), String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER)
        .and_then(|e| e.set_password(&token))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn load_refresh_token() -> Result<Option<String>, String> {
    match keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER)
        .and_then(|e| e.get_password())
    {
        Ok(t) => Ok(Some(t)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn delete_refresh_token() -> Result<(), String> {
    match keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER)
        .and_then(|e| e.delete_credential())
    {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            start_oauth_listener,
            open_google_auth_window,
            save_refresh_token,
            load_refresh_token,
            delete_refresh_token
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        is_allowed_auth_url, is_callback_path, parse_callback_query, request_target,
    };

    #[test]
    fn request_target_extracts_path() {
        assert_eq!(
            request_target("GET /cb?access_token=abc HTTP/1.1"),
            Some("/cb?access_token=abc")
        );
        assert_eq!(request_target("GET / HTTP/1.1"), Some("/"));
    }

    #[test]
    fn request_target_handles_missing_parts_and_garbage() {
        assert_eq!(request_target(""), None);
        assert_eq!(request_target("GET"), None);
        assert_eq!(request_target("\r\n"), None);
        // Garbage with at least two tokens still yields the second token.
        assert_eq!(request_target("garbage here too"), Some("here"));
    }

    #[test]
    fn parse_callback_query_code_and_state() {
        let r = parse_callback_query("code=4%2F0Axyz&state=abc123&scope=email");
        assert_eq!(r.code, "4/0Axyz");
        assert_eq!(r.state, "abc123");
        assert!(r.error.is_empty());
    }

    #[test]
    fn parse_callback_query_error_param() {
        let r = parse_callback_query("error=access_denied");
        assert!(r.code.is_empty());
        assert_eq!(r.error, "access_denied");
    }

    #[test]
    fn is_callback_path_matches_root_with_query_only() {
        assert!(is_callback_path("/?code=x"));
        assert!(is_callback_path("/?error=x"));
        assert!(!is_callback_path("/"));          // no query → not a callback
        assert!(!is_callback_path("/cb?code=x")); // old path retired
        assert!(!is_callback_path("/favicon.ico"));
    }

    #[test]
    fn accepts_google_accounts_https() {
        assert!(is_allowed_auth_url(
            "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=http://127.0.0.1:8765"
        ));
    }

    #[test]
    fn rejects_other_hosts_schemes_and_garbage() {
        assert!(!is_allowed_auth_url("https://evil.example.com/phish"));
        assert!(!is_allowed_auth_url("http://accounts.google.com/"));
        assert!(!is_allowed_auth_url("file:///etc/passwd"));
        assert!(!is_allowed_auth_url("javascript:alert(1)"));
        assert!(!is_allowed_auth_url("not a url"));
        assert!(!is_allowed_auth_url("https://accounts.google.com.evil.com/"));
    }

    #[test]
    fn parse_callback_query_empty_and_malformed() {
        // Empty string → all fields empty, no panic.
        let r = parse_callback_query("");
        assert!(r.code.is_empty());
        assert!(r.state.is_empty());
        assert!(r.error.is_empty());

        // Pairs without '=' or with empty keys are skipped; known keys still empty.
        // "garbage" → no '=', skipped.
        // "=" → key is "", skipped (no match arm).
        // "dangling" → no '=', skipped.
        // "code" → no '=', skipped (so code stays empty).
        let r = parse_callback_query("garbage&=novalue&dangling&code");
        assert!(r.code.is_empty());
        assert!(r.state.is_empty());
        assert!(r.error.is_empty());
    }

    #[test]
    fn parse_callback_query_percent_decodes() {
        // Exercises all four substitutions the decoder applies:
        //   %2B → +   %2F → /   %3D → =   %20 → (space)
        let r = parse_callback_query("code=a%2Bb%2Fc%3Dd%20e&state=s");
        assert_eq!(r.code, "a+b/c=d e");
        assert_eq!(r.state, "s");
        assert!(r.error.is_empty());
    }
}
