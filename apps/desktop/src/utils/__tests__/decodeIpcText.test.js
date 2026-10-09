import { describe, it, expect } from 'vitest';
import { decodeIpcText } from '../decodeIpcText';

const enc = (s) => new TextEncoder().encode(s);

describe('decodeIpcText', () => {
  it('decodes an ArrayBuffer from raw plugin:fs|read_text_file IPC (import regression)', () => {
    // Tauri 2.x returns file contents over the raw IPC as an ArrayBuffer,
    // never a string — the shape that broke JSON import ("Lecture du
    // fichier vide ou invalide") because it fell through undecoded.
    const buf = enc('{"version":3}').buffer;
    expect(decodeIpcText(buf)).toBe('{"version":3}');
  });

  it('passes a string through unchanged', () => {
    expect(decodeIpcText('{"a":1}')).toBe('{"a":1}');
  });

  it('decodes a Uint8Array', () => {
    expect(decodeIpcText(enc('héllo'))).toBe('héllo');
  });

  it('decodes a plain byte array (older IPC shape)', () => {
    expect(decodeIpcText(Array.from(enc('csv,data')))).toBe('csv,data');
  });

  it('decodes multi-byte UTF-8 intact', () => {
    expect(decodeIpcText(enc('Montréal ✈').buffer)).toBe('Montréal ✈');
  });

  it('returns an empty string for null/undefined/unknown payloads', () => {
    expect(decodeIpcText(null)).toBe('');
    expect(decodeIpcText(undefined)).toBe('');
    expect(decodeIpcText({ not: 'bytes' })).toBe('');
  });
});
