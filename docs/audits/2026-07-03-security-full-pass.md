# Security Audit Synthesis — flight-sync (delta) + flightsync-light (full pass)

_Prepared for the app owner. Every finding below survived adversarial verification by two independent reviewers (an "exploitability" lens that traces/executes the real code, and a "claim-accuracy" lens that checks the write-up against source). Where the two lenses disagreed on severity, I show the honest blended rating and flag the disagreement. Nothing here is theoretical unless explicitly labeled defense-in-depth._

---

## 1. Executive summary

**flight-sync (Scope A — code changed since the 2026-06-11 audit): no new remote/network holes, but the changed code added real data-integrity risk.** The delta is the new Drive "repair history" tool plus OFP-math refinements. Two high-impact bugs can silently corrupt the CRA-relevant Canadian-time figures with no visible error: a near-antipodal waypoint pair produces `NaN` that zeroes a flight's tax hours (and overwrites the stored record on re-score), and the stopover-continuity guard will fill an unbounded time gap as "abroad." The repair tool itself trusts Drive revision history without provenance, overwrites entries instead of merging, and defaults every proposed change to pre-checked with one bulk confirm. None of this is remotely triggerable — the worst cases need a crafted/mangled OFP PDF or a backup file that has been shared with edit access — but the outcomes are silent and land in tax data. Overall posture: **medium**, dominated by two fixable data-integrity defects.

**flightsync-light (Scope B — first full pass, public repo): the more serious cluster, mostly local-privilege / data-flow rather than remote.** The Tauri filesystem capability is granted over the entire home directory (`$HOME/**`) when the app only needs one user-chosen folder, and the folder-backup/restore feature follows symlinks with no guard. Combined, these let anyone with write access to the (deliberately cloud-synced) backup folder, or anyone who hands the pilot a poisoned "backup" to restore, overwrite arbitrary files under `$HOME` and exfiltrate private files (e.g. `~/.ssh/id_rsa`) into the pilot's own Google Drive — three HIGH findings sharing one root. Separately, a crafted imported flight can inject forged events into exported `.ics` calendar files (HIGH). Supporting weaknesses: type-only import validation (with the CSV path skipping even that), several restore-safety/UX gaps, unbounded parse/download DoS, and one real PII leak — the maintainer's personal email is in public git history on three merge commits. Almost everything requires the pilot to import/restore an attacker-influenced file or a compromised sync folder (no zero-click remote path), but the blast radius when triggered is large. Overall posture: **elevated**, driven by the fs-scope + symlink cluster; all fixes are known and mostly small.

**Neither scope came back clean.** No finding was a false positive that failed verification; the list below is the verified set.

---

## 2. Findings by severity

Severity reflects the honest blended verdict. "Trigger" notes are included so you can judge real-world likelihood rather than just impact.

### 🔴 HIGH

---

**H1. Tauri fs capability grants recursive read/write across the entire home directory** — *found by two finders, same root, merged*
- **App / file:** flightsync-light — `apps/desktop/src-tauri/capabilities/default.json:8-21`
- **What/why:** The single `default` capability (applied to the whole renderer) grants `read/write/mkdir/read-dir/exists` together with the scope preset `fs:scope-home-recursive`, which (verified against the pinned `tauri-plugin-fs 2.5.1` source) authorizes those operations on `$HOME` and `$HOME/**`. The feature only ever needs the one folder the user picks. So any JavaScript that runs in the webview — a future XSS, or a compromised transitive npm dependency in this React 19 + Vite build — can already read/write anywhere under `$HOME` (`~/.ssh/`, `~/.zshrc`, `~/Library/LaunchAgents/*`, other apps' data) with no path check. `withGlobalTauri: true` makes the primitive directly reachable. This is also the amplifier that makes H2 and H3 dangerous.
- **Fix:** Drop `fs:scope-home-recursive`. Grant a narrow scope limited to the app data dir plus the specific folder the user selects via the directory dialog (Tauri v2 supports per-permission `scope` arrays and runtime `allow_directory(folder, true)` after the picker resolves).
- **Status:** CONFIRMED (both finders, both lenses, verified against the exact installed crate).

---

**H2. Folder-backup writes follow symlinks → overwrite any file under `$HOME`**
- **App / file:** flightsync-light — `apps/desktop/src/utils/folderBackup.js:33-61`
- **What/why:** `runFolderBackup` writes `flightsync-light-backup.json` (re-written every ~3 min by the auto-backup timer) and the OFP/boarding-pass mirrors with no symlink check on the target or its parent dirs. The vendored `tauri-plugin-fs` opens with `create+truncate` and **no `O_NOFOLLOW`**, and its scope check only rejects a resolved target that falls *outside* scope — which, given H1, is essentially never. `exists()` follows symlinks and returns false for a dangling link, so even the "write-once" guard doesn't stop a first write through a planted link. The app's own comment recommends pointing the folder at iCloud/Dropbox, i.e. a routinely-synced/shared location. Anyone with write access there can replace the backup file with a symlink to `~/.ssh/authorized_keys` (or any `$HOME` file); within one auto-backup cycle the app overwrites that target with the backup payload.
- **Fix:** Before each write, `lstat` the target and every intermediate component and refuse if any is a symlink (or `realpath(path).startsWith(realpath(folder))` immediately before writing; or shell out to a Rust command using `symlink_metadata`). Combine with H1's scope narrowing.
- **Status:** CONFIRMED (both lenses, verified against the actual vendored crate 2.5.1 and the 3-min timer in `App.jsx`).

---

**H3. Restore-from-folder follows symlinks on read → exfiltrates arbitrary `$HOME` files into the user's Drive**
- **App / file:** flightsync-light — `apps/desktop/src/utils/folderBackup.js:68-110`
- **What/why:** `restoreFolderBlobs` lists `folder/ofps` and `folder/boarding-passes`, name-matches entries, and `readFile`s them with no check that the entry is a regular file. `read_file` follows symlinks just like `write_file`. The flight `id` used to match `ofp-<id>.pdf` comes from the *same attacker-supplied* backup JSON (`isValidFlight` never validates `id`), so the attacker controls both sides. A poisoned backup folder containing `ofp-X.pdf` → symlink to `~/.ssh/id_rsa` gets read on restore, stored in IndexedDB as flight X's OFP, and then the existing Drive auto-backup uploads those bytes to the pilot's own `FlightSync Light/ofps/` — silent exfiltration to a location that persists in Drive revision history.
- **Fix:** `lstat` / use the `readDir` entry's `isSymlink` flag (already exposed by the plugin) and skip any symlink before `readFile`. Plus H1's scope narrowing.
- **Status:** CONFIRMED (both lenses; full chain — attacker folder → attacker id → symlink read → IDB → Drive upload — traced in the real code; app is unsandboxed/ad-hoc-signed so no OS control blocks it). Trigger: victim must point "Restaurer depuis le dossier" at an attacker-supplied folder (social-engineering / shared-sync vector), not zero-click.

---

**H4. ICS calendar-export injection via unescaped `flight.date`**
- **App / file:** flightsync-light — `apps/desktop/src/utils/icsExport.js:7,12,16,36-37`
- **What/why:** `DTSTART`/`DTEND` are built from `flight.date` with no escaping and no format check (SUMMARY/DESCRIPTION go through `icsEscape`; UID is allowlisted — date uniquely bypasses both). `isValidFlight` only requires `date` to be a string, so it can contain embedded CRLF. Because ICS lines are CRLF-delimited, a crafted imported flight whose `date` embeds `\r\n...BEGIN:VEVENT...` injects entirely forged calendar events into the exported `.ics`. Reproduced end-to-end: the output contained the legitimate event plus an attacker-controlled VEVENT (chosen UID/times/summary/description). Any calendar app the pilot later imports the file into renders the forged/phishing event.
- **Fix:** At the sink, reject/normalize any `flight.date` not matching `/^\d{4}-\d{2}-\d{2}$/` before building the date strings. Defense-in-depth: reject CR/LF in string fields at the import boundary (see M9).
- **Status:** CONFIRMED (both lenses; injection reproduced in Node with the real function; no test file covers this sink).

---

**H5. Near-antipodal waypoint pair produces `NaN`, silently zeroing a flight's Canadian tax hours and corrupting the stored record on re-score**
- **App / file:** flight-sync — `packages/core/src/geo/distance.js:6-14, 43-55` (also present in Light's ported parser)
- **What/why:** `haversineDistance` computes `a = ... ` with no `Math.min(a,1)` clamp before `asin(sqrt(a))`; for a near-exact-antipodal pair `a` rounds just above 1.0 and the result is `NaN`. That `NaN` propagates through `greatCircleCanadianFraction` → `calcCanadianFromWaypoints`, poisoning the whole flight's `canadianDistance`/`canadianTime`. Downstream, `canadian-proportion.js` sums `(f.canadianTime || 0)` — `NaN` is falsy, so the flight's real Canadian time silently vanishes from the numerator while its total time still counts in the denominator (no error surfaces; only an easy-to-miss "NaN%" in the per-flight notes). Worse, `rescore.js` flags "changed" via `!==`, and `NaN !== anything` is always true, so a routine "↻ Recalculer" overwrites a previously-correct stored flight's figures with `NaN` in both localStorage and Firestore.
- **Fix:** Clamp `a = Math.min(a, 1)` before `asin` (the standard fix). Add `Number.isFinite` guards in `calcCanadianFromWaypoints`/`parseOfp` so a bad leg degrades to 0 with a visible warning; make the `canadian-proportion` reducer and `rescore` "changed" check reject non-finite values instead of coercing/applying them.
- **Status:** CONFIRMED (both lenses HIGH; full chain reproduced by executing the shipped module — crafted OFP → `canadianTime: NaN` → aggregate silently drops it → re-score overwrites a good record). Trigger: a deliberately crafted PDF/OFP (the ~1e-13° antipodal window can't arise organically), so this is a local-file-import threat, not remote — but once such a file is imported, even the fully-automated review-free re-score corrupts stored tax data.

---

**H6. Stopover-continuity guard fills an unbounded time gap as "abroad"**
- **App / file:** flight-sync — `packages/core/src/utils/residenceRepair.js:69-88`
- **What/why:** In `findFlippedFromFlights`, once two flights that are merely adjacent in the date-sorted array share an airport code (`depB === arr`, neither Canadian), the code stamps **every** day between them as spent at that foreign airport — with no maximum-gap check. The guard proves airport-code continuity, not chronological continuity. If the OFP history has a gap (plausible: the parser has documented "silent mis-count modes"), two unrelated trips weeks/months apart that happen to share a hub (e.g. both route through CDG) cause a large stretch of genuinely-Canada days to be proposed as `mexico`/`international`, pre-checked (see M3), and on restore written as permanent `_source:'manual'` tax data.
- **Fix:** Reject pairs whose `next.date − f.date` exceeds a plausible layover (e.g. 14–30 days); surface long gaps as "unknown, skipped" rather than silently filling them.
- **Status:** CONFIRMED code-accuracy (HIGH). **Honest caveat:** the exploitability reviewer, who executed the function, downgraded to **medium** because the write-up's single-missing-leg trigger does *not* reproduce (a Canadian bookend on either side is caught by the existing guard) — the real minimal trigger needs a rarer double-sided data loss (both Canada-side legs bracketing the gap dropped). Impact is high, likelihood is lower; the fix is cheap, so it's worth fixing at High priority regardless.

> **Note on H5/H6/M4/L2 (the OFP parser):** these live in `packages/core` and were ported into flightsync-light, so the same defects very likely exist in Light's copy of the parser even though the Light pass reported them only via the flight-sync scope. Apply the fixes to both copies.

---

### 🟠 MEDIUM

---

**M1. Repair tool applies Drive backup-revision content with no provenance/authenticity check**
- **App / file:** flight-sync — `apps/desktop/src/App.jsx:997-1039`, `utils/calendarSync.js:337`
- **What/why:** "Vérifier l'historique" fetches up to 60 Drive revisions of the backup file and treats the newest disagreeing revision as truth, proposing "this day was actually mexico/international." It never requests `lastModifyingUser`, so the modal can't show who wrote a revision. `drive.file` scope doesn't stop the user from *sharing* that file with edit access — any editor can push a revision with fabricated residence data, which then surfaces as an actionable, plausible-looking suggestion; restoring it permanently pins a wrong `_source:'manual'` day into the CRA tally.
- **Fix:** Request `lastModifyingUser` in the revisions `fields` param and show it (or filter to revisions authored by the signed-in account); add UI copy warning that the tool trusts Drive history as-is and to check the file's sharing settings.
- **Status:** CONFIRMED (both lenses). Precondition: the backup file was shared with edit access outside the app (non-default) — which is why medium, not high.

---

**M2. Repair "Restaurer" overwrites the whole residence entry instead of merging, and never re-validates at commit time**
- **App / file:** flight-sync — `apps/desktop/src/App.jsx:1024-1039`
- **What/why:** Restore builds a brand-new 5-field object and `map.set`s it, never spreading the prior entry (so `notes`/`type` — which the app elsewhere treats as sacrosanct "user-touched" fields — are wiped) and never re-checking `isFlippable` against current state. The scan is slow (sequential Drive fetches) and the modal stays open indefinitely; if another synced device (or the pilot) reclassifies one of the flagged days in that window, the eventual click overwrites the fresher, correct data with the stale proposal — permanently, and it re-propagates to Firestore.
- **Fix:** Spread the existing entry (`{ ...prev.get(date), location: c.proposed, _source:'manual', ... }`) and re-check `isFlippable(prev.get(date))` before applying each candidate; skip and report ones that no longer match what was reviewed.
- **Status:** CONFIRMED (both lenses). Realistic trigger is the multi-device race; same-device UI race is blocked by the modal.

---

**M3. All repair candidates pre-checked by default, single bulk confirm, no preview of what's overwritten**
- **App / file:** flightsync-light/flight-sync — `apps/desktop/src/components/RepairModal.jsx:16`
- **What/why:** `unchecked` starts empty, so every proposed change begins selected; the row shows only date + proposed location + a one-line evidence string (never the day's *current* value). One click on "Restaurer N jours" commits the whole batch as permanent tax data. Combined with H6 (which can generate a long wrong list) this turns per-day review into blanket approval of an algorithm's output.
- **Fix:** Default candidates to unchecked (opt-in per day), or at minimum show each day's current location next to the proposal so the user sees what changes before confirming.
- **Status:** CONFIRMED (both lenses). One sub-claim (notes/type destroyed) isn't reachable in this codebase because flippable entries can't currently carry notes/type — the pre-checked/bulk-commit core is confirmed.

---

**M4. No cap on parsed waypoint count → synchronous CPU-exhaustion (UI freeze) on PDF import**
- **App / file:** flight-sync — `packages/core/src/parsing/ofp.js:93-149` (and Light's port)
- **What/why:** The FLIGHT LOG regex scan pushes every waypoint match with no upper bound (unlike the `MAX_LEGS = 8` cap the same file applies to flight numbers), and every consecutive pair is walked in ~20nm steps through an 80-vertex ray-cast — all synchronously on the UI thread, with no chunking. Measured: a crafted ~0.67MB PDF with 50,000 fabricated waypoint rows blocks the thread ~1s and scales linearly, so a modestly larger file freezes the app for many seconds, and again on every future "↻ Recalculer" batch re-score of that stored OFP.
- **Fix:** Cap parsed waypoints (e.g. a few hundred, with a truncation warning), bound total FLIGHT LOG text length before scanning, and/or move sampling to a worker with a wall-clock budget.
- **Status:** CONFIRMED (both lenses; reproduced against the shipped module and a real pdfjs-extracted PDF). Local-import DoS, recoverable by restart — hence medium.

---

**M5. OAuth loopback listener tears down on the first non-empty query to `/`, regardless of validity → reliable local DoS of sign-in**
- **App / file:** flightsync-light — `apps/desktop/src-tauri/src/lib.rs:58-60`
- **What/why:** `is_callback_path` treats *any* request to `/` with a non-empty query as the OAuth callback — it never checks for `code`/`state`/`error`. The first matching connection is processed as final and the listener drops port 8765 for good. The real `state` check happens only client-side afterward. So any unprivileged local process can `curl "http://127.0.0.1:8765/?x=1"` during the sign-in window, consume the one-shot slot, and the genuine Google redirect gets connection-refused. It can't steal/inject a token (the client-side `state` check rejects the forged payload), but it reliably aborts sign-in.
- **Fix:** Have Rust validate the callback — pass the expected `state` in and only treat a connection as terminal when its parsed `state` matches (or `code`/`error` is present); everything else gets the existing 404 stray-path treatment while the loop keeps waiting.
- **Status:** CONFIRMED (both lenses). Availability-only, needs local access — hence medium.

---

**M6. Drive restore applies data to React state before persistence succeeds, with no size/shape caps**
- **App / file:** flightsync-light — `apps/desktop/src/App.jsx:407-436`, `utils/driveBackup.js:180-187`, `utils/importValidation.js:9-15`
- **What/why:** `restoreFromDrive` calls `setFlights`/`setResidence` immediately, then persists to localStorage with no try/catch or rollback. Validation is type-only (a single row with one multi-MB string passes). If the persist throws (e.g. `QuotaExceededError`), the UI keeps rendering unpersisted data for the session while the disk still holds the old data — the tax totals shown don't match what's saved, and it silently reverts on next launch.
- **Fix:** Byte-size cap on the download before `JSON.parse`; persist first (or try/catch that reverts the `setState` on failure); surface a specific "quota exceeded, restore aborted" error.
- **Status:** CONFIRMED code-accuracy; exploitability marked PLAUSIBLE and downgraded from high → **medium** — the attacker path needs control of the pilot's own Drive backup content (≈ full account takeover, or a stale/foreign synced file), and the failure self-heals on relaunch (no permanent loss).

---

**M7. Drive restore fully replaces local data with no preview/diff, behind a confirm dialog that never says data will be overwritten**
- **App / file:** flightsync-light — `apps/desktop/src/App.jsx:407-436, 990-998, 1357-1369`
- **What/why:** Both the proactive offer and the manual "Restaurer depuis Drive" button call `restoreFromDrive`, which replaces flights/residence in one shot. Unlike the local-file import flow (which shows counts + a Fusionner/Remplacer choice), the Drive-restore confirm shows only a generic "Restaurer les données sur ce Mac ?" — no counts, no date, no "this replaces your existing data." The manual button has no "local data empty" guard, so it can destructively replace good non-empty data, with no pre-restore snapshot to undo. Even without a malicious actor, restoring a stale backup by mistake silently loses newer local flights.
- **Fix:** Route Drive restores through the same preview (counts, `exportedAt`, source device, merge-vs-replace choice); make the confirm copy explicit; snapshot current localStorage before applying so a bad restore can be undone.
- **Status:** CONFIRMED (both lenses).

---

**M8. OFP/boarding-pass blob restore trusts Drive filenames and writes unvalidated bytes into IndexedDB, silently overwriting existing flight documents**
- **App / file:** flightsync-light — `apps/desktop/src/utils/driveBackup.js:202-258` (and `driveArchive.js:226-284`)
- **What/why:** `restoreBlobs` derives a `flightId` purely from a Drive file's name and, if it matches, downloads the bytes (no size cap) and `saveOFP`s them — an unconditional IndexedDB `put` with no PDF magic-number check. Anything with write access to the "FlightSync Light" Drive folder can drop `ofp-<existingFlightId>.pdf` with arbitrary bytes; on next restore, that flight's genuine OFP is silently replaced. The archive-year `contentHash` covers only JSON, not the blob bytes, so it doesn't catch this.
- **Fix:** Verify a PDF/image magic number for the expected mimeType and enforce a sane max byte size before `saveOFP`/`saveBoardingPass`; reject files wildly outside the expected KB–few-MB range.
- **Status:** CONFIRMED code-accuracy; exploitability downgraded to **low** — the prerequisite (write access to the pilot's own Drive folder) already grants the far more powerful JSON-backup tamper path, and the worst realized outcome is a broken PDF viewer for one flight (pdfjs degrades gracefully). Listed at medium/low; treat as medium for validation-discipline, low for actual risk.

---

**M9. Import validation checks only field *types*, not content — no date-format or control-char checks, and CSV import bypasses even that**
- **App / file:** flightsync-light — `apps/desktop/src/utils/importValidation.js:9-15`; CSV branch `App.jsx:686-748`
- **What/why:** `isValidFlight`/`isValidResidenceDay` only assert `date`/`flightNumber` are strings — no format/length/control-char check, and numeric fields aren't type-checked at all. This is the direct enabler of the ICS injection (H4). Worse, the CSV/TSV import branch builds flight objects and calls `setImportPreview` **without invoking the validators at all**, so a CSV `Date` column with embedded control chars sails straight into state.
- **Fix:** Add `/^\d{4}-\d{2}-\d{2}$/` date checks and reasonable type/length bounds to both validators; reject CR/LF in any string field at the import boundary; route the CSV branch through the same validators as JSON.
- **Status:** CONFIRMED (both lenses; end-to-end injection reproduced with the real code).

---

**M10. Maintainer's real personal email exposed in public git history on 3 merge commits**
- **App / file:** flightsync-light — `git history` on `origin/main`, commits `060c5a9`, `161641b`, `a2dc22a`
- **What/why:** These three merge commits carry Author `Moxxe97 <eric.collet@me.com>` instead of the GitHub no-reply address used on every other commit — contradicting the deliberate 2026-06 pseudonymous-identity publish decision. Verified live and unauthenticated: the public GitHub REST API returns `eric.collet@me.com` for all three. Anyone browsing the repo or scripting the API can read it (targeted phishing/doxxing).
- **Fix:** Rewrite the author identity on these 3 commits (`git filter-repo --mailmap` or interactive rebase) to the no-reply address and force-push to `origin/main`, as was done for the pre-publish scrub. Warn any clones/forks first. **This is a destructive force-push — get Eric's explicit go-ahead**, or confirm the exposure is accepted.
- **Status:** CONFIRMED (both lenses; verified against the live public API, not just a local clone).

---

### 🟡 LOW

- **L1. New Drive revision-history helpers don't clear stale tokens on 401** — flight-sync `utils/calendarSync.js:331-354`. Unlike `fetchDriveFileAsBlob`, `listBackupRevisions`/`fetchBackupRevision` throw a generic error on 401 without calling `clearDriveAccessToken()`, so the app looks connected while Drive calls keep failing; per-revision failures are only `console.warn`'d, so a mid-scan token expiry silently truncates the scan. **Fix:** clear the token on 401 and surface a distinct reconnect + partial-scan warning. **CONFIRMED** (robustness/UX, not attacker-triggerable).

- **L2. OFP self-heal's fixed ±30–40% great-circle band can clamp legitimate non-direct legs and is a public, static threshold** — flight-sync `packages/core/src/parsing/ofp.js:129-146`. A real terminal-area leg (SID/STAR/DME-arc) whose flown track legitimately exceeds great-circle by >30% gets force-replaced with `round(gc)`, understating distance; only an opaque aggregate "N dist-corrected" note is shown. **Fix:** surface *which* legs were corrected and by how much; validate against the route's declared total, not just pairwise great-circle. **PLAUSIBLE** — code behavior confirmed exactly; the specific false-positive trigger (real terminal-procedure rows in AC's enroute-cruise FLIGHT LOG) is credible but unconfirmed against in-repo data, and the "gameable threshold" framing is weak for a single-user tax tool. Real value here is the observability gap.

- **L3. CSP `connect-src` whitelists the whole `*.googleapis.com` wildcard though only two hosts are called** — flightsync-light `apps/desktop/src-tauri/tauri.conf.json:31`. Only `www.googleapis.com` and `oauth2.googleapis.com` are ever used. **Fix:** replace the wildcard with those two exact hosts. **CONFIRMED** fact; exploitability lens marks it defense-in-depth/info (no script-injection primitive exists today). Cheap hardening.

- **L4. Unbounded download + `JSON.parse` of Drive backup/year files before any shape validation** — flightsync-light `utils/driveBackup.js:180-187`, `utils/driveArchive.js:217-284`. A very large file in the pilot's own Drive folder is fully downloaded and parsed in the renderer before any size check (self-inflicted DoS on restore). **Fix:** check the Drive file's `size` metadata and reject/confirm above a sane threshold. **CONFIRMED** (defense-in-depth; needs the pilot's own account to contain an oversized file).

- **L5. Drive `fileId` interpolated into REST path segments without `encodeURIComponent`** — flightsync-light `utils/driveBackup.js:156,182,190`, `utils/driveArchive.js:103,128,218` (and the analogous flight-sync `calendarSync.js:348-351`, listed as Info I1). fileIds always come from Drive's own list/search responses (URL-safe), so not exploitable today; inconsistent with the same files' encoded query builders. **Fix:** wrap fileId in `encodeURIComponent`. **CONFIRMED** fact; exploitability refuted as a live issue.

- **L6. No explicit path-containment/allowlist at the folder-backup write call sites** — flightsync-light `utils/folderBackup.js:39,56`. `ofp-${flightId}.pdf` / `bp-${date}-...` are concatenated into write paths with no allowlist or `startsWith(folder)` assertion; `isValidFlight` never validates `id`. **Currently not reachable** — the fixed `ofp-`/`bp-` prefix means a `../` payload ENOENTs rather than escaping, and the values reaching this sink come from regex-constrained parser output, not restored JSON. **Fix:** add an allowlist regex on `flightId`/`date` and a containment check before each write, so a future refactor can't silently reopen traversal. **Status:** claim CONFIRMED as latent defense-in-depth; exploitability REFUTED as currently unreachable (the safety is from the fixed prefix, not incidental).

- **L7. Legacy `{version, data}` backup branch doesn't allowlist `settings` before merge** — flightsync-light `utils/importValidation.js:75-94`. The sibling `schemaVersion` branch allowlists settings to `{ backupReminder }`; the legacy branch returns raw settings, and `restoreFromDrive` merges them via `{ ...settings, ...incoming.settings }`. A legacy-shaped file could carry an unfiltered `backupFolder` (used as an fs write target under the home-recursive scope). No prototype-pollution (spread doesn't trigger `__proto__`). **Fix:** apply the same allowlist to the legacy branch. **CONFIRMED** (defense-in-depth; needs a legacy-shaped file placed at the exact Drive path).

- **L8. `.gitignore` has no explicit `.env` rule** — flightsync-light `.gitignore`. Only `*.local` exists (catches `.env.local`, not plain `.env`); no `.env` is currently used or tracked, so nothing has leaked. **Fix:** add `.env` / `.env.*` (with `!.env.example`) as pre-emptive hardening. **CONFIRMED** latent.

---

### ⚪ INFO

- **I1. `fileId` not URI-encoded in `fetchBackupRevision`** — flight-sync `utils/calendarSync.js:348-351`. Same class as L5, on the flight-sync side; fileId is always a Google-generated ID. Wrap in `encodeURIComponent` for consistency. **CONFIRMED** fact / exploitability refuted.

- **I2. No size/row-count cap on imported JSON/CSV text before parsing** — flightsync-light `utils/importValidation.js:32`, `App.jsx:689`. A very large manually-selected file can freeze the renderer (drag-drop of stray files is blocked; import is via explicit file picker only). Reject/truncate above a threshold. **CONFIRMED** (self-DoS, narrow trigger).

---

## 3. Prioritized fix list (what to do first)

Ordered by risk reduction per unit of effort. Items 1–4 are the highest-leverage, lowest-effort changes.

1. **Narrow the Tauri fs capability in Light** (H1) — drop `fs:scope-home-recursive`, scope to the app data dir + the user-picked folder. One-file change that also shrinks the blast radius of the two symlink findings. **Do this first.**
2. **Add symlink guards to Light's folder backup/restore** (H2, H3) — `lstat` / check the `isSymlink` flag and skip symlinks before every `writeFile`/`readFile` in `folderBackup.js`. Closes both arbitrary-overwrite and exfiltration.
3. **Clamp haversine + add finite guards** (H5) — `a = Math.min(a,1)` before `asin`, plus `Number.isFinite` checks in the OFP calc, the tax reducer, and the re-score "changed" test. Apply to **both** `packages/core` copies (flight-sync and Light). Stops silent tax-hour zeroing. One-liner + a few guards.
4. **Validate `flight.date` in ICS export** (H4) — reject anything not `YYYY-MM-DD` before building `DTSTART`/`DTEND`. Kills the calendar-injection.
5. **Bound the stopover-gap fill** (H6) — cap the fill to a plausible max layover (e.g. 14–30 days) in `residenceRepair.js`. Cheap; prevents wholesale fabricated "abroad" stretches.
6. **Cap parsed waypoints + input size in the OFP parser** (M4, I2) — mirror the existing `MAX_LEGS` discipline; bound FLIGHT LOG text length. Stops the import/re-score UI freeze on both apps.
7. **Harden import validation and route CSV through it** (M9) — date-format + control-char rejection; single validation boundary for JSON and CSV. This is also the shared root behind H4.
8. **Make the repair tool safe-by-default** (M1, M2, M3) — show revision `lastModifyingUser` (or filter to self); spread the existing entry + re-check `isFlippable` on restore; default candidates unchecked or show current value.
9. **Make Drive/folder restore safe and honest** (M6, M7, M8, L4) — preview/diff + explicit "this replaces your data" copy; persist-before-apply (or rollback on failure); size caps on download; magic-number/size checks on restored blobs; pre-restore snapshot for undo.
10. **PII + hygiene cleanup** (M10, L1, L3, L5, L7, L8, I1) — with Eric's explicit sign-off, rewrite the 3 merge-commit author emails and force-push; then the small consistency fixes (401 token-clear, CSP two-host allowlist, `encodeURIComponent` on fileIds, legacy-branch settings allowlist, `.env` gitignore rule).

_Honesty notes: No finding failed verification. Two High-severity items carry real caveats — H6's realistic trigger is narrower than first described (impact high, likelihood lower), and H5 requires a deliberately crafted OFP (not a remote or accidental path). Most Light findings are local-privilege / import-restore threats, not zero-click remote holes, but the fs-scope + symlink cluster (H1–H3) has a genuinely large blast radius and should be treated as the top priority._
---

# Appendix — Completeness Critique (audit coverage gaps)

# Completeness Critique — Gaps in the FlightSync / FlightSync Light Security Audit

The nine finders were almost entirely **JavaScript-layer** reviewers. The most important systematic gaps are (a) the entire Rust/Tauri native layer of the *flight-sync* app was never opened in this pass, (b) no dependency/lockfile audit was run in either repo despite the apps' core job being to parse attacker-supplied PDFs, and (c) nobody connected `withGlobalTauri` + broad `fs` scope into an XSS-amplification threat. Details below, with concrete follow-ups.

## Gap 1 — flight-sync's native Tauri/Rust layer was not examined at all (Scope A)
Every Scope-A finder (`fs-oauth-drive`, `fs-repair-integrity`, `fs-ofp-parsing`) read only `.js`/`.jsx`. But `apps/desktop/src-tauri/tauri.conf.json` is in the "changed since 06-11" set, and the native layer is materially larger and riskier than Light's:
- `apps/desktop/src-tauri/src/lib.rs` loads **five** plugins including `tauri-plugin-shell`, `tauri-plugin-http`, and a **custom, vendored `tauri-plugin-google-auth`** crate (`/Users/cortana/Documents/flight-sync/apps/desktop/tauri-plugin-google-auth/src/{lib,commands,desktop,mobile,models,error}.rs` — 7 Rust files) that nobody read. This custom crate *is* the desktop OAuth path — the exact surface Light's `lt-oauth-rust` scrutinized line-by-line in the other repo — yet it received zero review here.
- `lib.rs:237` does `win.eval(&js)` injecting an OAuth callback payload into the main webview. It is `serde_json`-serialized (structurally safe at a glance), but the `payload` provenance and the `__flightSyncOAuthCb` receiver were not traced.
- The 2026-06-11 desktop audit predates all of this and can't be assumed to cover it.

**Follow-ups:** read the `tauri-plugin-google-auth` crate end-to-end (redirect/state/PKCE handling, any custom URL-scheme registration, token storage); diff its behavior against Light's now-audited loopback listener; confirm the `win.eval` payload cannot carry attacker-influenced fields; review `tauri-plugin-http`'s `http:default` allow-list (`capabilities/default.json` → `firebasestorage.googleapis.com/*`, `*.firebasestorage.app/*`) — this is a webview HTTP egress that **bypasses the CSP `connect-src`** and was never checked for who can invoke it.

## Gap 2 — No dependency / supply-chain (lockfile) audit in either repo
Neither `pnpm-lock.yaml`/`Cargo.lock` was audited in either scope. This is the highest-value omission because **both apps parse untrusted PDFs** (OFPs, boarding passes) with `pdfjs-dist` and `pdf-lib`:
- `pdfjs-dist` has a history of PDF-driven arbitrary-JS execution (e.g. CVE-2024-4367 in <4.2). Light pins `^4.10.38` and flight-sync should be checked too — but "pinned to a fixed version" was assumed safe without running an advisory check.
- Other prod deps unaudited: `luxon`, `tz-lookup`, `pdf-lib`, and the Rust side (`keyring`, `url`, `serde_json`, Tauri 2.10.x).

**Follow-ups:** run `pnpm audit --prod` in both repos; `cargo audit` (or `cargo deny`) against both `Cargo.lock`s (flight-sync's `Cargo.lock` changed in `c20a530` for v0.4.3 and was never re-scanned); explicitly confirm the shipped `pdfjs-dist` is ≥ the CVE-2024-4367 fix and that `isEvalSupported`/font-eval is disabled in the worker config.

## Gap 3 — `withGlobalTauri: true` + `fs:scope-home-recursive` = XSS → whole-home read/write (both scopes)
Both `tauri.conf.json` files set `withGlobalTauri: true`, exposing `window.__TAURI__` to all webview JS, and both capabilities grant `fs:scope-home-recursive` (read **and** write across the entire `$HOME`). `lt-fs-path` checked `flightId` path-traversal and concluded escapes fail, but nobody assessed the **amplification**: any XSS in the webview (a live concern given the untrusted-PDF and, in flight-sync, calendar-event render surfaces) can call `__TAURI__` fs `invoke`s to read/write anywhere in the home directory — SSH keys, other apps' data, etc. The `fs` scope is far broader than the feature needs (backup only ever writes to a user-picked folder from `dialog:allow-open`).

**Follow-ups:** evaluate narrowing `fs` scope from `home-recursive` to a bound base dir / the picked folder only; consider dropping `withGlobalTauri` in favor of explicit imports; treat every place parsed-PDF or calendar text reaches the DOM as an XSS sink worth a dedicated pass (grep for `innerHTML`, `dangerouslySetInnerHTML` was done, but React `href`/`src` sinks and any `pdf.js` text-layer rendering were not).

## Gap 4 — flight-sync Firebase/Firestore rules + Sentry egress not re-checked against the new write paths
flight-sync's CSP now permits `https://*.firebaseapp.com`, `https://*.firebasestorage.app`, and `https://*.sentry.io`/`*.ingest.sentry.io`. `lt-firebase-rules` only covered Light (which has no Firebase), so **flight-sync's live Firestore rules got no attention in this pass**, even though two new features write residency/history data: the RepairModal restore (`19f0f86`) and the 45-day GCal freeze (`34473d2`).
- Nobody traced whether repaired/frozen residence data syncs to Firestore, nor whether the rules cover any new fields the repair tool introduces.
- The GCal pull uses the **sensitive `calendar.readonly` scope** — arbitrary calendar event titles/locations flow into the app. Nobody verified those strings are scrubbed before any Sentry breadcrumb/error is emitted (the 06-11 "Sentry-scrub" PR #38 predates these code paths).

**Follow-ups:** locate and review the current `firestore.rules`/deployment for flight-sync; trace whether `handleRepairRestore`/`handleGcalPull` results are persisted to Firestore and whether writes are rules-constrained to the owner; audit every Sentry capture path for calendar-event/PII leakage under the new features.

## Gap 5 — WebView navigation / `window.open`/`_blank` external-open surface (both scopes)
No finder reviewed external-navigation behavior, and neither app configures a navigation allowlist or `on_navigation` handler — both rely on Tauri defaults + CSP `frame-src`.
- flight-sync `apps/desktop/src/components/BoardingPassModal.jsx:89,96` calls `window.open('https://drive.google.com/...id=<fileId>...', '_blank')`. `fileId` is `encodeURIComponent`-wrapped (there's even a test), but the *navigation/target=_blank* behavior itself (does Tauri route this to the OS browser or a new webview? is `rel=noopener` moot here? can a crafted `fileId` steer to a non-Drive origin?) was not assessed.
- Light's OAuth opens `accounts.google.com` in a `WebviewWindow`; `lt-oauth-rust` validated the scheme/host of *that* call but not general in-webview link navigation.

**Follow-ups:** confirm Tauri's default navigation policy for both windows (does clicking an arbitrary `https` link inside the webview navigate the main window, spawn a webview, or hand off to the OS browser?); add an explicit navigation/`external`-open allowlist; verify `window.open` in `BoardingPassModal` cannot be pointed off-origin.

## Gap 6 — Calendar-event and clipboard data-flow (Scope A, shallow)
`fs-oauth-drive` explicitly **declined to re-review** `fetchResidencyEventsFromCalendars`/`fetchCalendarList` ("not modified in this window"), and `CalendarTab.jsx`/`DataTab.jsx` (both in the changed-file set) were only touched as "wiring." So the path where `calendar.readonly` event summary/location fields land in the residence layer and get rendered in `CalendarTab`/`DayPanel` is unreviewed for injection, and the freeze/repair logic wasn't checked for a data-integrity "gaming" angle. Additionally, `PdfDropZone.jsx` (both apps) does `navigator.clipboard.writeText(rawPreview)` — writing raw parsed-PDF text to the clipboard — which no finder examined (low severity, but a data-egress path).

**Follow-ups:** trace calendar event string → residence state → DOM render for XSS; review `DataTab.jsx` (the import/clear-all-data surface) which changed but was never opened; note the clipboard write as accepted-risk or gate it.

## Gap 7 — No auto-updater + ad-hoc/unsigned distribution (both scopes)
Confirmed `tauri-plugin-updater` is absent from **both** `Cargo.lock`s (grep count 0). Combined with ad-hoc signing (`signingIdentity: "-"`) and the documented install workflow that tells users to run `xattr -dr com.apple.quarantine` (per memory), there is **no secure channel to ship a security fix** and users are being trained to strip Gatekeeper quarantine. This is a real supply-chain/patch-velocity gap even though it's not a code vuln.

**Follow-up:** decide whether a signed+notarized build with the Tauri updater (with signature pinning) is warranted, or at minimum document a verified-checksum install path instead of blanket `xattr` stripping.

## Lower-priority / confirm-and-close
- **Deep links:** neither app registers a custom URL scheme / `tauri-plugin-deep-link` (good), but flight-sync's custom `google-auth` plugin's redirect handling (Gap 1) should be confirmed not to register an app-wide URL handler.
- **IPC argument validation:** Light's `lib.rs` commands were read by two finders; flight-sync's command handlers (keychain, the `open_google_auth_window` shell variant at `lib.rs:307`, the eval-callback command) were not enumerated for payload validation.
- **Rate-limiting/DoS:** low relevance for a local desktop app; the OAuth loopback reader is byte/time-bounded in Light. Worth a one-line confirmation that flight-sync's equivalent listener (in the custom plugin) is likewise bounded.
- **Build toolchain:** `vite@^8`, `terser@5.48.0` pinned — dev-time only; include in the `pnpm audit` run above.

**Files that exist and touch security but appear in no finder's surface list:** `/Users/cortana/Documents/flight-sync/apps/desktop/tauri-plugin-google-auth/src/*.rs`, `/Users/cortana/Documents/flight-sync/apps/desktop/src-tauri/src/lib.rs`, `/Users/cortana/Documents/flight-sync/apps/desktop/src-tauri/capabilities/{default,mobile}.json`, `/Users/cortana/Documents/flight-sync/apps/desktop/src-tauri/tauri.conf.json`, `/Users/cortana/Documents/flight-sync/apps/desktop/src/components/BoardingPassModal.jsx`, `/Users/cortana/Documents/flight-sync/apps/desktop/src/components/tabs/DataTab.jsx`, and both repos' `pnpm-lock.yaml` / `Cargo.lock`.