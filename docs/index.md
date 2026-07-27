---
layout: default
title: FlightSync Light
---

# FlightSync Light

A macOS logbook for airline pilots — **free, local-first, open source**.

FlightSync Light lets you import your OFP PDFs straight from your computer, track your flight hours, automatically compute your Canadian time proportion (CRA) and manage your yearly archives — all with no sign-up, no server and no telemetry. All your data stays on your Mac.

---

## Features

- **OFP PDF import** — parses flight plans and extracts flight data automatically
- **Canadian proportion (CRA)** — time-over-Canada calculation consistent with Canada Revenue Agency rules
- **Statistics** — total hours, Canadian proportion, days outside Canada for the fiscal year
- **Calendar & day panel** — monthly view, per-day classification / boarding passes / notes panel, ICS export
- **Archive** — read-only access to past years, stored locally
- **Boarding passes** — local storage of boarding passes by date
- **Optional backup** — to your own Google Drive (`drive.file` scope — the app only sees its own files)

---

## Download

Head to the [**Releases**](../../releases) tab of this GitHub repository to download the latest version — compatible with **Intel and Apple Silicon Macs** (macOS 13+).

> **First launch:** the app is not Apple-signed (it's free and open source). On some Macs, macOS blocks the launch **with no message at all** (the icon bounces then disappears). In Terminal: `xattr -dr com.apple.quarantine "/Applications/FlightSync Light.app"` — or via **System Settings → Privacy & Security → Open Anyway**. See the README for detailed instructions.

---

## Privacy

No data collected. No server. No sign-up.

[Full privacy policy](confidentialite.md)

---

FlightSync Light is a free open-source project — [source code available on GitHub](../../).
