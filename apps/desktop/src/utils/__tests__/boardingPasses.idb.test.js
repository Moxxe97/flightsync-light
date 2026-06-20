import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { saveBoardingPass, getAllBoardingPassDates } from '@flightsync/core/idb';

// Fresh IndexedDB per test.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory(); // pristine in-memory IndexedDB per test (no open-connection blocking)
});

describe('getAllBoardingPassDates (key-cursor, audit #29)', () => {
  it('returns the unique set of dates without materializing record values', async () => {
    await saveBoardingPass('2025-06-01', new File([new Uint8Array(64)], 'a.png', { type: 'image/png' }));
    await saveBoardingPass('2025-06-01', new File([new Uint8Array(64)], 'b.png', { type: 'image/png' }));
    await saveBoardingPass('2025-06-09', new File([new Uint8Array(64)], 'c.png', { type: 'image/png' }));

    const dates = await getAllBoardingPassDates();
    expect(dates).toBeInstanceOf(Set);
    expect(dates).toEqual(new Set(['2025-06-01', '2025-06-09']));
  });

  it('returns an empty Set when no boarding passes exist', async () => {
    expect(await getAllBoardingPassDates()).toEqual(new Set());
  });
});
