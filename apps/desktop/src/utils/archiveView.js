// Pure helpers for the read-only "view a past year" mode.
//   viewYear === null    → live current year (editable)
//   viewYear === "2025"  → frozen archived year (read-only)
// `archiveYears` is App's loaded archive list: [{ year, flights, residence }].

export function selectDisplayData({ viewYear, flights, residence, archiveYears }) {
  if (!viewYear) {
    return { flights, residence, readOnly: false, year: null };
  }
  const found = (archiveYears || []).find((a) => a.year === viewYear);
  return {
    flights: found?.flights ?? [],
    residence: found?.residence ?? [],
    readOnly: true,
    year: viewYear,
  };
}

// Years available in the switcher, newest first, as strings.
export function archiveYearList(archiveYears) {
  return (archiveYears || [])
    .map((a) => a.year)
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a));
}

// Adjacent year for the prev/next banner controls.
// dir = -1 → older, dir = +1 → newer. Returns a year string or null at the ends.
export function adjacentYear(years, current, dir) {
  const asc = [...(years || [])].sort((a, b) => a.localeCompare(b));
  const i = asc.indexOf(current);
  if (i === -1) return null;
  const j = i + dir;
  if (j < 0 || j >= asc.length) return null;
  return asc[j];
}
