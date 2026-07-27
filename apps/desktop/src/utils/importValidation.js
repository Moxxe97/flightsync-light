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
const MAX_NOTES_LEN = 4000;

// C0 controls + DEL. `\t`/`\n`/`\r` are carved out when `allowNewlines` is set
// because free-text `notes` come from a real multi-line <textarea> (DayPanel)
// and are safely escaped at every export site (icsEscape turns CR/LF into a
// literal "\n"; csvEscape quotes the field) — rejecting them here would just
// break legitimate saved notes on the next backup restore. Fields that should
// never contain a line break (date, flightNumber, location) get the strict form.
const CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/;
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

// Parses + validates the JSON-import text. Returns { preview } (shaped for
// App.jsx's setImportPreview) or { error } with a user-facing French message.
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
  if (Array.isArray(data)) {
    if (!data.every(isValidFlight)) return { error: 'Invalid import — some flights are malformed' };
    return {
      preview: {
        type: 'flights',
        data: { data: { flights: data, residence: [] } },
        flights: data.length,
        residence: 0,
      },
    };
  }
  // Drive disaster-recovery backup (driveBackup.buildBackupPayload): top-level
  // { schemaVersion, flights, residence, settings } — no `data` wrapper. Same
  // row validation as a file backup; settings carried through for restore.
  if (isPlainObject(data) && data.schemaVersion && Array.isArray(data.flights)) {
    const flights = data.flights;
    const residence = Array.isArray(data.residence) ? data.residence : [];
    // Defense-in-depth: a Drive backup is a remote document that could carry
    // arbitrary/foreign keys. Allowlist-copy ONLY the settings the app actually
    // consumes instead of passing `data.settings` through raw. Currently the
    // sole consumed key is `backupReminder` (numeric, default 7 — mirrors the
    // settings state initializer in App.jsx). NEW settings keys must be added
    // here deliberately, or the restore will silently drop them.
    const settings = isPlainObject(data.settings)
      ? { backupReminder: Number(data.settings.backupReminder) || 7 }
      : undefined;
    if (!flights.every(isValidFlight)) return { error: 'Invalid backup — some flights are malformed' };
    if (!residence.every(isValidResidenceDay)) return { error: 'Invalid backup — some residence entries are malformed' };
    return {
      preview: {
        type: 'backup',
        data: { data: { flights, residence, settings } },
        flights: flights.length,
        residence: residence.length,
        date: data.exportedAt,
        device: 'drive',
      },
    };
  }
  if (isPlainObject(data) && data.version && data.data) {
    if (!isPlainObject(data.data)) return { error: 'Invalid backup — missing data' };
    const flights = data.data.flights ?? [];
    const residence = data.data.residence ?? [];
    if (!Array.isArray(flights) || !Array.isArray(residence)) {
      return { error: 'Invalid backup — flights/residence must be lists' };
    }
    if (!flights.every(isValidFlight)) return { error: 'Invalid backup — some flights are malformed' };
    if (!residence.every(isValidResidenceDay)) return { error: 'Invalid backup — some residence entries are malformed' };
    return {
      preview: {
        type: 'backup',
        data,
        flights: flights.length,
        residence: residence.length,
        date: data.exportDate,
        device: data.deviceId,
      },
    };
  }
  return { error: 'Format JSON non reconnu' };
}
