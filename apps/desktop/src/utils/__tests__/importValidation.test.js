import { describe, it, expect } from 'vitest';
import { parseBackupJson, sanitizeStoredRows, isValidFlight, isValidResidenceDay } from '../importValidation';

const flight = { id: 'f1', date: '2026-05-01', flightNumber: 'AC871' };

describe('parseBackupJson', () => {
  it('accepts a well-formed backup', () => {
    const text = JSON.stringify({ version: 1, exportDate: 'd', deviceId: 'dev', data: { flights: [flight], residence: [{ date: '2026-05-01' }] } });
    const { preview, error } = parseBackupJson(text);
    expect(error).toBeUndefined();
    expect(preview.type).toBe('backup');
    expect(preview.flights).toBe(1);
    expect(preview.residence).toBe(1);
  });

  it('rejects a backup whose flights is not an array (the poison-pill)', () => {
    const text = JSON.stringify({ version: 1, data: { flights: { evil: true }, residence: [] } });
    const { preview, error } = parseBackupJson(text);
    expect(preview).toBeUndefined();
    expect(error).toMatch(/invalid/i);
  });

  it('rejects a backup with junk flight rows', () => {
    const text = JSON.stringify({ version: 1, data: { flights: [flight, 'junk'], residence: [] } });
    expect(parseBackupJson(text).error).toMatch(/invalid/i);
  });

  it('rejects a backup with junk residence rows', () => {
    const text = JSON.stringify({ version: 1, data: { flights: [], residence: [{ notADate: 1 }] } });
    expect(parseBackupJson(text).error).toMatch(/invalid/i);
  });

  it('accepts a bare flights array', () => {
    const { preview, error } = parseBackupJson(JSON.stringify([flight]));
    expect(error).toBeUndefined();
    expect(preview.type).toBe('flights');
    expect(preview.data.data.flights).toEqual([flight]);
  });

  it('rejects a bare array with non-flight rows', () => {
    expect(parseBackupJson(JSON.stringify([flight, 42])).error).toBeTruthy();
  });

  it('rejects empty / non-JSON text', () => {
    expect(parseBackupJson('').error).toBeTruthy();
    expect(parseBackupJson('not json').error).toMatch(/JSON parse/);
  });

  it('rejects unrecognized JSON', () => {
    expect(parseBackupJson('{"foo":1}').error).toMatch(/non reconnu/);
  });
});

// The Drive disaster-recovery payload: top-level { schemaVersion, flights,
// residence, settings } with no `data` wrapper (driveBackup.buildBackupPayload).
// This is what restoreFromDrive parses, so a malformed remote doc must be
// rejected BEFORE it can replace local state.
describe('parseBackupJson — Drive payload branch (schemaVersion)', () => {
  const residenceDay = { date: '2026-05-01' };

  it('accepts a well-formed Drive payload and previews the same data', () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      flights: [flight],
      residence: [residenceDay],
      settings: { a: 1 },
    });
    const { preview, error } = parseBackupJson(text);
    expect(error).toBeUndefined();
    expect(preview.type).toBe('backup');
    expect(preview.device).toBe('drive');
    expect(preview.flights).toBe(1);
    expect(preview.residence).toBe(1);
    expect(preview.data.data.flights).toEqual([flight]);
    expect(preview.data.data.residence).toEqual([residenceDay]);
  });

  it('rejects a Drive payload with junk flight rows', () => {
    const text = JSON.stringify({ schemaVersion: 1, flights: [flight, 'junk'], residence: [] });
    const { preview, error } = parseBackupJson(text);
    expect(preview).toBeUndefined();
    expect(error).toMatch(/invalid/i);
  });

  it('falls through to "non reconnu" when flights is not an array', () => {
    // schemaVersion present but flights not an array → the schemaVersion branch
    // is skipped (its guard requires Array.isArray(flights)); no later branch
    // matches, so it lands on the unrecognized-format error rather than touching state.
    const text = JSON.stringify({ schemaVersion: 1, flights: { evil: true }, residence: [] });
    const { preview, error } = parseBackupJson(text);
    expect(preview).toBeUndefined();
    expect(error).toMatch(/non reconnu/);
  });

  it('clamps settings to an allowlist: backupReminder numeric, default 7', () => {
    // Foreign/extra keys are dropped; a non-numeric backupReminder falls back to 7.
    const text = JSON.stringify({
      schemaVersion: 1,
      flights: [flight],
      residence: [],
      settings: { backupReminder: 14, autoSync: false, evil: 'x', token: 'leak' },
    });
    const { preview, error } = parseBackupJson(text);
    expect(error).toBeUndefined();
    expect(preview.data.data.settings).toEqual({ backupReminder: 14 });

    const bad = JSON.stringify({
      schemaVersion: 1,
      flights: [flight],
      residence: [],
      settings: { backupReminder: 'soon' },
    });
    expect(parseBackupJson(bad).preview.data.data.settings).toEqual({ backupReminder: 7 });
  });

  it('leaves settings undefined when not a plain object', () => {
    const text = JSON.stringify({ schemaVersion: 1, flights: [flight], residence: [], settings: [1, 2] });
    const { preview, error } = parseBackupJson(text);
    expect(error).toBeUndefined();
    expect(preview.data.data.settings).toBeUndefined();
  });

  it('accepts note-only residence days (location: null) in backups', () => {
    const { preview, error } = parseBackupJson(JSON.stringify({
      schemaVersion: 1,
      flights: [],
      residence: [{ date: '2026-03-15', location: null, notes: 'note seule' }],
    }));
    expect(error).toBeUndefined();
    expect(preview.residence).toBe(1);
  });
});

describe('sanitizeStoredRows', () => {
  it('returns [] for non-arrays (boot crash-loop guard)', () => {
    expect(sanitizeStoredRows({ evil: true })).toEqual([]);
    expect(sanitizeStoredRows(null)).toEqual([]);
    expect(sanitizeStoredRows('x')).toEqual([]);
  });
  it('drops non-object rows but keeps object rows', () => {
    expect(sanitizeStoredRows([flight, null, 'junk', 7])).toEqual([flight]);
  });
});

describe('row validators', () => {
  it('isValidFlight requires object with string date + flightNumber', () => {
    expect(isValidFlight(flight)).toBe(true);
    expect(isValidFlight({ date: '2026-01-01' })).toBe(false);
    expect(isValidFlight(null)).toBe(false);
  });
  it('isValidResidenceDay requires object with string date', () => {
    expect(isValidResidenceDay({ date: '2026-01-01' })).toBe(true);
    expect(isValidResidenceDay({})).toBe(false);
  });
});

// M9: validators previously checked field TYPES only (typeof f.date ===
// 'string'), not CONTENT — no date-format check, no control-character check,
// no length bounds. That was the direct enabler of the ICS-injection vuln
// (a `date` with embedded CRLF passed validation and reached DTSTART/DTEND
// unescaped). These tests lock in content-level hardening.
describe('row validators — content hardening (M9)', () => {
  describe('isValidFlight', () => {
    it('rejects a date that is not YYYY-MM-DD', () => {
      expect(isValidFlight({ ...flight, date: '2026-5-1' })).toBe(false);
      expect(isValidFlight({ ...flight, date: '01/05/2026' })).toBe(false);
      expect(isValidFlight({ ...flight, date: 'not-a-date' })).toBe(false);
    });

    it('rejects a date with an embedded CRLF (the ICS-injection shape)', () => {
      expect(isValidFlight({ ...flight, date: '2026-05-01\r\nX-EVIL:injected' })).toBe(false);
    });

    it('rejects a flightNumber containing control characters', () => {
      expect(isValidFlight({ ...flight, flightNumber: 'AC1\r\n23' })).toBe(false);
      expect(isValidFlight({ ...flight, flightNumber: 'AC1\n23' })).toBe(false);
      expect(isValidFlight({ ...flight, flightNumber: 'AC\x0023' })).toBe(false);
    });

    it('rejects an over-long flightNumber', () => {
      expect(isValidFlight({ ...flight, flightNumber: 'A'.repeat(17) })).toBe(false);
      // Boundary: 16 chars is still accepted.
      expect(isValidFlight({ ...flight, flightNumber: 'A'.repeat(16) })).toBe(true);
    });

    it('accepts realistic flight numbers of varying real-world shapes', () => {
      expect(isValidFlight({ ...flight, flightNumber: 'AC0871' })).toBe(true);
      expect(isValidFlight({ ...flight, flightNumber: 'ABC1234A' })).toBe(true);
      expect(isValidFlight({ ...flight, flightNumber: '' })).toBe(true);
    });

    it('accepts a legitimate multi-line notes field (real textarea input)', () => {
      expect(isValidFlight({ ...flight, notes: 'ligne 1\nligne 2' })).toBe(true);
    });

    it('rejects notes containing NUL or ESC control characters', () => {
      expect(isValidFlight({ ...flight, notes: 'a\x00b' })).toBe(false);
      expect(isValidFlight({ ...flight, notes: 'a\x1bb' })).toBe(false);
    });

    it('rejects notes that is not a string', () => {
      expect(isValidFlight({ ...flight, notes: 123 })).toBe(false);
    });
  });

  describe('isValidResidenceDay', () => {
    it('rejects a date that is not YYYY-MM-DD', () => {
      expect(isValidResidenceDay({ date: '2026-5-1' })).toBe(false);
      expect(isValidResidenceDay({ date: '2026/05/01' })).toBe(false);
    });

    it('rejects a date with an embedded CRLF', () => {
      expect(isValidResidenceDay({ date: '2026-05-01\r\nX-EVIL:injected' })).toBe(false);
    });

    it('accepts the four known location values and null', () => {
      for (const loc of ['canada', 'mexico', 'international', 'transit', null]) {
        expect(isValidResidenceDay({ date: '2026-05-01', location: loc })).toBe(true);
      }
    });

    it('accepts an unknown-but-clean location string (residence.js "other" bucket is forward-compatible by design)', () => {
      expect(isValidResidenceDay({ date: '2026-05-01', location: 'some-future-location' })).toBe(true);
    });

    it('rejects a location containing control characters', () => {
      expect(isValidResidenceDay({ date: '2026-05-01', location: 'canada\r\nX-EVIL:injected' })).toBe(false);
    });

    it('rejects an over-long location', () => {
      expect(isValidResidenceDay({ date: '2026-05-01', location: 'x'.repeat(33) })).toBe(false);
    });

    it('accepts a legitimate multi-line notes field', () => {
      expect(isValidResidenceDay({ date: '2026-05-01', notes: 'hôtel\nvol de nuit' })).toBe(true);
    });

    it('rejects notes containing control characters other than newline', () => {
      expect(isValidResidenceDay({ date: '2026-05-01', notes: 'a\x00b' })).toBe(false);
    });
  });
});

describe('parseBackupJson — content hardening (M9)', () => {
  it('rejects a backup whose flight has a control-char (CRLF-injected) date', () => {
    const evilFlight = { id: 'f1', date: '2026-05-01\r\nX-EVIL:injected', flightNumber: 'AC871' };
    const text = JSON.stringify({ version: 1, exportDate: 'd', deviceId: 'dev', data: { flights: [evilFlight], residence: [] } });
    const { preview, error } = parseBackupJson(text);
    expect(preview).toBeUndefined();
    expect(error).toMatch(/invalid/i);
  });
});
