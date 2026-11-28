#[cfg(desktop)]
use std::io::{BufRead, BufReader, Read, Write};
#[cfg(desktop)]
use std::net::{Shutdown, TcpListener, TcpStream};
#[cfg(desktop)]
use std::time::{Duration, Instant};
use std::path::{Component, Path};
use tauri::Manager;
use tauri_plugin_fs::FsExt;

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
#[cfg(desktop)]
const OAUTH_PORT: u16 = 8765;

// Give up waiting for a connection after this long. Matches the JS-side 5-minute
// OAuth timeout so a cancelled sign-in (the redirect never arrives) doesn't leave
// the accept() blocked forever holding port 8765 — which would make the next
// sign-in attempt fail to bind until the app is restarted.
#[cfg(desktop)]
const ACCEPT_TIMEOUT: Duration = Duration::from_secs(5 * 60);

// Cap how much of an incoming request we read. Our HTTP request line is well
// under this; the bound stops a local process from streaming unbounded data
// into memory (audit R2).
#[cfg(desktop)]
const MAX_REQUEST_BYTES: u64 = 8 * 1024;

// Per-connection read timeout so one silent connection can't wedge the listener
// thread (and hold port 8765) until the app restarts (audit R3).
#[cfg(desktop)]
const READ_TIMEOUT: Duration = Duration::from_secs(10);

/// Code (or error) extracted from the loopback redirect query string.
#[cfg(desktop)]
#[derive(Default)]
struct CallbackResult {
    code: String,
    state: String,
    error: String,
}

/// Extract the request target (path + optional query) from an HTTP request
/// line like `GET /cb?access_token=… HTTP/1.1`. Returns `None` if the line is
/// malformed (missing method/target).
#[cfg(desktop)]
fn request_target(request_line: &str) -> Option<&str> {
    request_line.split_whitespace().nth(1)
}

/// The code-flow redirect lands on `/?code=…&state=…` (redirect_uri is the
/// bare loopback origin). Anything else — bare `/`, old `/cb`, favicon — is a
/// stray request.
#[cfg(desktop)]
fn is_callback_path(target: &str) -> bool {
    matches!(target.split_once('?'), Some(("/", q)) if !q.is_empty())
}

/// Parse the redirect query string into a code/state (or error). Uses the same
/// minimal percent-decode as before (the auth code is percent-encoded by
/// Google — `4/0A…` arrives as `4%2F0A…`).
#[cfg(desktop)]
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

/// A real Google redirect carries either an authorization `code` or an
/// `error`. A request that matches the callback path but has neither (a local
/// probe like `/?x=1`) must NOT consume the one-shot handshake slot (audit
/// M5).
#[cfg(desktop)]
fn is_terminal_callback(result: &CallbackResult) -> bool {
    !result.code.is_empty() || !result.error.is_empty()
}

/// Read just the request line from a stream, bounded in both bytes (R2) and
/// time (R3). Returns the raw request line (may retain trailing CRLF).
#[cfg(desktop)]
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
#[cfg(desktop)]
fn finish_response(stream: &TcpStream) {
    let _ = stream.shutdown(Shutdown::Write);
}

// Accept a single connection, returning Err(TimedOut) once `deadline` passes
// instead of blocking indefinitely. A single deadline is shared across every
// accept in the loop so the listener never holds port 8765 longer than
// ACCEPT_TIMEOUT in total — including the cancelled / stray-path cases
// (audit R5/R6). On timeout the caller drops the listener, freeing the port.
#[cfg(desktop)]
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

#[cfg(desktop)]
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

            if !is_terminal_callback(&result) {
                // Not the real redirect (no code/error) — 404 and keep waiting so a
                // local probe can't consume the handshake slot (audit M5).
                let _ = stream.write_all(
                    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                );
                finish_response(&stream);
                drop(stream);
                continue;
            }

            // Serve a final page so the auth window shows a friendly message
            // instead of a blank 200 with no body.
            let html = "<!DOCTYPE html><html><body style='font-family:sans-serif;\
                text-align:center;padding:60px;background:#0a0f1e;color:#e2e8f0'>\
                <h2>\u{2713} Signed in \u{2014} return to FlightSync Light.</h2>\
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
#[cfg(desktop)]
fn is_allowed_auth_url(auth_url: &str) -> bool {
    match auth_url.parse::<url::Url>() {
        Ok(u) => u.scheme() == "https" && u.host_str() == Some("accounts.google.com"),
        Err(_) => false,
    }
}

/// Open Google OAuth (authorization-code flow) in a dedicated WebviewWindow.
/// The redirect back to 127.0.0.1 is handled by start_oauth_listener. This is a
/// Mac-only app, so there is no mobile/system-browser variant.
#[cfg(desktop)]
#[tauri::command]
fn open_google_auth_window(app: tauri::AppHandle, auth_url: String) -> Result<(), String> {
    if !is_allowed_auth_url(&auth_url) {
        return Err("auth_url rejected: only https://accounts.google.com is allowed".into());
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

#[cfg(not(target_os = "android"))]
const KEYCHAIN_SERVICE: &str = "com.flightsynclight.app";
#[cfg(not(target_os = "android"))]
const KEYCHAIN_USER: &str = "google-refresh-token";

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn save_refresh_token(token: String) -> Result<(), String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER)
        .and_then(|e| e.set_password(&token))
        .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
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

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn delete_refresh_token() -> Result<(), String> {
    match keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER)
        .and_then(|e| e.delete_credential())
    {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// Android has no keyring backend; refresh tokens are stored via the
// KeystorePlugin, a small Kotlin plugin backed by the Android Keystore
// (AES256 master key, EncryptedSharedPreferences) — see the
// android_keystore module below and gen/android/.../KeystorePlugin.kt.
#[cfg(target_os = "android")]
mod android_keystore {
    use serde::Deserialize;
    use tauri::{
        plugin::{Builder, PluginHandle, TauriPlugin},
        Manager, Runtime,
    };

    #[derive(Deserialize)]
    pub struct LoadResponse {
        pub token: Option<String>,
    }

    pub struct Keystore<R: Runtime>(pub PluginHandle<R>);

    pub fn init<R: Runtime>() -> TauriPlugin<R> {
        Builder::new("fslkeystore")
            .setup(|app, api| {
                let handle = api.register_android_plugin("com.flightsynclight.app", "KeystorePlugin")?;
                app.manage(Keystore(handle));
                Ok(())
            })
            .build()
    }
}

// Android has no working blob+<a download> path in the WebView, so exports
// (CSV / ICS / JSON) are written into the public MediaStore Downloads
// collection by the Kotlin DownloadsPlugin — same bridge pattern as
// KeystorePlugin above. iOS doesn't need this: exports go to the app
// Documents dir via plugin-fs (Files-app visible through UIFileSharingEnabled).
#[cfg(target_os = "android")]
mod android_downloads {
    use serde::Deserialize;
    use tauri::{
        plugin::{Builder, PluginHandle, TauriPlugin},
        Manager, Runtime,
    };

    #[derive(Deserialize)]
    pub struct SaveFileResponse {
        pub path: String,
    }

    pub struct Downloads<R: Runtime>(pub PluginHandle<R>);

    pub fn init<R: Runtime>() -> TauriPlugin<R> {
        Builder::new("fsldownloads")
            .setup(|app, api| {
                let handle = api.register_android_plugin("com.flightsynclight.app", "DownloadsPlugin")?;
                app.manage(Downloads(handle));
                Ok(())
            })
            .build()
    }
}

/// Save an export file. Android-only: routes to the Kotlin DownloadsPlugin
/// (public Downloads via MediaStore) and returns the user-visible path.
/// Desktop uses the browser download and iOS the plugin-fs Documents path.
#[tauri::command]
fn save_export_file(
    app: tauri::AppHandle,
    file_name: String,
    mime: String,
    contents: Option<String>,
    contents_b64: Option<String>,
) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        return app
            .state::<android_downloads::Downloads<tauri::Wry>>()
            .0
            .run_mobile_plugin::<android_downloads::SaveFileResponse>(
                "saveFile",
                serde_json::json!({
                    "fileName": file_name,
                    "mime": mime,
                    "contents": contents,
                    "contentsB64": contents_b64,
                }),
            )
            .map(|r| r.path)
            .map_err(|e| e.to_string());
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, file_name, mime, contents, contents_b64);
        Err("save_export_file is Android-only".into())
    }
}

#[cfg(target_os = "android")]
#[tauri::command]
fn save_refresh_token(app: tauri::AppHandle, token: String) -> Result<(), String> {
    app.state::<android_keystore::Keystore<tauri::Wry>>()
        .0
        .run_mobile_plugin::<serde_json::Value>("save", serde_json::json!({ "token": token }))
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
#[tauri::command]
fn load_refresh_token(app: tauri::AppHandle) -> Result<Option<String>, String> {
    app.state::<android_keystore::Keystore<tauri::Wry>>()
        .0
        .run_mobile_plugin::<android_keystore::LoadResponse>("load", serde_json::json!({}))
        .map(|r| r.token)
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
#[tauri::command]
fn delete_refresh_token(app: tauri::AppHandle) -> Result<(), String> {
    app.state::<android_keystore::Keystore<tauri::Wry>>()
        .0
        .run_mobile_plugin::<serde_json::Value>("delete", serde_json::json!({}))
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Lets JS branch its OAuth flow without pulling in the os plugin.
#[tauri::command]
fn platform_name() -> String {
    if cfg!(target_os = "android") {
        "android".into()
    } else if cfg!(target_os = "ios") {
        "ios".into()
    } else {
        "desktop".into()
    }
}

// ─── Backup folder (review of 2026-11-26) ────────────────────────────
// The fs capability grants no static `fs:scope-*` (audit H1), so the folder
// the pilot picked must be re-granted to the fs plugin's runtime scope on
// every launch. That grant used to accept ANY path the page sent, so a
// compromised page could open read/write access to e.g. ~/Library/LaunchAgents.
// Now the folder is picked here, in Rust, and remembered in the app config
// dir (which no fs scope covers, so the page cannot rewrite the record);
// `allow_backup_folder` only re-grants that recorded folder. On mobile the
// backup lives inside the app's Documents dir, already in the static scope.

const BACKUP_FOLDER_RECORD: &str = "backup-folder.txt";
const BACKUP_FOLDER_NOT_CONFIRMED: &str = "BACKUP_FOLDER_NOT_CONFIRMED";

/// True when `requested` is exactly the folder recorded at pick time, or lies
/// inside `inside` (mobile: the app's Documents dir). Absolute paths only, no
/// `..` steps (component-wise, so `/a/b2` is not inside `/a/b`).
fn backup_folder_allowed(requested: &str, recorded: Option<&str>, inside: Option<&Path>) -> bool {
    let req = Path::new(requested);
    if requested.trim().is_empty()
        || !req.is_absolute()
        || req.components().any(|c| matches!(c, Component::ParentDir))
    {
        return false;
    }
    let norm = |s: &str| s.trim_end_matches('/').to_string();
    if recorded.is_some_and(|r| norm(r) == norm(requested)) {
        return true;
    }
    inside.is_some_and(|base| req.starts_with(base))
}

fn backup_folder_record_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join(BACKUP_FOLDER_RECORD))
}

fn recorded_backup_folder(app: &tauri::AppHandle) -> Option<String> {
    let text = std::fs::read_to_string(backup_folder_record_path(app)?).ok()?;
    let path = text.trim();
    (!path.is_empty()).then(|| path.to_string())
}

/// Shows the native folder picker, remembers the chosen folder and grants the
/// fs scope access to it (recursively: `ofps/`, `boarding-passes/`). Returns
/// the folder, or None when the pilot cancels.
#[cfg(desktop)]
#[tauri::command]
async fn pick_backup_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    // Off the main thread (async command), as blocking_pick_folder requires.
    let mut dialog = app.dialog().file().set_title("Choose the backup folder");
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    let Some(picked) = dialog.blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let folder = path.to_string_lossy().into_owned();
    let record = backup_folder_record_path(&app).ok_or("no app config folder")?;
    if let Some(dir) = record.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&record, &folder).map_err(|e| e.to_string())?;
    app.fs_scope()
        .allow_directory(&path, true)
        .map_err(|e| e.to_string())?;
    Ok(Some(folder))
}

/// Re-grants the fs scope for the backup folder before a folder backup or
/// restore. Refuses any folder other than the one picked in the native dialog
/// (an older version's folder included: the pilot picks it once more).
#[tauri::command]
fn allow_backup_folder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let recorded = recorded_backup_folder(&app);
    #[cfg(mobile)]
    let inside = app.path().document_dir().ok();
    #[cfg(desktop)]
    let inside: Option<std::path::PathBuf> = None;
    if !backup_folder_allowed(&path, recorded.as_deref(), inside.as_deref()) {
        return Err(format!("{BACKUP_FOLDER_NOT_CONFIRMED}: choose the backup folder again"));
    }
    app.fs_scope()
        .allow_directory(&path, true)
        .map_err(|e| e.to_string())
}

/// Folder backup turned off, or "Delete ALL data": forget the recorded folder.
#[tauri::command]
fn forget_backup_folder(app: tauri::AppHandle) -> Result<(), String> {
    let Some(record) = backup_folder_record_path(&app) else {
        return Ok(());
    };
    match std::fs::remove_file(record) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    #[cfg(mobile)]
    let builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(target_os = "android")]
    let builder = builder
        .plugin(android_keystore::init())
        .plugin(android_downloads::init());

    #[cfg(desktop)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        start_oauth_listener,
        open_google_auth_window,
        save_refresh_token,
        save_export_file,
        load_refresh_token,
        delete_refresh_token,
        allow_backup_folder,
        pick_backup_folder,
        forget_backup_folder,
        platform_name
    ]);

    #[cfg(mobile)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        save_refresh_token,
        save_export_file,
        load_refresh_token,
        delete_refresh_token,
        allow_backup_folder,
        forget_backup_folder,
        platform_name
    ]);

    builder
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

#[cfg(all(test, desktop))]
mod tests {
    use super::{
        is_allowed_auth_url, is_callback_path, is_terminal_callback, parse_callback_query,
        request_target,
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

    #[test]
    fn is_terminal_callback_true_for_code_or_error() {
        let with_code = parse_callback_query("code=abc&state=s");
        assert!(is_terminal_callback(&with_code));

        let with_error = parse_callback_query("error=access_denied");
        assert!(is_terminal_callback(&with_error));
    }

    #[test]
    fn is_terminal_callback_false_for_probe_and_empty_query() {
        // A probe like `/?x=1` passes is_callback_path (non-empty query on `/`)
        // but carries neither code nor error — must not be treated as terminal.
        let probe = parse_callback_query("x=1");
        assert!(!is_terminal_callback(&probe));

        let empty = parse_callback_query("");
        assert!(!is_terminal_callback(&empty));
    }
}

#[cfg(test)]
mod backup_folder_tests {
    use super::backup_folder_allowed;
    use std::path::Path;

    #[test]
    fn allows_only_the_recorded_folder() {
        let rec = Some("/Users/x/Backups");
        assert!(backup_folder_allowed("/Users/x/Backups", rec, None));
        assert!(backup_folder_allowed("/Users/x/Backups/", rec, None));
        assert!(!backup_folder_allowed("/Users/x", rec, None));
        assert!(!backup_folder_allowed("/Users/x/Library/LaunchAgents", rec, None));
        assert!(!backup_folder_allowed("/Users/x/Backups2", rec, None));
    }

    #[test]
    fn refuses_everything_when_nothing_was_picked() {
        assert!(!backup_folder_allowed("/Users/x/Backups", None, None));
    }

    #[test]
    fn refuses_relative_paths_and_parent_steps() {
        let rec = Some("/Users/x/Backups/../Library");
        assert!(!backup_folder_allowed("/Users/x/Backups/../Library", rec, None));
        assert!(!backup_folder_allowed("Backups", Some("Backups"), None));
        assert!(!backup_folder_allowed("", Some(""), None));
    }

    #[test]
    fn allows_folders_inside_the_mobile_documents_dir() {
        let docs = Some(Path::new("/var/mobile/Containers/Data/Application/ABC/Documents"));
        assert!(backup_folder_allowed("/var/mobile/Containers/Data/Application/ABC/Documents/FlightSync Light Backups", None, docs));
        assert!(!backup_folder_allowed("/var/mobile/Containers/Data/Application/ABC/Documents2/x", None, docs));
        assert!(!backup_folder_allowed("/var/mobile/Containers/Data/Application/ABC/Documents/../Library", None, docs));
        assert!(!backup_folder_allowed("/etc", None, docs));
    }
}
