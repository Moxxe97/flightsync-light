# FlightSync Light

A macOS logbook for airline pilots — free, local-first, open source.

---

## What the app does

- **Dashboard** — total hours, Canadian proportion (CRA), days outside Canada for the current fiscal year
- **Calendar & day panel** — monthly view; clicking a day opens the classification, boarding-pass and notes panel; ICS export
- **Backup** — optional safety backup to your own Google Drive **and/or** a local folder of your choice (see below)
- **Data** — OFP PDF import, flight and boarding-pass management
- **Archive** — read-only access to past years archived locally; per-year Drive backup
- **History** — backup operation log

All data is stored **locally on your Mac** (localStorage + IndexedDB). No server, no telemetry, no sign-up required.

**New here? Start with the [Quick Guide](https://moxxe97.github.io/flightsync-light/GUIDE)** — install steps, a tour of the tabs, and how the time over Canada is computed.

---

## Free & private

- **No data is collected.** FlightSync Light has no server, no account, no telemetry.
- Flights, residence days and flight plans live in `~/Library/WebKit/com.flightsynclight.app/` on your Mac.
- Google sign-in is **entirely optional** — the app is 100% functional without an account.
- If you enable the Drive backup, your files go to **your own** Google Drive (`FlightSync Light/`). The app uses the `drive.file` scope: it can only see files it has itself created.

---

## Installation

### Download

Head to this repository's **Releases** tab and download the "universal" `.dmg` of the latest version — compatible with **Intel and Apple Silicon Macs** (macOS 13+). Open it and drag `FlightSync Light.app` into your **Applications** folder. (The `.zip` contains the same app.)

### First launch — Gatekeeper

The application is not Apple-signed (the cost and paperwork are disproportionate for a free tool). macOS will block the first launch — and on some Macs **without showing any message at all**: the icon bounces in the Dock, then disappears. The most reliable method, in **Terminal**:

```
xattr -dr com.apple.quarantine "/Applications/FlightSync Light.app"
```

then open the app normally. Alternative without Terminal (if macOS does show the block):

1. Double-click `FlightSync Light.app` → macOS shows *"cannot be opened…"*.
2. Open **System Settings → Privacy & Security**.
3. Scroll down to the **Security** section — you will see the message *"FlightSync Light was blocked…"*.
4. Click **Open Anyway**.
5. Confirm in the dialog that appears.

This is only needed once **per Mac**. macOS remembers your choice.

> **Why unsigned?** Apple signing costs USD 99/year and requires enrolling in the developer program. For a free, open-source tool distributed directly, that overhead isn't justified. The source code is available here for audit.

---

## Google sign-in (optional)

Google sign-in unlocks the Drive backup:

| Feature | Required scope |
|---|---|
| Safety backup to your Drive | `drive.file` |

The Google consent screen only asks for non-sensitive scopes (`openid email profile drive.file`). No Calendar scope is requested — day classification is entirely manual from the day panel.

**What the app does not do:**

- It reads **no** Drive files other than the ones it created (`drive.file` limits access to app-created files only).
- It neither reads nor modifies your Google calendar — no Calendar scope is requested.
- The refresh token is stored in the **macOS Keychain**; the access token stays in memory.
- Your profile (email, name) is kept in localStorage for display — it is sent nowhere.

**Revoke access:** [myaccount.google.com/permissions](https://myaccount.google.com/permissions)

---

## Reporting a problem

Open a [GitHub Issue](../../issues) in this repository. Please describe your macOS version, the steps to reproduce, and if possible attach the console output (Menu → View → Developer Tools).

---

## Building from source

Prerequisites: **Rust** (via [rustup](https://rustup.rs)), **Node.js ≥ 20**, **pnpm 9**.

```bash
pnpm install
pnpm tauri:build
```

The signable executable is produced in `apps/desktop/src-tauri/target/release/bundle/macos/` (host architecture only).

For a distributable **universal** build (Intel + Apple Silicon):

```bash
rustup target add x86_64-apple-darwin   # once
pnpm --filter flight-sync-light-desktop exec tauri build --target universal-apple-darwin
```

The bundle then lands in `apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle/`.

For development:

```bash
pnpm dev          # Vite HMR + Tauri in dev mode
pnpm test         # Vitest (all workspaces)
pnpm build:desktop  # Vite build only
```
