import { describe, it, expect } from 'vitest';
import { importKind } from '../importKind';

describe('importKind', () => {
  it('trusts a real .json extension', () => {
    expect(importKind('AC-FlightTracker-Backup-2026-10-09.json', 'not json at all')).toBe('json');
  });

  it('trusts .csv and .tsv extensions', () => {
    expect(importKind('flights.csv', '')).toBe('csv');
    expect(importKind('flights.tsv', '')).toBe('tsv');
  });

  it('sniffs JSON from an Android content:// URI (import regression)', () => {
    // Android's file picker returns the document URI, not a filename —
    // "content://com.android.providers.downloads.documents/document/1234"
    // has no usable extension, which made every mobile import bounce with
    // "format not supported".
    const uri = 'content://com.android.providers.downloads.documents/document/1234';
    expect(importKind(uri, '{"version":3,"data":{"flights":[]}}')).toBe('json');
    expect(importKind(uri, '﻿\n  [{"date":"2026-01-01"}]')).toBe('json');
  });

  it('sniffs CSV and TSV from a content URI', () => {
    const uri = 'content://media/external/file/99';
    expect(importKind(uri, 'Date,Flight,Departure\n2026-01-01,AC878,YUL')).toBe('csv');
    expect(importKind(uri, 'Date\tFlight\tDeparture\n2026-01-01\tAC878\tYUL')).toBe('tsv');
  });

  it('returns null for unsupported extensionless content', () => {
    expect(importKind('content://docs/5', '%PDF-1.7 binary stuff')).toBe(null);
    expect(importKind('content://docs/6', '')).toBe(null);
  });

  it('still rejects wrong real extensions', () => {
    expect(importKind('notes.pdf', '{"a":1}')).toBe(null);
  });
});
