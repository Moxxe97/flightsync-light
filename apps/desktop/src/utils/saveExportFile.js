// Platform-aware export saver. The blob+<a download> idiom only works where a
// real browser download manager exists (desktop WebView / plain browser); the
// Tauri mobile WebViews silently drop it while the UI reports success. Route:
//   desktop/browser → anchor download            → { location: 'browser' }
//   Tauri Android   → save_export_file command   → { location: 'downloads', path }
//                     (Kotlin DownloadsPlugin → public MediaStore Downloads)
//   Tauri iOS       → plugin-fs app Documents    → { location: 'documents', path }
//                     (user-visible in the Files app via UIFileSharingEnabled)
import { getPlatform } from './platform';

const isTauri = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

function browserDownload(fileName, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// Chunked to stay under the argument limit of String.fromCharCode.apply.
function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

// `content` may be a string (CSV / ICS / JSON) or a Uint8Array (ZIP).
export async function saveExportFile(fileName, content, mime) {
  const isBinary = content instanceof Uint8Array;
  if (isTauri()) {
    const platform = await getPlatform();
    if (platform === 'android') {
      const { invoke } = await import('@tauri-apps/api/core');
      const args = isBinary
        ? { fileName, mime, contentsB64: toBase64(content) }
        : { fileName, mime, contents: content };
      const path = await invoke('save_export_file', args);
      return { location: 'downloads', path };
    }
    if (platform === 'ios') {
      const { writeFile, writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      if (isBinary) await writeFile(fileName, content, { baseDir: BaseDirectory.Document });
      else await writeTextFile(fileName, content, { baseDir: BaseDirectory.Document });
      return { location: 'documents', path: fileName };
    }
  }
  browserDownload(fileName, content, mime);
  return { location: 'browser' };
}
