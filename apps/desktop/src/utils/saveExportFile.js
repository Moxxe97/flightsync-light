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

export async function saveExportFile(fileName, content, mime) {
  if (isTauri()) {
    const platform = await getPlatform();
    if (platform === 'android') {
      const { invoke } = await import('@tauri-apps/api/core');
      const path = await invoke('save_export_file', { fileName, mime, contents: content });
      return { location: 'downloads', path };
    }
    if (platform === 'ios') {
      const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      await writeTextFile(fileName, content, { baseDir: BaseDirectory.Document });
      return { location: 'documents', path: fileName };
    }
  }
  browserDownload(fileName, content, mime);
  return { location: 'browser' };
}
