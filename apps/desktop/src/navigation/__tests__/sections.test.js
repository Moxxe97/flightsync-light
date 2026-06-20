// src/navigation/__tests__/sections.test.js
import { describe, it, expect } from 'vitest';
import { SECTIONS } from '../sections.js';

describe('SECTIONS', () => {
  it('lists the six sections in menu order', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual([
      'dashboard', 'calendar', 'backup', 'data', 'archive', 'history',
    ]);
  });

  it('every section has a label and an icon component', () => {
    for (const s of SECTIONS) {
      expect(typeof s.label).toBe('string');
      expect(s.label.length).toBeGreaterThan(0);
      expect(typeof s.icon).toBe('function');
    }
  });
});
