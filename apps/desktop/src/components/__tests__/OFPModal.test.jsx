import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';

const destroySpy = vi.fn(async () => {});
const getPageSpy = vi.fn(async () => ({
  getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }),
  render: () => ({ promise: Promise.resolve() }),
  cleanup: () => {},
}));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({ numPages: 3, getPage: getPageSpy }),
    destroy: destroySpy,
  })),
}));
vi.mock('@flightsync/core/idb', () => ({
  getOFP: vi.fn(async () => ({ flightId: 'f1', flightNumber: 'AC871', fileName: 'ofp.pdf', pageCount: 3, data: new Uint8Array([1]) })),
}));

let ioInstances;
class MockIO {
  constructor(cb) { this.cb = cb; ioInstances.push(this); }
  observe(el) { this.el = el; }
  disconnect() { this.disconnected = true; }
  trigger() { this.cb([{ isIntersecting: true, target: this.el }]); }
}
beforeEach(() => {
  ioInstances = [];
  vi.stubGlobal('IntersectionObserver', MockIO);
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({}));
  HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new Blob(['x'], { type: 'image/png' })); };
  globalThis.URL.createObjectURL = vi.fn(() => `blob:mock-${Math.random()}`);
  globalThis.URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

import OFPModal from '../OFPModal';

describe('OFPModal lazy rendering (audit #27)', () => {
  it('mounts placeholders without rasterizing any page up front', async () => {
    await act(async () => { render(<OFPModal flightId="f1" onClose={() => {}} />); });
    expect(screen.getAllByLabelText(/^Page \d/)).toHaveLength(3);
    // only the page-1 sizing probe is allowed; no rasterization renders
    expect(getPageSpy.mock.calls.filter(([n]) => n !== 1)).toHaveLength(0);
    expect(document.querySelectorAll('img').length).toBe(0);
  });

  it('renders a page to an object URL when it intersects', async () => {
    await act(async () => { render(<OFPModal flightId="f1" onClose={() => {}} />); });
    await act(async () => { ioInstances[1].trigger(); });
    const imgs = document.querySelectorAll('img');
    expect(imgs.length).toBe(1);
    expect(imgs[0].src).toMatch(/^blob:/);
  });

  it('destroys the loading task and revokes URLs on unmount', async () => {
    let utils;
    await act(async () => { utils = render(<OFPModal flightId="f1" onClose={() => {}} />); });
    await act(async () => { ioInstances[0].trigger(); });
    await act(async () => { utils.unmount(); });
    expect(destroySpy).toHaveBeenCalled();
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalled();
  });
});
