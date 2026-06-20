// ─── Boarding Pass Storage (IndexedDB) ────────────────────────
// Uses the same DB as iCloud handles but adds a 'boarding-passes' store.
// Version bumped to 2 to trigger onupgradeneeded for the new store.

const DB_NAME = 'flight-sync-idb';
const DB_VERSION = 2;
const BP_STORE = 'boarding-passes';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      // Keep existing 'handles' store if it exists
      if (!db.objectStoreNames.contains('handles')) {
        db.createObjectStore('handles');
      }
      // New store: key = auto-increment id, indexed by date
      if (!db.objectStoreNames.contains(BP_STORE)) {
        const store = db.createObjectStore(BP_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('date', 'date', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveBoardingPass(date, file) {
  const db = await openDB();
  const data = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BP_STORE, 'readwrite');
    const req = tx.objectStore(BP_STORE).add({
      date,
      fileName: file.name,
      fileType: file.type || 'application/octet-stream',
      data,
      savedAt: new Date().toISOString(),
    });
    req.onsuccess = () => resolve(req.result); // returns new id
    req.onerror = () => reject(req.error);
  });
}

export async function getBoardingPassesForDate(date) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BP_STORE, 'readonly');
    const index = tx.objectStore(BP_STORE).index('date');
    const req = index.getAll(date);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllBoardingPassDates() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BP_STORE, 'readonly');
    // Key-cursor on the date index: iterates keys only, never materializes
    // the record values (the image/PDF bytes) — audit #29.
    const req = tx.objectStore(BP_STORE).index('date').openKeyCursor();
    const dates = new Set();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) { dates.add(cursor.key); cursor.continue(); }
      else resolve(dates);
    };
    req.onerror = () => reject(req.error);
  });
}

// Returns unique { date, arrivalDate } pairs — one per departure date.
// arrivalDate is set when the flight crosses midnight (overnight) so
// the transit classification can be placed on the arrival day instead.
export async function getAllBoardingPassInfo() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BP_STORE, 'readonly');
    const req = tx.objectStore(BP_STORE).openCursor();
    const map = new Map(); // date → { date, arrivalDate }
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const { date, arrivalDate } = cursor.value;
        const existing = map.get(date);
        // Prefer the record that has arrivalDate (overnight flight) over one that doesn't
        if (!existing || (!existing.arrivalDate && arrivalDate)) {
          map.set(date, { date, arrivalDate: arrivalDate || null });
        }
        cursor.continue();
      } else {
        resolve(Array.from(map.values()));
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getAllBoardingPasses() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BP_STORE, 'readonly');
    const req = tx.objectStore(BP_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function updateBoardingPassData(id, arrayBuffer) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BP_STORE, 'readwrite');
    const store = tx.objectStore(BP_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (!record) { resolve(); return; }
      record.data = arrayBuffer;
      store.put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function deleteBoardingPassesForDate(date) {
  const db = await openDB();
  const passes = await new Promise((resolve, reject) => {
    const tx = db.transaction(BP_STORE, 'readonly');
    const req = tx.objectStore(BP_STORE).index('date').getAll(date);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  for (const bp of passes) {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(BP_STORE, 'readwrite');
      const req = tx.objectStore(BP_STORE).delete(bp.id);
      tx.oncomplete = resolve;
      req.onerror = () => reject(req.error);
    });
  }
}

// Returns the raw bytes (Uint8Array) for a boarding pass by id, or null if
// absent or the record has no binary data.
// Accepts both number and string ids — callers may pass string ids, but IDB's
// autoincrement keys are integers, so coerce here.
export async function getBoardingPassBytes(id) {
  const db = await openDB();
  const key = typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : id;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BP_STORE, 'readonly');
    const req = tx.objectStore(BP_STORE).get(key);
    req.onsuccess = () => {
      const rec = req.result;
      if (!rec || !rec.data) { resolve(null); return; }
      // Records store data as ArrayBuffer; normalize to Uint8Array for upload.
      resolve(rec.data instanceof Uint8Array ? rec.data : new Uint8Array(rec.data));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteBoardingPass(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BP_STORE, 'readwrite');
    const req = tx.objectStore(BP_STORE).delete(id);
    tx.oncomplete = resolve;
    req.onerror = () => reject(req.error);
  });
}

export function bpToObjectURL(bp) {
  if (!bp.data) return null;
  const blob = new Blob([bp.data], { type: bp.fileType });
  return URL.createObjectURL(blob);
}

