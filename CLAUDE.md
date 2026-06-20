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
- `pnpm tauri:build` — full Tauri bundle.
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
- `FlightSync Light/flightsync-light-backup.json` — JSON snapshot (create on first backup, PATCH in place on subsequent ones; Drive keeps ~30 days of revisions)
- `FlightSync Light/ofps/ofp-{flightId}.pdf` — source OFPs uploaded once, immutable (skipped if already present)
- `FlightSync Light/boarding-passes/bp-{date}-{n}.{ext}` — boarding passes, per-date index for stable naming

Auto-backup: 3-minute debounce after any data change, fires only when signed in. Empty-state guard: never uploads if both `flights` and `residence` are empty. Restore: `parseBackupJson` validation + proactive offer on sign-in when local data is empty.

**ICS export (`apps/desktop/src/utils/icsExport.js`).** Local-only: generates an `.ics` file from flight data for the user to import elsewhere. No GCal read or write; no residence auto-derivation.

**Day panel (`apps/desktop/src/components/DayPanel.jsx`).** Clicking a calendar day opens a single panel with: day classification (4 colours, saved immediately), boarding passes for that day (upload/delete — IndexedDB is the only entry point for passes), and a notes box saved on close. Replaces DayChooser + ResidenceEditModal; BoardingPassModal is now a pure viewer accepting a `pass` prop. A day with `location: null` plus a note is a "note-only untracked day" — excluded from all tallies (`tallyResidence`).

**Folder backup (`apps/desktop/src/utils/folderBackup.js`).** A second, optional, Drive-independent backup destination. The user chooses a local folder via Tauri dialog (stored in `settings.backupFolder`); the app debounces writes on a 3-minute timer and mirrors the Drive layout (`flightsync-light-backup.json` + write-once `ofps/` + `boarding-passes/` sub-folders). Restore goes through the standard import-preview flow; PDFs are re-imported individually. Required new Tauri capabilities: `fs:allow-write-file`, `write-text-file`, `mkdir`, `exists`, `read-dir`. **`settings.backupFolder` is machine-specific:** it is stripped from every backup payload/export (`buildBackupPayload` + `exportToJSON`) and is not in the restore allowlist.

**Tax domain (baked into `packages/core/src/tax/`).** Two non-negotiable rules:
- **Canadian proportion is time-based** per ARC (`canadianTime / totalTime`). Distance is computed alongside for comparison only; never substitute it for the proportion.
- **Deadhead rows are filtered out before any tax calculation.** Callers must pre-filter.

## Gotchas

- **Never delete `~/Library/WebKit/com.flightsynclight.app/`** — that's where the WebKit IndexedDB lives and contains all OFPs, boarding passes, and archived years. Clearing it wipes user data permanently. Ask before any cache-clear suggestion touching that path.
- `pnpm install` prints tailwindcss/vite peer-range warnings — expected, not a failure.
- The desktop Tauri app uses a strict CSP in `tauri.conf.json` — when adding a new third-party domain, update `connect-src`/`script-src` accordingly.
- The OAuth port 8765 is hard-coded in both `lib.rs` (the Rust listener) and in the Google Cloud OAuth client's authorized redirect URIs. Changing the port requires updating both places plus the Cloud Console.
