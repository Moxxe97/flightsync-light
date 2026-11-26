// Shape guards for backup imports and persisted rows. A malformed 'replace'
// import that persists a non-array crashes every subsequent boot (audit issue
// #23) — validate at the boundary instead.

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// M9 hardening: the original validators checked field TYPES only
// (`typeof f.date === 'string'`), never CONTENT. That was the direct enabler
// of the ICS-injection vuln — a `date` with an embedded CRLF was a valid
// string and sailed through, then landed unescaped in DTSTART/DTEND
// (see icsExport.js). Every string field that can later be persisted/exported
// now gets a content check: exact date format, and no control characters.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_FLIGHT_NUMBER_LEN = 16; // real formats top out around 8 chars (e.g. "ABC1234A"); generous margin
const MAX_LOCATION_LEN = 32;
export const MAX_NOTES_LEN = 4000; // also the DayPanel textarea's maxLength

// C0 controls + DEL. `\t`/`\n`/`\r` are carved out when `allowNewlines` is set
// because free-text `notes` come from a real multi-line <textarea> (DayPanel)
// and are safely escaped at every export site (icsEscape turns CR/LF into a
// literal "\n"; csvEscape quotes the field) — rejecting them here would just
// break legitimate saved notes on the next backup restore. Fields that should
// never contain a line break (date, flightNumber, location) get the strict form.
// eslint-disable-next-line no-control-regex -- intentional: strips control chars per security audit H4
const CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/;
// eslint-disable-next-line no-control-regex -- intentional: strips control chars per security audit H4
const CONTROL_CHARS_NO_NEWLINE_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

function hasControlChars(s, { allowNewlines = false } = {}) {
  return (allowNewlines ? CONTROL_CHARS_NO_NEWLINE_RE : CONTROL_CHARS_RE).test(s);
}

// String must be the right type, within bounds, and free of control
// characters (Tab/CR/LF optionally excused — see above).
function isCleanString(s, maxLen, opts) {
  return typeof s === 'string' && s.length <= maxLen && !hasControlChars(s, opts);
}

export function isValidFlight(f) {
  if (!isPlainObject(f)) return false;
  if (typeof f.date !== 'string' || !DATE_RE.test(f.date)) return false;
  if (!isCleanString(f.flightNumber, MAX_FLIGHT_NUMBER_LEN)) return false;
  if (f.notes != null && !isCleanString(f.notes, MAX_NOTES_LEN, { allowNewlines: true })) return false;
  return true;
}

export function isValidResidenceDay(r) {
  if (!isPlainObject(r)) return false;
  if (typeof r.date !== 'string' || !DATE_RE.test(r.date)) return false;
  // Known buckets: canada/mexico/international/transit, or null (note-only
  // untracked day — see residence.js). Any OTHER non-null value is still
  // accepted as long as it's a clean, bounded string: tallyResidence()
  // deliberately buckets unknown locations into `other` for forward
  // compatibility, so this stays a content/safety check, not a business enum.
  if (r.location != null && !isCleanString(r.location, MAX_LOCATION_LEN)) return false;
  if (r.notes != null && !isCleanString(r.notes, MAX_NOTES_LEN, { allowNewlines: true })) return false;
  return true;
}

// Boot-time guard: never let a persisted non-array (or junk rows) reach React
// state. Field-level checks stay loose here — dropping a legit row at boot is
// worse than rendering it.
export function sanitizeStoredRows(value) {
  return Array.isArray(value) ? value.filter(isPlainObject) : [];
}

// A real calendar date written year-month-day, returned as 'YYYY-MM-DD'.
// One-digit month/day and '/' or '.' separators are accepted ("2026-3-1",
// "2026/03/01"); impossible dates, day-first forms (whose order is ambiguous)
// and words return null. Used to repair restored rows and to check the date a
// pilot types in the OFP review table.
export function toIsoDate(s) {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return null;
  if (d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null; // day 0 of next month = last day of this one
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ─── Tolerant restore ────────────────────────────────────────
// A backup must stay restorable. One hand-typed date or one long note used to
// make the whole file "malformed", at the moment the pilot needed it. Each row
// is now repaired when the fix is certain (date format, note length, stray
// control characters in a note, hours stored as text), and otherwise left out
// and listed in `skipped` for the pilot to see. Nothing is ever accepted
// unchecked: every kept row still passes isValidFlight / isValidResidenceDay,
// so the M9 guarantees (no control characters in single-line fields, exact
// date shape, bounded lengths) hold for everything that reaches state.
const NUMERIC_FIELDS = ['totalTime', 'canadianTime', 'distance', 'canadianDistance'];
const NUMERIC_TEXT_RE = /^\s*-?\d+(?:\.\d+)?\s*$/;
// eslint-disable-next-line no-control-regex -- intentional: strips control chars (keeps tab/newlines) from free-text notes
const NOTE_CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
// eslint-disable-next-line no-control-regex -- intentional: keeps labels shown in the report on one clean line
const LABEL_CONTROL_CHARS_RE = /[\x00-\x1F\x7F]+/g;

const shortText = (v, n = 24) => String(v ?? '').replace(LABEL_CONTROL_CHARS_RE, ' ').trim().slice(0, n);

function repairDate(row) {
  if (typeof row.date === 'string' && DATE_RE.test(row.date)) return 'ok';
  const iso = toIsoDate(row.date);
  if (!iso) return 'bad';
  row.date = iso;
  return 'fixed';
}

function repairNotes(row) {
  if (row.notes == null) return false;
  let fixed = false;
  if (typeof row.notes !== 'string') {
    if (typeof row.notes === 'number' || typeof row.notes === 'boolean') row.notes = String(row.notes);
    else delete row.notes;
    return true;
  }
  const clean = row.notes.replace(NOTE_CONTROL_CHARS_RE, '');
  if (clean !== row.notes) { row.notes = clean; fixed = true; }
  if (row.notes.length > MAX_NOTES_LEN) { row.notes = row.notes.slice(0, MAX_NOTES_LEN); fixed = true; }
  return fixed;
}

// → { row, fixed } or { reason }
function cleanFlight(input) {
  if (!isPlainObject(input)) return { reason: 'not a flight record' };
  const row = { ...input };
  let fixed = false;
  const date = repairDate(row);
  if (date === 'bad') return { reason: 'date not readable' };
  if (date === 'fixed') fixed = true;
  if (typeof row.flightNumber === 'number') { row.flightNumber = String(row.flightNumber); fixed = true; }
  if (!isCleanString(row.flightNumber, MAX_FLIGHT_NUMBER_LEN)) return { reason: 'flight number not readable' };
  if (repairNotes(row)) fixed = true;
  for (const k of NUMERIC_FIELDS) {
    if (typeof row[k] === 'string' && NUMERIC_TEXT_RE.test(row[k])) { row[k] = Number(row[k]); fixed = true; }
  }
  return isValidFlight(row) ? { row, fixed } : { reason: 'not readable' };
}

function cleanDay(input) {
  if (!isPlainObject(input)) return { reason: 'not a day record' };
  const row = { ...input };
  let fixed = false;
  const date = repairDate(row);
  if (date === 'bad') return { reason: 'date not readable' };
  if (date === 'fixed') fixed = true;
  if (row.location != null && !isCleanString(row.location, MAX_LOCATION_LEN)) return { reason: 'place not readable' };
  if (repairNotes(row)) fixed = true;
  return isValidResidenceDay(row) ? { row, fixed } : { reason: 'not readable' };
}

const flightLabel = (f) => (isPlainObject(f)
  ? `${shortText(f.flightNumber, 12) || 'flight'} · ${shortText(f.date) || 'no date'}`
  : `flight ${shortText(typeof f === 'string' ? f : JSON.stringify(f))}`);
const dayLabel = (r) => (isPlainObject(r) ? `day ${shortText(r.date) || '(no date)'}` : `day ${shortText(JSON.stringify(r))}`);

function newReport() { return { skipped: [], repaired: 0, seen: 0 }; }

function cleanRows(rows, kind, report, year) {
  const kept = [];
  for (const input of rows) {
    report.seen++;
    const { row, fixed, reason } = kind === 'flight' ? cleanFlight(input) : cleanDay(input);
    if (!row) {
      const label = (kind === 'flight' ? flightLabel : dayLabel)(input);
      report.skipped.push({ kind, label: year ? `${label} (archived ${year})` : label, reason });
      continue;
    }
    if (fixed) report.repaired++;
    kept.push(row);
  }
  return kept;
}

function normalizeYear(y) {
  const s = typeof y === 'number' && Number.isInteger(y) ? String(y) : y;
  return typeof s === 'string' && /^\d{4}$/.test(s) ? s : null;
}

// Archived years ({ year, flights, residence }) carried by backups since 0.2.14.
// Missing (older backups) → []. A year entry that is not readable is left out
// and reported; its readable rows are cleaned like live rows.
function readArchives(raw, report) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    report.skipped.push({ kind: 'year', label: 'archived years', reason: 'not a list' });
    return [];
  }
  const out = [];
  for (const a of raw) {
    const year = isPlainObject(a) ? normalizeYear(a.year) : null;
    if (!year || (a.flights != null && !Array.isArray(a.flights)) || (a.residence != null && !Array.isArray(a.residence))) {
      report.seen++;
      report.skipped.push({ kind: 'year', label: `archived year ${shortText(isPlainObject(a) ? a.year : a, 12)}`, reason: 'not readable' });
      continue;
    }
    out.push({ year, flights: cleanRows(a.flights || [], 'flight', report, year), residence: cleanRows(a.residence || [], 'day', report, year) });
  }
  return out;
}

// Shared tail of every format: counts, the "nothing readable" refusal, preview.
function buildPreview({ type, flights, residence, settings, archives, report, date, device }) {
  const archivedFlights = archives.reduce((n, a) => n + a.flights.length, 0);
  const archivedDays = archives.reduce((n, a) => n + a.residence.length, 0);
  const kept = flights.length + residence.length + archivedFlights + archivedDays;
  if (kept === 0 && report.skipped.length > 0) {
    return { error: `Invalid backup — none of the ${report.seen} rows could be read` };
  }
  return {
    preview: {
      type,
      data: { data: { flights, residence, settings, archives } },
      flights: flights.length,
      residence: residence.length,
      archivedYears: archives.length,
      archivedFlights,
      skipped: report.skipped,
      repaired: report.repaired,
      date,
      device,
    },
  };
}

// Parses + validates the JSON-import text. Returns { preview } (shaped for
// App.jsx's setImportPreview and restoreFromDrive) or { error } with a
// user-facing message. A file whose STRUCTURE is wrong (not JSON, unknown
// shape, flights not a list) is still refused outright; individual rows are
// repaired or left out (see "Tolerant restore" above).
export function parseBackupJson(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { error: 'Lecture du fichier vide ou invalide' };
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { error: `JSON parse: ${err.message} (head: ${String(text).slice(0, 60)})` };
  }
  const report = newReport();
  if (Array.isArray(data)) {
    return buildPreview({
      type: 'flights', flights: cleanRows(data, 'flight', report), residence: [], settings: undefined,
      archives: [], report,
    });
  }
  // Drive / folder backup (driveBackup.buildBackupPayload): top-level
  // { schemaVersion, flights, residence, settings, archives } — no `data` wrapper.
  if (isPlainObject(data) && data.schemaVersion && Array.isArray(data.flights)) {
    // Defense-in-depth: a Drive backup is a remote document that could carry
    // arbitrary/foreign keys. Allowlist-copy ONLY the settings the app actually
    // consumes instead of passing `data.settings` through raw. Currently the
    // sole consumed key is `backupReminder` (numeric, default 7 — mirrors the
    // settings state initializer in App.jsx). NEW settings keys must be added
    // here deliberately, or the restore will silently drop them.
    const settings = isPlainObject(data.settings)
      ? { backupReminder: Number(data.settings.backupReminder) || 7 }
      : undefined;
    return buildPreview({
      type: 'backup',
      flights: cleanRows(data.flights, 'flight', report),
      residence: cleanRows(Array.isArray(data.residence) ? data.residence : [], 'day', report),
      settings,
      archives: readArchives(data.archives, report),
      report,
      date: data.exportedAt,
      device: 'drive',
    });
  }
  // JSON export file (App.exportToJSON): { version, exportDate, deviceId, data: { … } }.
  if (isPlainObject(data) && data.version && data.data) {
    if (!isPlainObject(data.data)) return { error: 'Invalid backup — missing data' };
    const flights = data.data.flights ?? [];
    const residence = data.data.residence ?? [];
    if (!Array.isArray(flights) || !Array.isArray(residence)) {
      return { error: 'Invalid backup — flights/residence must be lists' };
    }
    return buildPreview({
      type: 'backup',
      flights: cleanRows(flights, 'flight', report),
      residence: cleanRows(residence, 'day', report),
      settings: undefined,
      archives: readArchives(data.data.archives, report),
      report,
      date: data.exportDate,
      device: data.deviceId,
    });
  }
  return { error: 'Format JSON non reconnu' };
}
