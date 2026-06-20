// ─── OFP Flight Plan Storage (IndexedDB) ─────────────────────
// Separate DB from boarding passes to avoid schema migration conflicts.
// One record per flight — keyPath is flightId.

const DB_NAME = 'flight-sync-ofp';
const DB_VERSION = 1;
const STORE = 'ofp-plans';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'flightId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Save (or overwrite) a trimmed OFP linked to a flight.
// data: Uint8Array — trimmed PDF bytes
export async function saveOFP(flightId, { date, flightNumber, fileName, data, pageCount }) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ flightId, date, flightNumber, fileName, data, pageCount, savedAt: new Date().toISOString() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// Retrieve the OFP record for a flight, or undefined if not stored.
export async function getOFP(flightId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(flightId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Returns the raw PDF bytes (Uint8Array) for a flight's OFP, or null if absent.
// Used by local consumers such as the Drive archive upload that needs the raw
// bytes without re-fetching from the network.
export async function getOFPBytes(flightId) {
  const rec = await getOFP(flightId);
  return rec?.data ?? null;
}

// Returns a Set of all flightIds that have a stored OFP.
export async function getAllOFPFlightIds() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAllKeys();
    req.onsuccess = () => resolve(new Set(req.result));
    req.onerror = () => reject(req.error);
  });
}
