import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  saveOFP, saveBoardingPass, getAllOFPFlightIds, getAllBoardingPassDates,
} from '@flightsync/core/idb';
import { listArchiveYears, saveYearToArchive } from '../archiveStore';
import { wipeLocalData } from '../wipeDevice';

// "Delete ALL data" (review of 2026-11-26) used to remove only the live flights,
// days and sync log: archived years, flight-plan PDFs, boarding passes and the
// pre-restore snapshot (a full copy of the old data) all stayed on the device.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
});

const flight = { id: 'f1', date: '2025-06-01', flightNumber: 'AC0871' };

async function seed() {
  await saveOFP('f1', { date: '2025-06-01', flightNumber: 'AC0871', fileName: 'ofp.pdf', data: new Uint8Array([1, 2]).buffer, pageCount: 1 });
  await saveBoardingPass('2025-06-01', new File([new Uint8Array(8)], 'bp.png', { type: 'image/png' }));
  await saveYearToArchive('2024', { flights: [{ ...flight, id: 'a1', date: '2024-03-01' }], residence: [] });
  localStorage.setItem('ac-flights-data', JSON.stringify([flight]));
  localStorage.setItem('ac-residence-data', JSON.stringify([{ date: '2025-06-01', location: 'canada' }]));
  localStorage.setItem('ac-sync-log', '[]');
  localStorage.setItem('ac-restore-undo', JSON.stringify({ flights: [flight] }));
  localStorage.setItem('ac-flights-archive-2023', JSON.stringify([flight])); // not yet migrated
  localStorage.setItem('ac-residence-archive-2023', '[]');
  localStorage.setItem('fsl-last-backup', '1700000000000');
  localStorage.setItem('ac-device-id', 'DEV-KEEPME1');
  localStorage.setItem('ac-sync-settings', JSON.stringify({ backupReminder: 14 }));
}

describe('wipeLocalData', () => {
  it('removes every flight, day, archived year, flight plan, boarding pass and the restore snapshot', async () => {
    await seed();
    const { failed } = await wipeLocalData();
    expect(failed).toEqual([]);
    expect((await getAllOFPFlightIds()).size).toBe(0);
    expect((await getAllBoardingPassDates()).size).toBe(0);
    expect(await listArchiveYears()).toEqual([]);
    for (const k of ['ac-flights-data', 'ac-residence-data', 'ac-sync-log', 'ac-restore-undo',
      'ac-flights-archive-2023', 'ac-residence-archive-2023', 'fsl-last-backup']) {
      expect(localStorage.getItem(k), k).toBeNull();
    }
  });

  it("keeps the device id (it names this device's Drive backup) and the settings", async () => {
    await seed();
    await wipeLocalData();
    expect(localStorage.getItem('ac-device-id')).toBe('DEV-KEEPME1');
    expect(JSON.parse(localStorage.getItem('ac-sync-settings'))).toEqual({ backupReminder: 14 });
  });

  it('works on a device that never stored anything', async () => {
    expect((await wipeLocalData()).failed).toEqual([]);
  });
});
