import { describe, it, expect } from 'vitest';
import * as core from '../src/index.js';

describe('@flightsync/core smoke', () => {
  it('loads without errors', () => {
    expect(core).toBeDefined();
  });
});
