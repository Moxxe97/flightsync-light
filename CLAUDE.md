# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

pnpm workspace (`pnpm-workspace.yaml`):
- `apps/desktop/` — Tauri 2 + React 19 + Vite 8 macOS app (`flight-sync-light-desktop`). Includes its own `src-tauri/` Rust crate.
- `packages/core/` — `@flightsync/core`. Platform-agnostic logic (geo, parsing, tax, idb, util). Subpath exports declared in `package.json#exports`; consumers import e.g. `@flightsync/core/tax`, `@flightsync/core/parsing`, `@flightsync/core/idb`. Has `pdfjs-dist` as a peer dep — the consuming app supplies it. **No Firebase, no Firestore, no sync queue.**

## Commands

From repo root:
- `pnpm install` — peer-dependency warnings (tailwindcss v4 / vite v8) are expected and harmless; pnpm 9 has no `--legacy-peer-deps` flag (that's npm).
- `pnpm dev` — runs `vite` in `apps/desktop`.
- `pnpm build:desktop` — vite build.
- `pnpm tauri:build` — full Tauri bundle (host architecture only).
- Distribution/release builds must be **universal**: `pnpm --filter flight-sync-light-desktop exec tauri build --target universal-apple-darwin` (one-time prereq: `rustup target add x86_64-apple-darwin`); bundle lands in `apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle/`. aarch64-only builds bounce silently on Intel Macs (root-caused 2026-07-12).
- `pnpm test` — recursive vitest across all workspaces.

From `apps/desktop/`:
- `npm run test` / `npm run test:watch` — vitest (jsdom) for `src/**/*.test.{js,jsx}`.
- `npm run lint` — eslint.
- Run a single test: `npx vitest run src/path/to/file.test.js` (or `-t "name pattern"`).
- There is **no** `test:rules` command — no Firebase emulator, no Firestore rules.

From `packages/core/`:
- `npm run test` / `npm run test:watch`.

## Architecture

**Frontend shell (`apps/desktop/src/App.jsx`).** Single component holding flights + residence state. `localStorage` is the source of truth for flight/residence data; **there is no sync mirror**. Tabs under `src/components/tabs/` are pure views:
- `DashboardTab` — hours totals, Canadian proportion, fiscal year stats
- `CalendarTab` — monthly view, ICS export
- `BackupTab` — Drive backup/restore controls, sign-in/out
- `DataTab` — OFP PDF import, flight management, boarding passes
- `ArchiveTab` — read-only archived years, Drive archive per year
- `HistoryTab` — backup operation log

**Data stores — local only.** `localStorage` keys: `ac-flights-data`, `ac-residence-data`, `ac-sync-settings`, `ac-sync-log`, `ac-device-id`. IndexedDB (via `@flightsync/core/idb`) stores OFP PDFs and boarding passes under `~/Library/WebKit/com.flightsynclight.app/`. No Firestore, no remote sync.

**PDF parsing adapter pattern.** `@flightsync/core/parsing` doesn't import `pdfjs-dist` directly. `apps/desktop/src/main.jsx` registers a **lazy async adapter** (via the `@flightsync/core/parsing/pdf-text` subpath — NOT the parsing barrel) that dynamically imports `apps/desktop/adapters/pdf-text-webkit.js` on first PDF use; this keeps pdfjs/luxon/tz-lookup out of the boot bundle. pdfjs is the **4.x legacy build** (`pdfjs-dist/legacy/build/pdf.mjs`, worker `/pdf.worker.min.mjs`) because macOS 13 WKWebView lacks `Promise.withResolvers` — don't switch to the modern build. Don't add pdfjs imports inside `packages/core`.

**OAuth flow (`apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src/utils/cloudAuth.js`).**
Authorization-code + PKCE on a loopback listener. Flow:
1. JS calls `start_oauth_listener` (Rust Tauri command) → Rust binds `127.0.0.1:8765` (fixed port; must match the OAuth client's authorized redirect URI). Returns the port.
2. JS calls `open_google_auth_window` → opens a WebviewWindow to Google's auth URL.
3. Google redirects to `http://127.0.0.1:8765/?code=…&state=…` (code in the **query string**, not the fragment). Rust reads the query, serves a "you may close this window" page, and calls `window.__flightSyncOAuthCb({code, state})` on the main WebviewWindow via `eval()`.
4. JS exchanges the code for tokens via a direct POST to Google's token endpoint (PKCE — no backend needed).
5. Refresh token → macOS Keychain via `save_refresh_token` Rust command (keyring crate). Access token stays in memory (`_accessToken`). Profile (email/name/sub) persists in `localStorage` key `fsl-google-profile`.

Scopes requested: `openid email profile drive.file` (calendar scope removed 2026-06-12 — consent screen is now non-sensitive-only).

**Drive backup (`apps/desktop/src/utils/driveBackup.js`).** Uses `drive.file` scope only — the app can only see files it created. Structure in the pilot's Drive:
- `FlightSync Light/flightsync-light-backup-{deviceId}.json` — one JSON snapshot **per device** (since 0.2.14; create on first backup, multipart PATCH in place after, with `appProperties` labels `fslDevice/fslPlatform/fslFlights/fslDays/fslArchived/fslExportedAt` so the restore chooser can describe each file without downloading it). Drive keeps ~30 days of revisions. The payload carries the live lists **and every archived year** (`archives: [{year, flights, residence}]`).
- `FlightSync Light/flightsync-light-backup.json` — the pre-0.2.14 shared snapshot (every device overwrote it). Never written by 0.2.14+, never deleted; `listBackups()` shows it as "Older shared backup".
- `FlightSync Light/ofps/ofp-{flightId}.pdf` — source OFPs uploaded once, immutable (skipped if already present)
- `FlightSync Light/boarding-passes/bp-{date}-{n}.{ext}` — boarding passes, per-date index for stable naming (known gap: two devices with different passes for the same date collide on the name, and the second one is never uploaded)

Auto-backup: 3-minute debounce after any data change, fires only when signed in. Empty-state guard: never uploads if `flights`, `residence` **and the archived years** are all empty (in January only the archive holds data). Restore: `listBackups()` → the pilot picks a device's backup (newest preselected) → `parseBackupJson` → archived years are merged additively via `restoreArchiveYears` (existing entries win), never replaced. The proactive restore offer appears only when live data **and** the archive are empty. `parseBackupJson` is tolerant per row: a row is repaired when the fix is certain (`toIsoDate`, numeric text → number, notes capped at `MAX_NOTES_LEN`), otherwise left out and listed in `preview.skipped`; structural damage (non-array lists) and an all-junk backup are still rejected, and every kept row must pass the M9 validators.

**ICS export (`apps/desktop/src/utils/icsExport.js`).** Local-only: generates an `.ics` file from flight data for the user to import elsewhere. No GCal read or write; no residence auto-derivation.

**Day panel (`apps/desktop/src/components/DayPanel.jsx`).** Clicking a calendar day opens a single panel with: day classification (4 colours, saved immediately), boarding passes for that day (upload/delete — IndexedDB is the only entry point for passes), and a notes box saved on close. Replaces DayChooser + ResidenceEditModal; BoardingPassModal is now a pure viewer accepting a `pass` prop. A day with `location: null` plus a note is a "note-only untracked day" — excluded from all tallies (`tallyResidence`).

**Folder backup (`apps/desktop/src/utils/folderBackup.js`).** A second, optional, Drive-independent backup destination. The user chooses a local folder through the Rust `pick_backup_folder` command (stored in `settings.backupFolder`); the app debounces writes on a 3-minute timer and mirrors the Drive layout (`flightsync-light-backup.json`, same payload as Drive including the archived years — one device per folder, so no device suffix — + write-once `ofps/` + `boarding-passes/` sub-folders). Restore goes through the standard import-preview flow; PDFs are re-imported individually. Required Tauri capabilities: `fs:allow-write-file`, `write-text-file`, `mkdir`, `exists`, `read-dir`, `lstat`, `rename`. **Folder grant (since 0.2.16):** `pick_backup_folder` shows the native picker, records the folder in `<app_config_dir>/backup-folder.txt` (no fs scope covers it, so the page can't rewrite it) and grants the scope; `allow_backup_folder` re-grants ONLY that recorded folder (mobile: any path inside the app's Documents dir, already in the static scope) and otherwise fails with `BACKUP_FOLDER_NOT_CONFIRMED` — the app then asks the pilot to choose the folder again (folders picked in ≤0.2.15 need this once). `forget_backup_folder` runs on Turn off and Delete ALL data. Don't reintroduce a grant for page-supplied paths: it let a compromised page open any directory (e.g. ~/Library/LaunchAgents). Restores from the folder (`readFolderBackupText`, `restoreFolderBlobs`) and from the Drive archive (`downloadYear`) apply the same checks as the Drive restore: size caps (`MAX_BACKUP_BYTES`/`MAX_BLOB_BYTES`), magic-byte sniffing with the stored MIME type taken from the bytes (`blobMime`), M9 row validators, symlink guards. The JSON snapshot is written to `flightsync-light-backup.json.tmp` and then renamed over the real file (since 0.2.15), so a crash or full disk mid-write can't leave a truncated only copy; the `.tmp` path gets the same symlink guard. **`settings.backupFolder` is machine-specific:** it is stripped from every backup payload/export (`buildBackupPayload` + `exportToJSON`) and is not in the restore allowlist.

**Delete ALL data (`performClearAllData` in App.jsx + `utils/wipeDevice.js`).** Signs out of Google and clears `settings.backupFolder` FIRST — otherwise the next flight typed in would auto-back up an almost empty app over this device's Drive file / folder copy — then wipes live data, archived years (IndexedDB + leftover legacy localStorage keys), OFP PDFs, boarding passes, the pre-restore snapshot (`ac-restore-undo`) and `fsl-last-backup`. Keeps the device id and the other settings. Never touches the backups on Drive or in the folder. Each part is attempted even if another fails; failures are named to the pilot.

**Tax domain (baked into `packages/core/src/tax/`).** Two non-negotiable rules:
- **Canadian proportion is time-based** per ARC (`canadianTime / totalTime`). Distance is computed alongside for comparison only; never substitute it for the proportion.
- **Deadhead rows are filtered out before any tax calculation.** Callers must pre-filter.

## Gotchas

- **Never delete `~/Library/WebKit/com.flightsynclight.app/`** — that's where the WebKit IndexedDB lives and contains all OFPs, boarding passes, and archived years. Clearing it wipes user data permanently. Ask before any cache-clear suggestion touching that path.
- `pnpm install` prints tailwindcss/vite peer-range warnings — expected, not a failure.
- The desktop Tauri app uses a strict CSP in `tauri.conf.json` — when adding a new third-party domain, update `connect-src`/`script-src` accordingly.
- The OAuth port 8765 is hard-coded in both `lib.rs` (the Rust listener) and in the Google Cloud OAuth client's authorized redirect URIs. Changing the port requires updating both places plus the Cloud Console.
- Raw Tauri IPC (`window.__TAURI_INTERNALS__.invoke`) returns file contents as **bytes (ArrayBuffer on Tauri 2.x), never a string** — decode via `src/utils/decodeIpcText.js` (realm-safe; a realm-fragile `instanceof` check is what broke file import in ≤0.2.8). The `@tauri-apps/plugin-fs` JS wrappers decode for you; only raw-invoke call sites need this.
- **iOS 27 requires the UIScene lifecycle** for apps built with the iOS 27 SDK — UIKit traps at launch otherwise (`EXC_BREAKPOINT` in `…NoSceneLifecycleAdoption`; 0.2.9 on TestFlight). Two parts, both load-bearing: tauri ≥2.12.1 / tao ≥0.37.1 (provides `TaoSceneDelegate`) and the `UIApplicationSceneManifest` dict in `gen/apple/app_iOS/Info.plist` (tao detects adoption by the key's mere presence). Don't remove either; a binary built with an older SDK is exempt, which is why a crash can appear only after a toolchain upgrade.
- **Android's file picker returns `content://` document URIs, not filenames** (tauri-plugin-dialog `uri.toString()`), so there is usually no file extension to inspect. `src/utils/importKind.js` trusts a real json/csv/tsv extension and otherwise sniffs the content — don't reintroduce extension-only checks on anything that can come from the mobile picker (every mobile import bounced with "format not supported" in ≤0.2.10).
- **Tauri capability files gate commands AND paths separately**: `fs:allow-write-file` grants the command, but every path still needs a scope. `capabilities/mobile.json` carries `fs:scope-document-recursive` so iOS exports (documents ZIP, CSV/ICS/JSON via `BaseDirectory.Document`) can write to the Files-app container — without it they fail with "forbidden path" (0.2.12 on TestFlight). That scope is the app's own iOS sandbox; the audit-H1 ban on static scopes was about desktop `$HOME`, so don't "fix" this by removing it, and don't widen it either.
- `saveExportFile` accepts a string or a **Uint8Array**. Binary content routes per platform: Android base64 (`contentsB64`) through the Kotlin `DownloadsPlugin` (its `contents` text path must keep working — CSV/ICS use it), iOS `plugin-fs writeFile`, desktop `Blob` download. The ZIP is built with fflate at `level: 0` — the PDFs/images inside are already compressed.
- **Android refresh token (`gen/android/.../KeystorePlugin.kt`)** lives in EncryptedSharedPreferences `fsl-secure`, keyed by a Keystore key that never leaves the phone. A copy restored by Android backup or phone transfer can't be decrypted (`AEADBadTagException`, reproduced on the emulator 2026-11-26), so the file is excluded in `res/xml/data_extraction_rules.xml` + `backup_rules.xml`, and the plugin also recreates the store empty on any open/decrypt failure (the pilot just signs in again). Keep both; `delete` must always resolve so sign-out completes. `androidx.security:security-crypto` is deprecated — migrate eventually, not urgent.
- **Xcode 27.2's `strip` corrupts chained-fixup binaries** (macOS deployment target ≥ 12; ours is 13.0 via `minimumSystemVersion`): the result has a "mis-aligned LINKEDIT string pool". dyld still launches such a main executable (Mac 0.2.14/0.2.15 shipped like that), but refuses to dlopen such a dylib — so once a proc-macro is rebuilt (e.g. after `cargo update`), every release build dies with the misleading `can't find crate for \`tauri_macros\`` (first seen 2026-11-27). Fixes, both load-bearing: `[profile.release.build-override] strip = "none"` in Cargo.toml (helpers never ship) and `-C link-arg=-Wl,-no_fixup_chains` for both macOS targets in `.cargo/config.toml` (shipped binary, same size). Check any Mac build with `dyld_info -arch arm64 -fixups <binary>` / `-arch x86_64`; a cached proc-macro built before the fix must be cleaned (`cargo clean --release -p tauri-macros`).
- `tauri ios dev` under Xcode 27 needs `@tauri-apps/cli` ≥2.12 (2.11 misdetects simulators as physical devices → device-arch binary that can't spawn on the sim) and the iOS simulator *runtime* installed (`xcodebuild -downloadPlatform iOS`), or the CLI stalls on "open Xcode". Standalone `xcodebuild` on the gen/apple project only works while a tauri CLI process is serving options (the Build Rust Code phase phones home over a local WebSocket).

## Releasing (validated shipping v0.2.9, 2026-10-09)

Version lives in **three files** — bump all of them (`chore: bump version to X.Y.Z` commit):
`apps/desktop/package.json`, `apps/desktop/src-tauri/tauri.conf.json`, and
`apps/desktop/src-tauri/gen/apple/app_iOS/Info.plist` (both `CFBundleShortVersionString` and `CFBundleVersion`).
Flow: branch → PR → merge → GitHub release `vX.Y.Z` on main. Release assets are named
`FlightSync-Light_X.Y.Z.apk` and `FlightSync.Light_X.Y.Z_universal.dmg` (docs/GUIDE.md points Android users at the Releases tab).

- **macOS**: universal build per the Commands section. Tauri's DMG step (`bundle_dmg.sh`) needs
  Finder-automation (TCC) permission and fails headless/from agents. Equivalent fallback: stage the
  .app plus an `/Applications` symlink in a temp dir, then
  `hdiutil create -volname "FlightSync Light" -srcfolder <stage> -format UDZO <name>.dmg`.
- **Android**: `pnpm --filter flight-sync-light-desktop exec tauri android build --apk` → signed
  universal APK at `gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`
  (release keystore wired via `gen/android/keystore.properties`). Rename to the release-asset name.
- **iOS**: `pnpm --filter flight-sync-light-desktop exec tauri ios build --export-method app-store-connect`
  (needs rustup's `llvm-tools` component and the repo's `.cargo/config.toml` env + swift-rs pin — see Cargo.toml — until swift-rs releases the Xcode 27 @_cdecl fix)
  builds and signs headless (manual signing, profile "FlightSync Light App Store", team 7NMM2V8489);
  IPA at `gen/apple/build/arm64/`, archive at `gen/apple/build/app_iOS.xcarchive`. Upload to TestFlight:
  `xcrun altool --upload-app -f <ipa> -t ios --apiKey JP7Z85MA9M --apiIssuer <issuer id>` (key verified
  working 2026-10-09; the .p8 lives in `~/.appstoreconnect/private_keys/`, the issuer id is on the App
  Store Connect → Integrations page — deliberately not committed to this public repo). Fallback: `open`
  the .xcarchive → Xcode Organizer → Distribute App. An "according contracts" / "required contracts" error
  means a pending Apple Developer agreement — accept it at appstoreconnect.apple.com, then retry.
  TestFlight delivers updates automatically once Apple finishes processing.
