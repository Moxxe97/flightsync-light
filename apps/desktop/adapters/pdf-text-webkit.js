// Legacy build on purpose: minimumSystemVersion 13.0 → Safari-16 WKWebView,
// which lacks Promise.withResolvers required by the modern pdfjs-4 build.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// Worker served as a static file from public/ (pdfjs-dist v4 legacy)
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

/**
 * WebKit-side pdfjs adapter. Accepts a File or ArrayBuffer.
 * Returns { fullText, pageTexts } — same shape as the previous pdfToText.
 */
export async function pdfTextWebkit(input) {
  const buffer = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
  // isEvalSupported: false neutralizes CVE-2024-4367 (defense-in-depth; the CSP
  // also blocks eval). See OFPModal for context.
  const doc = await pdfjs.getDocument({ data: buffer, isEvalSupported: false }).promise;
  const pageTexts = [];
  const pagesToRead = Math.min(doc.numPages, 15);
  for (let i = 1; i <= pagesToRead; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pageTexts.push(content.items.map(item => item.str).join(' '));
  }
  return { fullText: pageTexts.join('\n'), pageTexts };
}
