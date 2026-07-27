---
layout: default
title: Quick Guide — FlightSync Light
---

# FlightSync Light — Quick Guide

A macOS logbook for airline pilots — free, no account required, all your data stays on your Mac.

---

## 1. Installation (5 minutes)

1. Go to the repository's **[Releases](https://github.com/Moxxe97/flightsync-light/releases)** tab and download the **"universal"** `.dmg` of the latest version (works on Intel **and** Apple Silicon Macs, macOS 13+).
2. Open the `.dmg` and drag `FlightSync Light.app` into **Applications**.
3. **First launch** — the app isn't Apple-signed, so macOS will block it (sometimes with no message at all: the icon bounces, then disappears). The reliable fix, in **Terminal**:

   ```
   xattr -dr com.apple.quarantine "/Applications/FlightSync Light.app"
   ```

   then launch the app normally. Needed **once per Mac**.

   *No-Terminal alternative* (if macOS does show the block): **System Settings → Privacy & Security** → **Security** section → **Open Anyway**.

---

## 2. Tour of the app — the 6 tabs

| Tab | What it's for |
|---|---|
| **Dashboard** | Total hours, **Canadian proportion** (CRA basis), the **tax residence — 183-day threshold** counter with remaining margin |
| **Calendar** | Monthly view; click a day to open the classification panel |
| **Backup & Restore** | Google Drive and/or local-folder backup, exports, JSON import/export |
| **Data** | Import your **OFP PDFs** (drag & drop), flight list, boarding passes |
| **Archive** | Past years, read-only |
| **History** | Backup log |

---

## 3. Day-to-day use

### Classify your days (Calendar)

Click a day → the panel opens:

- **Classification** — one click on one of the 4 options, saved immediately:
  🏠 **Canada** · 🌴 **Mexico** · 🌍 **International** · ✈️ **Transit**
- **Boarding pass** — drop the day's PDF/photo (stored locally, never sent anywhere)
- **Notes** — free text, saved when the panel closes

This classification is what feeds the 183-day counter on the Dashboard.

### Import your flights (Data)

Drop your **OFP PDFs** into the drop zone. The app extracts the flight, computes the time over Canada and updates the Canadian proportion. No OFP at hand? You can also manage flights manually.

---

## 4. Backup — strongly recommended

Your data lives only on your Mac: set up at least one backup from day one (**Backup & Restore** tab).

**Option A — Google Drive** (optional): sign in with your Google account. The app creates a `FlightSync Light/` folder in **your** Drive and can only access files it created itself (`drive.file` scope — it sees neither your other files, nor your calendar, nor your email). Automatic backup ~3 min after every change; **"Back up now"** to force one.

**Option B — Local folder**: **"Choose a folder…"** and point it at any folder you like (ideally one synced elsewhere: iCloud Drive, Dropbox…). Same content, no account needed.

Both options can be active at the same time. To restore: **"Restore from folder"**, or if you sign in to Drive on an empty Mac, the app offers to restore on its own.

**Exports**: **.ics export** (Apple/Google Calendar), **CSV export** (Excel/Numbers), full JSON **Export (file)**.

---

## 5. Privacy, in short

- No server, no telemetry, no sign-up. The app is 100% functional without a Google account.
- Data is stored in `~/Library/WebKit/com.flightsynclight.app/` — **never delete this folder**, it is your logbook.
- Revoke Google access at any time: [myaccount.google.com/permissions](https://myaccount.google.com/permissions)

---

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| The icon bounces and the app never opens | That's Gatekeeper: run the `xattr` command from section 1. If you already did, check that you have the **universal** `.dmg` (older Apple-Silicon-only builds don't start on Intel Macs) |
| An OFP PDF isn't recognized | Open a [GitHub Issue](https://github.com/Moxxe97/flightsync-light/issues) with your macOS version and, if possible, the first page of the PDF |
| Unsure whether a backup ran | **History** tab: every operation is logged there |

Happy flying ✈️
