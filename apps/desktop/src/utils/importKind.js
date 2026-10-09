// Decide how to parse an imported file: 'json' | 'csv' | 'tsv' | null.
//
// A real file extension is authoritative. But Android's file picker
// (tauri-plugin-dialog) returns the DOCUMENT URI, not a filename —
// "content://com.android.providers.downloads.documents/document/1234" —
// so there is often no extension at all. In that case sniff the content:
// a backup is JSON (starts with { or [), a spreadsheet export starts with
// a header line whose separator tells CSV from TSV.
export function importKind(filename, text) {
  const base = String(filename || '').split(/[/\\]/).pop();
  const ext = base.includes('.') ? base.split('.').pop().toLowerCase() : '';
  if (ext === 'json' || ext === 'csv' || ext === 'tsv') return ext;
  if (ext) return null; // a real but unsupported extension stays rejected

  const head = String(text || '').replace(/^\uFEFF/, '').trimStart();
  if (head.startsWith('{') || head.startsWith('[')) return 'json';
  const firstLine = head.split('\n', 1)[0] || '';
  if (firstLine.includes('\t')) return 'tsv';
  if (firstLine.includes(',')) return 'csv';
  return null;
}
