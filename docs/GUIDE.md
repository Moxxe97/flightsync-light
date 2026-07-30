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

## 2. Install on your phone

FlightSync Light also runs on iPhone and Android, with the same local-first data model as the Mac app.

### iPhone (TestFlight)

1. Install **TestFlight** from the App Store (free, published by Apple).
2. Open this link on your iPhone: **[testflight.apple.com/join/4fgXCmZT](https://testflight.apple.com/join/4fgXCmZT)**
3. Tap **Install**.

Updates arrive **automatically** through TestFlight — nothing to do on your end. Apple requires TestFlight builds to be refreshed at least every 90 days, so a new build always lands well before the old one would expire.

### Android (APK)

1. On your phone, open the repository's **[Releases](https://github.com/Moxxe97/flightsync-light/releases)** tab and download the latest `.apk`.
2. Open the downloaded file. Android will prompt to allow "install unknown apps" for your browser — allow it, then continue the install.
3. **To update**: download the new `.apk` from the latest release and open it the same way — it installs over the old version and keeps your data.

### Moving data between devices

Each device — Mac, iPhone, Android — keeps its own local data; there's no live sync between them. To move your data to another device, back up (Drive or local folder) on the one you're leaving, then restore on the new one from **Backup & Restore**. Rule of thumb: one primary device at a time, and back up before switching.

---

## 3. Tour of the app — the 6 tabs

| Tab | What it's for |
|---|---|
| **Dashboard** | Total hours, **Canadian proportion** (CRA basis), the **tax residence — 183-day threshold** counter with remaining margin |
| **Calendar** | Monthly view; click a day to open the classification panel |
| **Backup & Restore** | Google Drive and/or local-folder backup, exports, JSON import/export |
| **Data** | Import your **OFP PDFs** (drag & drop), flight list, boarding passes |
| **Archive** | Past years, read-only |
| **History** | Backup log |

---

## 4. Day-to-day use

### Classify your days (Calendar)

Click a day → the panel opens:

- **Classification** — one click on one of the 4 options, saved immediately:
  🏠 **Canada** · 🌴 **Home** (your country of residence abroad) · 🌍 **International** · ✈️ **Transit**
- **Boarding pass** — drop the day's PDF/photo (stored locally, never sent anywhere)
- **Notes** — free text, saved when the panel closes

This classification is what feeds the 183-day counter on the Dashboard.

### Import your flights (Data)

Drop your **OFP PDFs** into the drop zone. The app extracts the flight, computes the time over Canada and updates the Canadian proportion. No OFP at hand? You can also manage flights manually.

---

## 5. How the time over Canada is computed

The Canadian proportion on the Dashboard is **time-based** (Canadian hours ÷ total hours), consistent with the CRA approach. Since an OFP has no minute-by-minute position log, time over Canada is derived from **distance** over Canada: the app measures what fraction of the flown route lies over Canadian territory, and applies that fraction to the block time.

"Over Canada" means **sovereign Canadian territory only** — the landmass plus the 12-nautical-mile territorial waters, drawn along the real coastline. Oceanic airspace controlled by Canada (e.g. Gander Oceanic) does **not** count.

### From an OFP (most precise)

1. The app reads the **actual waypoints** of the planned route from the OFP's flight log (typically 50–150 fixes).
2. Every leg between consecutive waypoints is walked in **~20 nm steps** along the great circle, and each step is tested against the Canada boundary. So a leg that clips the US border, or re-enters Canada over the Maritimes, is measured correctly — not scored all-or-nothing.
3. Canadian distance = the sum of the steps that fall over Canada. Then:
   **Canadian time = block time × (Canadian distance ÷ total route distance)**

This is the number you see per flight in the Data tab, and the **↻ Recompute (OFP)** button re-runs exactly this calculation on every stored OFP (useful after a boundary improvement).

### From a monthly flight summary (estimate)

A summary PDF lists flights but no route, so the app has to estimate the Canadian share of each missing flight. In the reconciliation window, the badge next to each flight tells you which estimate was used:

- **route average** — you already have OFP-scored flights on the same city pair; the app reuses your own history's average distance and Canadian distance for that route. This is usually very close to an OFP result.
- **great circle** — no history for that route; the app samples the direct great-circle path between the two airports (same 20 nm stepping as above). Good for typical routes, less exact if the real routing deviates a lot from the direct track.
- **manual** — you typed the distances yourself.

In both cases the flight's block time comes from the summary, and Canadian time is again block time × Canadian fraction. Deadhead legs are not counted in the tax figures. If you later drop the real OFP for one of these flights, the estimate is replaced by the precise calculation.

---

## 6. Backup — strongly recommended

Your data lives only on your Mac: set up at least one backup from day one (**Backup & Restore** tab).

**Option A — Google Drive** (optional): sign in with your Google account. The app creates a `FlightSync Light/` folder in **your** Drive and can only access files it created itself (`drive.file` scope — it sees neither your other files, nor your calendar, nor your email). Automatic backup ~3 min after every change; **"Back up now"** to force one.

**Option B — Local folder**: **"Choose a folder…"** and point it at any folder you like (ideally one synced elsewhere: iCloud Drive, Dropbox…). Same content, no account needed.

Both options can be active at the same time. To restore: **"Restore from folder"**, or if you sign in to Drive on an empty Mac, the app offers to restore on its own.

**Exports**: **.ics export** (Apple/Google Calendar), **CSV export** (Excel/Numbers), full JSON **Export (file)**.

---

## 7. Privacy, in short

- No server, no telemetry, no sign-up. The app is 100% functional without a Google account.
- Data is stored in `~/Library/WebKit/com.flightsynclight.app/` — **never delete this folder**, it is your logbook.
- Revoke Google access at any time: [myaccount.google.com/permissions](https://myaccount.google.com/permissions)

---

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| The icon bounces and the app never opens | That's Gatekeeper: run the `xattr` command from section 1. If you already did, check that you have the **universal** `.dmg` (older Apple-Silicon-only builds don't start on Intel Macs) |
| An OFP PDF isn't recognized | Open a [GitHub Issue](https://github.com/Moxxe97/flightsync-light/issues) with your macOS version and, if possible, the first page of the PDF |
| Unsure whether a backup ran | **History** tab: every operation is logged there |

Happy flying ✈️
