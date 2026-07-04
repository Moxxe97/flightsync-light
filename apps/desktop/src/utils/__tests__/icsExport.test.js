import { describe, it, expect, vi } from 'vitest';
import { exportICS } from '../icsExport';

// exportICS is a side-effecting browser download (Blob + <a>.click()). Capture
// the Blob passed to URL.createObjectURL and stub the click so jsdom doesn't
// attempt a real navigation.
function captureExportedICS(flights) {
  let captured = null;
  const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    captured = blob;
    return 'blob:mock';
  });
  const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  exportICS(flights);
  clickSpy.mockRestore();
  createSpy.mockRestore();
  revokeSpy.mockRestore();
  return captured;
}

const validFlight = {
  id: 'f1',
  date: '2026-01-01',
  flightNumber: 'AC123',
  departure: 'YUL',
  arrival: 'YYZ',
  totalTime: 1.5,
  canadianTime: 1.5,
  distance: 300,
  canadianDistance: 300,
};

describe('exportICS', () => {
  it('exports a valid flight as a single VEVENT', async () => {
    const blob = captureExportedICS([validFlight]);
    const text = await blob.text();
    const veventCount = (text.match(/BEGIN:VEVENT/g) || []).length;
    expect(veventCount).toBe(1);
    expect(text).toContain('AC123');
    expect(text).toContain('DTSTART:20260101T080000Z');
  });

  it('skips a flight whose date embeds a CRLF-injected VEVENT (H4) and keeps the valid one', async () => {
    const craftedFlight = {
      id: 'f2',
      // Crafted date embeds a full forged VEVENT via CRLF — ICS lines are
      // CRLF-delimited, so an unescaped/unvalidated date can inject events.
      date: '2026-01-02\r\nBEGIN:VEVENT\r\nUID:evil@evil\r\nDTSTART:20200101T000000Z\r\nDTEND:20200101T010000Z\r\nSUMMARY:Injected\r\nEND:VEVENT',
      flightNumber: 'AC999',
      departure: 'XXX',
      arrival: 'YYY',
      totalTime: 1,
      canadianTime: 0,
      distance: 100,
      canadianDistance: 0,
    };

    const blob = captureExportedICS([validFlight, craftedFlight]);
    const text = await blob.text();

    const veventCount = (text.match(/BEGIN:VEVENT/g) || []).length;
    expect(veventCount).toBe(1); // only the valid flight — crafted one is skipped entirely
    expect(text).not.toContain('Injected');
    expect(text).not.toContain('evil@evil');
    expect(text).not.toContain('AC999');
    expect(text).toContain('AC123'); // valid export still works
  });
});
