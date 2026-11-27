// "Delete ALL data": everything this device stores about the pilot's flying.
// Kept: the device id (it names this device's Drive backup file) and the
// settings (App.jsx clears settings.backupFolder itself, before calling this).
// Never touched: the backups on Google Drive and in the backup folder.
import { clearAllOFPs, clearAllBoardingPasses, clearAllArchiveYears } from '@flightsync/core/idb';
import { parseArchiveKey } from './archiveStore';

const DATA_KEYS = [
  'ac-flights-data',
  'ac-residence-data',
  'ac-sync-log',
  'ac-restore-undo', // full copy of the data from before the last Drive restore
  'fsl-last-backup',
];

function clearLocalStorageData() {
  for (const k of DATA_KEYS) localStorage.removeItem(k);
  // Archived years from before the IndexedDB migration, if any are left.
  const legacy = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k) => parseArchiveKey(k));
  for (const k of legacy) localStorage.removeItem(k);
}

// Every part is attempted even if an earlier one fails; returns the labels of
// the parts that could not be deleted, for the message shown to the pilot.
export async function wipeLocalData() {
  const parts = [
    ['flights and days', async () => clearLocalStorageData()],
    ['archived years', clearAllArchiveYears],
    ['flight plans (OFP PDFs)', clearAllOFPs],
    ['boarding passes', clearAllBoardingPasses],
  ];
  const failed = [];
  for (const [label, run] of parts) {
    try { await run(); } catch (err) {
      console.warn(`[delete-all] ${label}:`, err?.message || err);
      failed.push(label);
    }
  }
  return { failed };
}
