// A backup must stay restorable: one hand-typed date or one long note used to
// make parseBackupJson reject the whole file, at the moment the pilot needed it.
// Rows are now repaired when the fix is certain (date format, note length, hours
// stored as text) and otherwise left out and listed — never accepted unchecked:
// every kept row still passes the M9 content checks. Archived years travel with
// the backup too.
import { describe, it, expect } from 'vitest';
import { parseBackupJson, toIsoDate, MAX_NOTES_LEN } from '../importValidation';

const flight = (o = {}) => ({ id: 'f1', date: '2026-05-01', flightNumber: 'AC0871', totalTime: 13.3, canadianTime: 4, ...o });
const drive = (o) => JSON.stringify({ schemaVersion: 1, exportedAt: '2026-11-20T10:00:00.000Z', flights: [], residence: [], settings: {}, ...o });
const exportFile = (data) => JSON.stringify({ version: '2.0.0', exportDate: '2026-11-20T10:00:00.000Z', deviceId: 'DEV-1', data });

describe('toIsoDate', () => {
  it('normalizes a year-month-day date written with one-digit parts or other separators', () => {
    expect(toIsoDate('2026-3-1')).toBe('2026-03-01');
    expect(toIsoDate(' 2026/03/01 ')).toBe('2026-03-01');
    expect(toIsoDate('2026.12.31')).toBe('2026-12-31');
    expect(toIsoDate('2028-02-29')).toBe('2028-02-29');
  });
  it('returns null for impossible or ambiguous dates', () => {
    expect(toIsoDate('2026-02-29')).toBeNull();
    expect(toIsoDate('2026-13-01')).toBeNull();
    expect(toIsoDate('1/3/2026')).toBeNull();
    expect(toIsoDate('first of March')).toBeNull();
    expect(toIsoDate('')).toBeNull();
    expect(toIsoDate(null)).toBeNull();
  });
});

describe('parseBackupJson — one bad row no longer blocks a restore', () => {
  it('repairs a hand-typed date and restores every row', () => {
    const { preview, error } = parseBackupJson(drive({ flights: [flight(), flight({ id: 'f2', date: '2026-3-1' })] }));
    expect(error).toBeUndefined();
    expect(preview.data.data.flights.map((f) => f.date)).toEqual(['2026-05-01', '2026-03-01']);
    expect(preview.repaired).toBe(1);
    expect(preview.skipped).toEqual([]);
  });

  it('leaves out a row whose date cannot be read, lists it, and restores the rest', () => {
    const { preview, error } = parseBackupJson(drive({
      flights: [flight(), flight({ id: 'f2', date: 'first of March', flightNumber: 'AC0051' })],
    }));
    expect(error).toBeUndefined();
    expect(preview.flights).toBe(1);
    expect(preview.data.data.flights.map((f) => f.id)).toEqual(['f1']);
    expect(preview.skipped).toHaveLength(1);
    expect(preview.skipped[0].label).toMatch(/AC0051/);
  });

  it('shortens a day note longer than the limit instead of rejecting the backup', () => {
    const { preview, error } = parseBackupJson(drive({
      residence: [{ date: '2026-05-02', location: 'canada', notes: 'a'.repeat(MAX_NOTES_LEN + 1) }],
    }));
    expect(error).toBeUndefined();
    expect(preview.data.data.residence[0].notes).toHaveLength(MAX_NOTES_LEN);
    expect(preview.repaired).toBe(1);
  });

  it('turns hours stored as text into numbers, so they count in the totals', () => {
    const { preview } = parseBackupJson(drive({ flights: [flight({ totalTime: '13.3', canadianTime: '4' })] }));
    expect(preview.data.data.flights[0].totalTime).toBe(13.3);
    expect(preview.data.data.flights[0].canadianTime).toBe(4);
  });

  it('still never accepts a control character in a field: that row is left out', () => {
    const { preview } = parseBackupJson(drive({
      flights: [flight(), flight({ id: 'f2', date: '2026-05-01\r\nBEGIN:VEVENT' })],
    }));
    expect(preview.data.data.flights.map((f) => f.id)).toEqual(['f1']);
    expect(preview.skipped).toHaveLength(1);
  });

  it('refuses a backup in which no row at all can be read, rather than restoring nothing over real data', () => {
    const { preview, error } = parseBackupJson(drive({ flights: ['junk', { date: 'x' }] }));
    expect(preview).toBeUndefined();
    expect(error).toMatch(/none of the 2 rows/i);
  });
});

describe('parseBackupJson — archived years', () => {
  const archives = [{
    year: '2025',
    flights: [flight({ id: 'a1', date: '2025-12-30' })],
    residence: [{ date: '2025-12-31', location: 'canada' }],
  }];

  it('reads archived years from a Drive backup', () => {
    const { preview } = parseBackupJson(drive({ flights: [flight()], archives }));
    expect(preview.data.data.archives).toEqual([{
      year: '2025',
      flights: [expect.objectContaining({ id: 'a1' })],
      residence: [expect.objectContaining({ date: '2025-12-31' })],
    }]);
    expect(preview.archivedYears).toBe(1);
    expect(preview.archivedFlights).toBe(1);
  });

  it('reads archived years from a JSON export file', () => {
    const { preview } = parseBackupJson(exportFile({ flights: [], residence: [], archives }));
    expect(preview.data.data.archives[0].year).toBe('2025');
  });

  it('a backup holding only archived years (January) is restorable', () => {
    const { preview, error } = parseBackupJson(drive({ archives }));
    expect(error).toBeUndefined();
    expect(preview.archivedFlights).toBe(1);
  });

  it('leaves out an archived year whose year is unreadable', () => {
    const { preview } = parseBackupJson(drive({
      flights: [flight()],
      archives: [...archives, { year: '20x5', flights: [], residence: [] }],
    }));
    expect(preview.data.data.archives.map((a) => a.year)).toEqual(['2025']);
    expect(preview.skipped).toHaveLength(1);
  });

  it('a backup made before archived years were included still parses, with none', () => {
    const { preview } = parseBackupJson(drive({ flights: [flight()] }));
    expect(preview.data.data.archives).toEqual([]);
    expect(preview.archivedYears).toBe(0);
  });
});
