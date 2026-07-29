import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/path', () => ({ documentDir: vi.fn(async () => '/mock/Documents') }));

import { mobileBackupRoot } from '../mobileBackupRoot';

describe('mobileBackupRoot', () => {
  it('is a fixed subfolder of the app Documents dir', async () => {
    expect(await mobileBackupRoot()).toBe('/mock/Documents/FlightSync Light Backups');
  });
});
