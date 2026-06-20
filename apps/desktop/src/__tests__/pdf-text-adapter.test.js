// @vitest-environment node
// Exercises the real pdfjs through our adapter — the only automated coverage
// of the getDocument path, which otherwise only runs live in the WebView
// (the reason the 3→4 bump was deferred in PR #30).
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Build a minimal one-page PDF with correct xref offsets, entirely in JS.
function makeMinimalPdf(text) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null, // stream object, built below
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return new TextEncoder().encode(pdf).buffer;
}

beforeAll(async () => {
  // The adapter sets workerSrc to '/pdf.worker.min.mjs' (a WebView URL) at
  // import time, so import it FIRST, then point pdfjs's fake-worker loader at
  // the real worker file for Node.
  await import('../../adapters/pdf-text-webkit.js');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const require = createRequire(import.meta.url);
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    require.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs'),
  ).href;
});

describe('pdf-text-webkit adapter on real pdfjs', () => {
  it('extracts text from a PDF', async () => {
    const { pdfTextWebkit } = await import('../../adapters/pdf-text-webkit.js');
    const { fullText, pageTexts } = await pdfTextWebkit(makeMinimalPdf('Hello FlightSync'));
    expect(pageTexts).toHaveLength(1);
    expect(fullText).toContain('Hello FlightSync');
  }, 20000);
});
