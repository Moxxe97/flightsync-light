---
layout: default
title: Privacy Policy — FlightSync Light
---

# Privacy Policy

**FlightSync Light** — macOS version  
Last updated: 2026-07-27

---

## In short

FlightSync Light collects no personal data. There is no server, no user account, no telemetry, no usage analytics. Everything you do in the application stays on your Mac.

---

## Locally stored data

All your data — flights, residence days, settings, flight plans (OFPs) and boarding passes — is stored **only on your Mac**, in two locations:

- **localStorage** of the embedded WebKit browser: flight data, residence data and settings.
- **IndexedDB** (WebKit) at `~/Library/WebKit/com.flightsynclight.app/`: OFP PDF files and boarding passes.

None of this data is transmitted to the application's author or to any third party.

---

## Google sign-in (optional)

Signing in with a Google account is entirely optional. If you choose to sign in, here is exactly what happens:

### `drive.file` scope — Google Drive backup

This scope lets the application create and modify **only the files it has itself created** in your Google Drive. It cannot read, modify or delete any other file in your Drive.

The application creates a `FlightSync Light/` folder in your Drive and stores there:
- `flightsync-light-backup.json` — a copy of your flights and residence days (safety backup)
- PDF copies of your OFPs and boarding passes

These files remain in **your own Google Drive**. They are accessible neither to the application's author nor to any third party.

No Google Calendar scope is requested. Day classification (residence, work, leave) is entirely manual, via the built-in day panel.

---

## Local backup folder (optional)

Independently of Google Drive, you can choose a local folder on your Mac as an additional backup destination. The application writes to that folder **only**. No data is read from outside that folder without your explicit action (a restore). The folder path is machine-specific and is never included in exports or Drive backups.

### Authentication tokens

- The **refresh token** is stored in the **macOS Keychain**. It is never transmitted to the author or to third parties.
- The **access token** is kept in memory only, for the duration of the session.
- Your **public profile** (email address, display name) is kept in the application's local storage so the interface knows who is signed in without a network call at every launch. It is not transmitted.

---

## What we do not do

- We do not collect usage data.
- We do not use tracking cookies.
- We do not send error or crash reports (no Sentry, no telemetry).
- We will never sell, share or transmit your data to third parties.
- We have no access to your data. No server ever receives it.

---

## Revoking Google access

You can revoke FlightSync Light's access to your Google account at any time from:

[myaccount.google.com/permissions](https://myaccount.google.com/permissions)

You can also sign out from the application's **Backup** tab. Signing out revokes the refresh token on Google's side and deletes it from the macOS Keychain.

---

## Contact

For any privacy-related question, open a [GitHub Issue](../../issues) in this repository.
