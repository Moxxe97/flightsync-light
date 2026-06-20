// Shape guards for backup imports and persisted rows. A malformed 'replace'
// import that persists a non-array crashes every subsequent boot (audit issue
// #23) — validate at the boundary instead.

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isValidFlight(f) {
  return isPlainObject(f) && typeof f.date === 'string' && typeof f.flightNumber === 'string';
}

export function isValidResidenceDay(r) {
  return isPlainObject(r) && typeof r.date === 'string';
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
    if (!data.every(isValidFlight)) return { error: 'Import invalide — certains vols sont mal formés' };
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
    if (!flights.every(isValidFlight)) return { error: 'Backup invalide — certains vols sont mal formés' };
    if (!residence.every(isValidResidenceDay)) return { error: 'Backup invalide — certaines entrées de résidence sont mal formées' };
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
    if (!isPlainObject(data.data)) return { error: 'Backup invalide — données manquantes' };
    const flights = data.data.flights ?? [];
    const residence = data.data.residence ?? [];
    if (!Array.isArray(flights) || !Array.isArray(residence)) {
      return { error: 'Backup invalide — vols/résidence doivent être des listes' };
    }
    if (!flights.every(isValidFlight)) return { error: 'Backup invalide — certains vols sont mal formés' };
    if (!residence.every(isValidResidenceDay)) return { error: 'Backup invalide — certaines entrées de résidence sont mal formées' };
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
