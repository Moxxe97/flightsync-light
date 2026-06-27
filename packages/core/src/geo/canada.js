// Shared geography helpers: Canadian IATA codes, Canada polygon, point-in-polygon.

export const CANADIAN_IATA = new Set([
  'YUL','YVR','YYZ','YOW','YYC','YEG','YHZ','YWG','YQB','YXE','YYT',
]);

// [lon, lat] pairs — simplified boundary of Canadian sovereign territory.
// CRA basis = sovereign territory only (land + 12 nm territorial sea), no FIR.
//
// The eastern seaboard (Davis Strait → Labrador → Newfoundland) is derived
// from Natural Earth 50m coastline data: easternmost Canadian land per 1°
// latitude band, pushed 12 nm seaward, pulled back to stay ≥10 nm from
// Greenland in Nares Strait. Verified against all 3 539 NE coastal vertices
// in the region (none excluded) and all Greenland vertices (none included).
// The old hand-drawn edge bulged up to ~130 nm into the Labrador Sea and
// wrongly excluded St. John's/Cape Dyer while including NW Greenland.
export const CANADA_POLY = [
  [-53.85, 46.55], [-53.5,  46.8], [-59.5,  46.0], [-60.5,  45.9],
  // southern Nova Scotia: Atlantic coast + 12 nm — Cape Breton → Halifax →
  // Cape Sable → Yarmouth → SW New Brunswick (replaces the old straight chord
  // that cut across NS and scored Halifax/Yarmouth/Cape Sable OUT)
  [-60.0,  45.3], [-61.0,  44.9], [-62.2,  44.5], [-63.5,  44.2],
  [-64.4,  43.9], [-65.2,  43.5], [-65.9,  43.15], [-66.5,  43.6], [-66.9,  44.6],
  [-67.0,  45.3], [-67.8,  47.1], [-69.2,  47.3],
  [-71.5,  45.0], [-74.7,  45.0], [-76.0,  44.0], [-79.2,  43.0],
  [-83.0,  41.7], [-83.5,  42.0], [-83.6,  46.0], [-84.5,  46.5],
  [-89.0,  48.0], [-95.2,  49.0], [-123.3, 49.0],
  // BC / Pacific coast: coast + 12 nm — through Haro Strait / Juan de Fuca
  // (keeping the US San Juan Is + Cape Flattery out), up the west coast of
  // Vancouver Island, around Haida Gwaii (~100 nm offshore), back across Dixon
  // Entrance to Prince Rupert (replaces the old chord that ran inland of the coast)
  [-123.15, 48.65], [-123.30, 48.20], [-124.5,  48.42], [-125.2,  48.55],
  [-126.2,  49.05], [-127.4,  49.85], [-128.7,  50.75], [-130.0,  51.6],
  [-131.6,  51.85], [-133.3,  52.9], [-133.6,  53.7], [-133.3,  54.25],
  [-131.2,  54.45], [-130.6,  54.6],
  [-135.0, 59.0], [-141.0, 60.0],
  [-141.0, 84.0], [-60.0,  84.0],
  // eastern seaboard, north → south (coast + 12 nm)
  [-59.95, 82.47], [-63.43, 81.49], [-68.20, 80.42], [-72.19, 79.52],
  [-73.87, 78.54], [-77.11, 76.75], [-78.01, 76.11], [-78.63, 74.92],
  [-76.42, 73.45], [-74.63, 72.48], [-70.83, 71.46], [-67.76, 70.52],
  [-66.59, 69.80], [-66.11, 69.26], [-63.33, 67.57], [-60.80, 66.65],
  [-61.07, 66.37], [-62.89, 65.23], [-63.96, 63.71], [-63.99, 62.49],
  [-64.24, 60.51], [-63.36, 59.51], [-62.21, 58.47], [-61.29, 57.52],
  [-60.97, 57.01], [-59.84, 55.48], [-57.61, 54.88], [-57.06, 54.57],
  [-55.63, 53.47], [-55.42, 52.47], [-54.95, 52.00], [-55.14, 51.54],
  [-53.67, 49.66], [-52.72, 48.57], [-52.36, 47.55],
  // southern Avalon wrap: Cape Race, Cape Pine, St. Shotts corner
  [-52.87, 46.46], [-53.57, 46.43], [-53.85, 46.55],
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
