// @vitest-environment node
// Boot must not import the parsing barrel (it pulls luxon + tz-lookup +
// transitively the pdfjs adapter into the first paint, audit #28), and the
// lazily-registered adapter must still satisfy pdfToText.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { setPdfTextAdapter, pdfToText, _resetPdfTextAdapter } from '@flightsync/core/parsing/pdf-text';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('boot graph (audit #28)', () => {
  it('main.jsx does not statically import the parsing barrel or the adapter', () => {
    const src = readFileSync(resolve(__dirname, '../main.jsx'), 'utf8');
    expect(src).not.toMatch(/from '@flightsync\/core\/parsing'/);
    expect(src).not.toMatch(/^import .*pdf-text-webkit/m); // only dynamic import() allowed
    expect(src).toMatch(/@flightsync\/core\/parsing\/pdf-text/);
  });

  it('a lazy adapter resolves through pdfToText', async () => {
    _resetPdfTextAdapter();
    setPdfTextAdapter(async (input) => ({ fullText: `got:${input}`, pageTexts: [] }));
    const out = await pdfToText('x');
    expect(out.fullText).toBe('got:x');
  });
});
