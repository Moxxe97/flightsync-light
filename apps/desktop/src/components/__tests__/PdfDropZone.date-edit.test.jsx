import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// The review table let any text into the date cell ("June 28"), and one such
// flight later made the whole backup unrestorable. The cell now only accepts a
// real YYYY-MM-DD date (one-digit parts are padded) and keeps the old value
// otherwise.
const { saveOFPSpy } = vi.hoisted(() => ({ saveOFPSpy: vi.fn(async () => {}) }));
vi.mock('../../utils/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@flightsync/core/idb', () => ({ saveOFP: saveOFPSpy }));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({
      numPages: 8,
      getPage: async () => ({ getTextContent: async () => ({ items: [{ str: 'AIR CANADA FLIGHT PLAN' }] }) }),
    }),
  })),
}));
vi.mock('pdf-lib', () => ({
  PDFDocument: {
    load: async () => ({ getPageCount: () => 8 }),
    create: async () => ({ copyPages: async () => [{}], addPage: () => {}, save: async () => new Uint8Array([1, 2, 3]) }),
  },
}));
const PARSED = vi.hoisted(() => ({
  id: 'pdf-AC0904-2026-06-28-0', date: '2026-06-28', flightNumber: 'AC0904', departure: 'YUL', arrival: 'FCO',
  totalTime: 8, canadianTime: 0.55, distance: 3558, canadianDistance: 246, notes: 'PDF OFP', _confidence: 100,
}));
vi.mock('@flightsync/core/parsing', async (importOriginal) => ({
  ...(await importOriginal()),
  processPdfFile: vi.fn(async (file) => ({ flights: [{ ...PARSED }], cutPageIndex: 7, rawTextPreview: '', fileName: file.name })),
}));

import PdfDropZone from '../PdfDropZone';

afterEach(cleanup);

async function openReview(notify, onImport = vi.fn()) {
  const { container } = render(<PdfDropZone onImport={onImport} notify={notify} storedFlights={[]} deviceId="DEV-TEST" />);
  const file = new File(['%PDF-1.4'], 'AC0904.pdf', { type: 'application/pdf' });
  if (!file.arrayBuffer) file.arrayBuffer = async () => new ArrayBuffer(8);
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
  await screen.findByText(/Import 1 flight/);
}
const dateCell = (text) => screen.getAllByText(text).find((el) => el.getAttribute('title') === 'Click to edit');
function typeDate(from, to) {
  fireEvent.click(dateCell(from));
  const input = screen.getByDisplayValue(from);
  fireEvent.change(input, { target: { value: to } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('PdfDropZone — date cell', () => {
  it('refuses a date it cannot read, keeps the parsed one and says why', async () => {
    const notify = vi.fn();
    await openReview(notify);
    typeDate('2026-06-28', 'June 28');
    expect(dateCell('2026-06-28')).toBeTruthy();
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/YYYY-MM-DD/), 'error');
  });

  it('pads a one-digit month or day and imports the corrected date', async () => {
    const onImport = vi.fn();
    await openReview(vi.fn(), onImport);
    typeDate('2026-06-28', '2026-6-29');
    expect(dateCell('2026-06-29')).toBeTruthy();
    fireEvent.click(screen.getByText(/Import 1 flight/));
    await waitFor(() => expect(onImport).toHaveBeenCalled());
    expect(onImport.mock.calls[0][0][0].date).toBe('2026-06-29');
  });
});
