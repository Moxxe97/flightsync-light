// CSV formula-injection guard + RFC-4180 quoting. Mirrors
// apps/mobile/src/utils/csv.ts so both apps neutralize the same prefixes.
export function csvEscape(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// RFC-5545 TEXT escaping: backslash first, then ; and , — newlines become \n.
export function icsEscape(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}
