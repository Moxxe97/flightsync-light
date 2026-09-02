import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// An OFP dropped for a flight that already exists (e.g. added earlier from a
// pay summary under id f-<date>-<fn>) is merged INTO that row, which keeps its
// id. The PDF bytes must therefore be saved under that existing id — saving
// them under the freshly parsed pdf-… id orphans the PDF: the viewer says the
// flight plan is missing, re-score skips the flight, and backups/archives omit
// the file.
const { saveOFPSpy, syncOFPSpy } = vi.hoisted(() => ({ saveOFPSpy: vi.fn(async () => {}), syncOFPSpy: vi.fn(async () => {}) }));
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

describe('PdfDropZone — OFP saved under the id of the row it merges into', () => {
  it('keys the stored PDF by the existing summary-first flight id, not the parsed id', async () => {
    const onImport = vi.fn();
    const { container } = render(
      <PdfDropZone
        onImport={onImport}
        notify={vi.fn()}
        storedFlights={[{ id: 'f-2026-06-28-ac0904', date: '2026-06-28', flightNumber: 'AC0904', totalTime: 7.72 }]}
        deviceId="DEV-TEST"
      />,
    );
    const file = new File(['%PDF-1.4'], 'AC0904 28 YUL-FCO.pdf', { type: 'application/pdf' });
    if (!file.arrayBuffer) file.arrayBuffer = async () => new ArrayBuffer(8);
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });

    fireEvent.click(await screen.findByText(/Import 1 flight/));

    await waitFor(() => expect(onImport).toHaveBeenCalled());
    expect(saveOFPSpy).toHaveBeenCalledTimes(1);
    expect(saveOFPSpy.mock.calls[0][0]).toBe('f-2026-06-28-ac0904');

    expect(onImport.mock.calls[0][0][0]).toMatchObject({ date: '2026-06-28', flightNumber: 'AC0904' });
  });
});
