let _adapter = null;

/**
 * Register the platform-specific PDF text-extraction adapter.
 * The adapter must be a function: (input: ArrayBuffer | File) => Promise<{ fullText: string, pageTexts: string[] }>
 *
 * Desktop + Tauri Android (same apps/desktop build): pdfjs-dist legacy build
 * (apps/desktop/adapters/pdf-text-webkit.js), registered lazily in main.jsx.
 */
export function setPdfTextAdapter(adapter) {
  if (typeof adapter !== 'function') {
    throw new Error('pdf-text adapter must be a function');
  }
  _adapter = adapter;
}

export async function pdfToText(input) {
  if (!_adapter) {
    throw new Error('No pdf-text adapter registered. Call setPdfTextAdapter() at app startup.');
  }
  return _adapter(input);
}

// Test-only reset
export function _resetPdfTextAdapter() {
  _adapter = null;
}
