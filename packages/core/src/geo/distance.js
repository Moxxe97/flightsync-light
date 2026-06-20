import { isInCanada } from './canada.js';

// Haversine great-circle distance in nautical miles.
const EARTH_RADIUS_NM = 3440.065;

export function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.sqrt(a));
}

// Intermediate point along a great circle, fraction f ∈ [0,1].
function greatCircleIntermediate(lat1, lon1, lat2, lon2, f) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const λ1 = toRad(lon1), λ2 = toRad(lon2);
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((φ2 - φ1) / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2
  ));
  if (d === 0) return [lat1, lon1];
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  const φ = Math.atan2(z, Math.sqrt(x * x + y * y));
  const λ = Math.atan2(y, x);
  return [toDeg(φ), toDeg(λ)];
}

// Approximate distance flown over Canada along the great-circle route,
// by walking in ~20 nm steps and testing midpoint membership in Canada.
export function greatCircleCanadianDistance(lat1, lon1, lat2, lon2) {
  const total = haversineDistance(lat1, lon1, lat2, lon2);
  if (total === 0) return 0;
  const stepNm = 20;
  const steps = Math.max(1, Math.ceil(total / stepNm));
  let canadian = 0;
  for (let i = 0; i < steps; i++) {
    const midF = (i + 0.5) / steps;
    const [lat, lon] = greatCircleIntermediate(lat1, lon1, lat2, lon2, midF);
    if (isInCanada(lat, lon)) canadian += total / steps;
  }
  return Math.round(canadian);
}
