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
    expect(error).toMatch(/invalide/i);
  });

  it('rejects a backup with junk flight rows', () => {
    const text = JSON.stringify({ version: 1, data: { flights: [flight, 'junk'], residence: [] } });
    expect(parseBackupJson(text).error).toMatch(/invalide/i);
  });

  it('rejects a backup with junk residence rows', () => {
    const text = JSON.stringify({ version: 1, data: { flights: [], residence: [{ notADate: 1 }] } });
    expect(parseBackupJson(text).error).toMatch(/invalide/i);
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
    expect(error).toMatch(/invalide/i);
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
