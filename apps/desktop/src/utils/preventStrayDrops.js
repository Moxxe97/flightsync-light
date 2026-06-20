// Stray drag-and-drop guard (audit C2).
//
// Tauri's native drag-drop is disabled (tauri.conf.json `dragDropEnabled: false`),
// so file drops fall through to WKWebView's default handler. A file dropped
// OUTSIDE the PdfDropZone would otherwise navigate the WebView to that file
// (file:// URL), replacing the running app.
//
// These window listeners only call preventDefault() — which suppresses the
// browser's default navigation — and NOT stopPropagation(). preventDefault is
// not the same as stopPropagation, so React's synthetic drop/dragover handlers
// on PdfDropZone still fire normally and the dropzone keeps working.

export function installStrayDropGuard(target = window) {
  const onDragOver = (e) => e.preventDefault();
  const onDrop = (e) => e.preventDefault();
  target.addEventListener('dragover', onDragOver);
  target.addEventListener('drop', onDrop);
  return () => {
    target.removeEventListener('dragover', onDragOver);
    target.removeEventListener('drop', onDrop);
  };
}
