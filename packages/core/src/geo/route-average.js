import { AIRPORTS } from '../data/airports.js';
import { haversineDistance, greatCircleCanadianDistance } from './distance.js';

function usableHistory(stored, dep, arr) {
  return stored.filter(f =>
    f.departure === dep &&
    f.arrival === arr &&
    typeof f.distance === 'number' &&
    f.distance > 0 &&
    typeof f.canadianDistance === 'number' &&
    f.canadianDistance >= 0
  );
}

export function estimateRoute(dep, arr, storedFlights) {
  const hits = usableHistory(storedFlights, dep, arr);
  if (hits.length > 0) {
    const avg = values =>
      Math.round(values.reduce((sum, n) => sum + n, 0) / values.length);
    return {
      distance: avg(hits.map(h => h.distance)),
      canadianDistance: avg(hits.map(h => h.canadianDistance)),
      source: 'history-avg',
    };
  }

  const depCoords = AIRPORTS[dep];
  const arrCoords = AIRPORTS[arr];
  if (!depCoords || !arrCoords) {
    return { distance: 0, canadianDistance: 0, source: 'unknown' };
  }

  const distance = Math.round(
    haversineDistance(depCoords.lat, depCoords.lon, arrCoords.lat, arrCoords.lon),
  );
  const canadianDistance = greatCircleCanadianDistance(
    depCoords.lat, depCoords.lon, arrCoords.lat, arrCoords.lon,
  );
  return { distance, canadianDistance, source: 'great-circle' };
}
