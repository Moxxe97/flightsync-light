import { describe, it, expect } from 'vitest';
import { csvEscape, icsEscape } from '../exportEscape';

describe('csvEscape', () => {
  it('neutralizes formula-injection prefixes', () => {
    expect(csvEscape('=HYPERLINK("evil")')).toBe(`"'=HYPERLINK(""evil"")"`);
    expect(csvEscape('+1')).toBe("'+1");
    expect(csvEscape('-2')).toBe("'-2");
    expect(csvEscape('@cmd')).toBe("'@cmd");
    expect(csvEscape('\tx')).toBe("'\tx");
  });
  it('quotes fields containing commas, quotes, newlines', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('l1\nl2')).toBe('"l1\nl2"');
  });
  it('passes plain values through and handles null/undefined/numbers', () => {
    expect(csvEscape('YUL')).toBe('YUL');
    expect(csvEscape(13.3)).toBe('13.3');
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });
});

describe('icsEscape', () => {
  it('escapes RFC-5545 TEXT specials', () => {
    expect(icsEscape('a;b,c\\d')).toBe('a\\;b\\,c\\\\d');
  });
  it('folds CRLF/CR/LF into literal \\n', () => {
    expect(icsEscape('l1\r\nl2\rl3\nl4')).toBe('l1\\nl2\\nl3\\nl4');
  });
  it('handles null/undefined', () => {
    expect(icsEscape(null)).toBe('');
  });
});
