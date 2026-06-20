// ─── Per-year Archive Storage (IndexedDB) ────────────────────
// Dedicated DB so it never collides with the OFP / boarding-pass schemas.
// One record per year — keyPath is the 4-digit year string.
// Record: { year, flights, residence, manifest, archivedAt }

const DB_NAME = 'flight-sync-archive';
const DB_VERSION = 1;
const STORE = 'years';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'year' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Save (or overwrite) a year's archive record.
export async function saveArchiveYear(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// Get one year's record, or undefined.
export async function getArchiveYear(year) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(year);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Get all year records (unordered).
export async function getAllArchiveYears() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// Delete a year's record.
export async function deleteArchiveYear(year) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(year);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
