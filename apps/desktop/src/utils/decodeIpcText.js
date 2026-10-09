// Raw Tauri IPC (`window.__TAURI_INTERNALS__.invoke`) returns file contents
// from `plugin:fs|read_text_file` as BYTES — an ArrayBuffer on Tauri 2.x,
// a number[] on older builds — never a string. The @tauri-apps/plugin-fs JS
// wrapper is what decodes them; code that bypasses the wrapper (we do for the
// import picker, because the dialog plugin's JS package isn't bundled) must
// decode here or the payload falls through to parseBackupJson undecoded and
// the import dies with "Lecture du fichier vide ou invalide".
// instanceof is realm-sensitive (an ArrayBuffer minted by another realm — a
// plugin iframe, a test VM — fails `instanceof ArrayBuffer` here), and a
// realm-fragile type check is exactly what caused the original import bug.
function isArrayBuffer(v) {
  return v instanceof ArrayBuffer || Object.prototype.toString.call(v) === '[object ArrayBuffer]';
}

export function decodeIpcText(raw, encoding = 'utf-8') {
  if (typeof raw === 'string') return raw;
  if (isArrayBuffer(raw) || ArrayBuffer.isView(raw)) {
    return new TextDecoder(encoding).decode(raw);
  }
  if (Array.isArray(raw)) {
    return new TextDecoder(encoding).decode(new Uint8Array(raw));
  }
  return '';
}
