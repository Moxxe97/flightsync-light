import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// A pay summary dropped in January covers a month whose flights the boot-time
// auto-archive has already moved out of the live list. Reconciling against the
// live list alone reported every one of them as "missing" and offered to add
// the whole month again (double-counting the archived year). The drop zone
// must reconcile against the archived flights too.
vi.mock('../../utils/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../../utils/tauriFs', () => ({ ensureFileRead: vi.fn(async () => {}) }));
vi.mock('@flightsync/core/idb', () => ({ saveOFP: vi.fn(async () => {}) }));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', async () => {
  const { SUMMARY_HEADER } = await vi.importActual('@flightsync/core/parsing');
  return {
    GlobalWorkerOptions: {},
    getDocument: vi.fn(() => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({ getTextContent: async () => ({ items: [{ str: SUMMARY_HEADER }] }) }),
      }),
    })),
  };
});
const ARCHIVED_LEG = { date: '2026-12-07', flightNumber: 'AC0900', departure: 'YUL', arrival: 'AMS', flightType: 'flown', blockMinutes: 398 };
vi.mock('@flightsync/core/parsing', async (importOriginal) => ({
  ...(await importOriginal()),
  parseFlightSummary: vi.fn(async () => ({ month: '2026-12', warnings: [], flights: [ARCHIVED_LEG] })),
}));

import PdfDropZone from '../PdfDropZone';

afterEach(cleanup);

function dropSummary(container) {
  const file = new File(['%PDF-1.4'], 'summary-dec.pdf', { type: 'application/pdf' });
  if (!file.arrayBuffer) file.arrayBuffer = async () => new ArrayBuffer(8);
  const input = container.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [file] } });
}

describe('PdfDropZone — pay summary vs archived flights', () => {
  it('treats a flight that only exists in an archived year as already logged', async () => {
    const { container } = render(
      <PdfDropZone
        onImport={vi.fn()}
        notify={vi.fn()}
        storedFlights={[]}
        archiveYears={[{ year: '2026', flights: [{ id: 'pdf-AC0900-2026-12-07-0', date: '2026-12-07', flightNumber: 'AC0900' }], residence: [] }]}
        deviceId="DEV-TEST"
      />,
    );
    dropSummary(container);
    expect(await screen.findByText(/No missing flights/)).toBeTruthy();
    expect(screen.queryByText(/to add/)).toBeNull();
  });
});
