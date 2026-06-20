// Merge freshly-imported (parsed) flights into the existing flight list, keyed
// by date+flightNumber. On a match the EXISTING flight's id is preserved so the
// stored row is overwritten in place — never orphaned and then resurrected as a
// duplicate (which double-counts CRA hours). Pure; does not mutate its inputs.
//
//   mergeImportedFlights(existing, incoming, { timestamp, deviceId })
//     → { flights, added, updated, changed }
//
// `changed` is the subset of rows that were added or updated — push only these
// to the cloud, not the whole `flights` array, so an import never re-uploads an
// untouched flight another device deleted (resurrecting it).
export function mergeImportedFlights(existing, incoming, { timestamp, deviceId } = {}) {
  const flights = existing.map((f) => ({ ...f }));
  const changed = [];
  let added = 0;
  let updated = 0;
  for (const f of incoming) {
    const key = `${f.date}-${f.flightNumber}`;
    const idx = flights.findIndex((e) => `${e.date}-${e.flightNumber}` === key);
    const entry = { ...f, _lastModified: timestamp, _deviceId: deviceId };
    if (idx === -1) {
      flights.push(entry);
      changed.push(entry);
      added++;
    } else {
      // Keep the existing id; overlay the parsed fields + fresh sync metadata.
      const merged = { ...flights[idx], ...entry, id: flights[idx].id };
      flights[idx] = merged;
      changed.push(merged);
      updated++;
    }
  }
  return { flights, added, updated, changed };
}
