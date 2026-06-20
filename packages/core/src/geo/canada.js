// Shared geography helpers: Canadian IATA codes, Canada polygon, point-in-polygon.

export const CANADIAN_IATA = new Set([
  'YUL','YVR','YYZ','YOW','YYC','YEG','YHZ','YWG','YQB','YXE','YYT',
]);

// [lon, lat] pairs — simplified southern boundary of Canadian airspace.
export const CANADA_POLY = [
  [-52.6,  47.0], [-53.5,  46.8], [-59.5,  46.0], [-60.5,  45.9],
  [-66.0,  44.0], [-67.0,  45.3], [-67.8,  47.1], [-69.2,  47.3],
  [-71.5,  45.0], [-74.7,  45.0], [-76.0,  44.0], [-79.2,  43.0],
  [-83.0,  41.7], [-83.5,  42.0], [-83.6,  46.0], [-84.5,  46.5],
  [-89.0,  48.0], [-95.2,  49.0], [-123.3, 49.0], [-124.7, 48.4],
  [-126.0, 50.5], [-130.0, 54.7], [-135.0, 59.0], [-141.0, 60.0],
  [-141.0, 84.0], [-60.0,  84.0], [-58.0,  82.0], [-60.0,  76.0],
  [-63.0,  72.0], [-64.5,  67.0], [-62.0,  62.0], [-57.0,  55.0],
  [-52.6,  47.0],
];

// Ray casting point-in-polygon: returns true if (lat, lon) is inside Canada.
export function isInCanada(lat, lon) {
  if (lat > 84 || lat < 41.5) return false;
  if (lon < -141.5 || lon > -50) return false;
  let inside = false;
  for (let i = 0, j = CANADA_POLY.length - 1; i < CANADA_POLY.length; j = i++) {
    const [xi, yi] = CANADA_POLY[i];
    const [xj, yj] = CANADA_POLY[j];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
