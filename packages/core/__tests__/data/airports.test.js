import { describe, it, expect } from 'vitest';
import { AIRPORTS } from '../../src/data/airports.js';

describe('AIRPORTS', () => {
  it('has an entry for YUL with correct-ish coordinates', () => {
    expect(AIRPORTS.YUL).toBeDefined();
    expect(AIRPORTS.YUL.lat).toBeGreaterThan(45);
    expect(AIRPORTS.YUL.lat).toBeLessThan(46);
    expect(AIRPORTS.YUL.lon).toBeLessThan(-73);
    expect(AIRPORTS.YUL.lon).toBeGreaterThan(-74);
  });

  it('has an entry for DEL', () => {
    expect(AIRPORTS.DEL).toBeDefined();
    expect(AIRPORTS.DEL.lat).toBeGreaterThan(28);
    expect(AIRPORTS.DEL.lat).toBeLessThan(29);
  });

  it('has an entry for PUJ (Punta Cana)', () => {
    expect(AIRPORTS.PUJ).toBeDefined();
  });

  it('covers all Canadian hubs from CANADIAN_IATA', () => {
    const canadian = ['YUL','YVR','YYZ','YOW','YYC','YEG','YHZ','YWG','YQB','YXE','YYT'];
    for (const code of canadian) {
      expect(AIRPORTS[code], `missing coords for ${code}`).toBeDefined();
    }
  });

  it('returns undefined for unknown codes', () => {
    expect(AIRPORTS.XYZ).toBeUndefined();
  });
});
