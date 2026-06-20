import { describe, it, expect, beforeEach } from 'vitest';
import { setPdfTextAdapter, pdfToText, _resetPdfTextAdapter } from '../../src/parsing/pdf-text.js';

describe('pdf-text adapter', () => {
  beforeEach(() => _resetPdfTextAdapter());

  it('throws if no adapter is registered', async () => {
    await expect(pdfToText(new ArrayBuffer(0))).rejects.toThrow(/No pdf-text adapter registered/);
  });

  it('calls the registered adapter and returns its result', async () => {
    const fake = async () => ({ fullText: 'hello', pageTexts: ['hello'] });
    setPdfTextAdapter(fake);
    const result = await pdfToText(new ArrayBuffer(0));
    expect(result).toEqual({ fullText: 'hello', pageTexts: ['hello'] });
  });

  it('throws when given non-function adapter', () => {
    expect(() => setPdfTextAdapter(42)).toThrow(/must be a function/);
  });
});
