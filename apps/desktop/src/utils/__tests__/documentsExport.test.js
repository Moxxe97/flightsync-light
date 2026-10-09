import { describe, it, expect } from 'vitest';
import { documentYears, buildDocumentsPlan } from '../documentsExport';

const ofpMetas = [
  { flightId: 'f1', date: '2025-03-14', flightNumber: 'AC878' },
  { flightId: 'f2', date: '2025-07-02', flightNumber: 'AC879' },
  { flightId: 'f3', date: '2026-01-10', flightNumber: 'AC848' },
];
const bps = [
  { id: 7, date: '2025-03-14', fileName: 'pass.jpeg', fileType: 'image/jpeg' },
  { id: 9, date: '2025-03-14', fileName: 'IMG_0042.PNG', fileType: 'image/png' },
  { id: 11, date: '2026-01-10', fileName: 'bp.pdf', fileType: 'application/pdf' },
];
const flights = [
  { id: 'f1', date: '2025-03-14', flightNumber: 'AC878', departure: 'YUL', arrival: 'CDG' },
  { id: 'f2', date: '2025-07-02', flightNumber: 'AC879', departure: 'CDG', arrival: 'YUL' },
  { id: 'f3', date: '2026-01-10', flightNumber: 'AC848', departure: 'YUL', arrival: 'LHR' },
];

describe('documentYears', () => {
  it('collects distinct years from OFPs and passes, newest first', () => {
    expect(documentYears({ ofpMetas, bps })).toEqual(['2026', '2025']);
  });

  it('is empty with no documents', () => {
    expect(documentYears({ ofpMetas: [], bps: [] })).toEqual([]);
  });
});

describe('buildDocumentsPlan', () => {
  it('selects only the chosen year and names files by date and flight', () => {
    const plan = buildDocumentsPlan('2025', { ofpMetas, bps, flights });
    expect(plan.zipName).toBe('FlightSync-Documents-2025.zip');
    expect(plan.ofps).toEqual([
      { flightId: 'f1', path: 'ofps/2025-03-14-AC878.pdf' },
      { flightId: 'f2', path: 'ofps/2025-07-02-AC879.pdf' },
    ]);
    expect(plan.passes).toEqual([
      { id: 7, path: 'boarding-passes/2025-03-14-1.jpg' },
      { id: 9, path: 'boarding-passes/2025-03-14-2.png' },
    ]);
  });

  it('disambiguates two OFPs with the same date and flight number', () => {
    const metas = [
      { flightId: 'a', date: '2025-05-01', flightNumber: 'AC100' },
      { flightId: 'b', date: '2025-05-01', flightNumber: 'AC100' },
    ];
    const plan = buildDocumentsPlan('2025', { ofpMetas: metas, bps: [], flights: [] });
    expect(plan.ofps.map((o) => o.path)).toEqual([
      'ofps/2025-05-01-AC100.pdf',
      'ofps/2025-05-01-AC100-2.pdf',
    ]);
  });

  it('sanitizes hostile characters out of file names', () => {
    const metas = [{ flightId: 'x', date: '2025-05-01', flightNumber: 'AC/10 0*' }];
    const plan = buildDocumentsPlan('2025', { ofpMetas: metas, bps: [], flights: [] });
    expect(plan.ofps[0].path).toBe('ofps/2025-05-01-AC100.pdf');
  });

  it('writes a manifest with counts and per-file flight details', () => {
    const plan = buildDocumentsPlan('2025', { ofpMetas, bps, flights });
    expect(plan.manifest).toContain('FlightSync Light — flight documents for 2025');
    expect(plan.manifest).toContain('2 flight plans (OFP), 2 boarding passes');
    expect(plan.manifest).toContain('ofps/2025-03-14-AC878.pdf');
    expect(plan.manifest).toContain('AC878 YUL-CDG');
    expect(plan.manifest).toContain('boarding-passes/2025-03-14-1.jpg');
  });

  it('falls back to a bin extension for unknown pass types', () => {
    const weird = [{ id: 1, date: '2025-02-02', fileName: 'blob', fileType: 'application/x-thing' }];
    const plan = buildDocumentsPlan('2025', { ofpMetas: [], bps: weird, flights: [] });
    expect(plan.passes[0].path).toBe('boarding-passes/2025-02-02-1.bin');
  });
});
