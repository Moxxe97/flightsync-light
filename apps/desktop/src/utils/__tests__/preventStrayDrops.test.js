import { describe, it, expect, afterEach } from 'vitest';
import { installStrayDropGuard } from '../preventStrayDrops.js';

describe('installStrayDropGuard (audit C2)', () => {
  let cleanup;
  afterEach(() => { if (cleanup) cleanup(); cleanup = undefined; });

  it('prevents default on a stray drop at the window level', () => {
    cleanup = installStrayDropGuard(window);
    const drop = new Event('drop', { cancelable: true, bubbles: true });
    window.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
  });

  it('prevents default on dragover at the window level', () => {
    cleanup = installStrayDropGuard(window);
    const dragover = new Event('dragover', { cancelable: true, bubbles: true });
    window.dispatchEvent(dragover);
    expect(dragover.defaultPrevented).toBe(true);
  });

  it('does not stop propagation, so a dropzone listener still receives the drop', () => {
    cleanup = installStrayDropGuard(window);
    // Simulate the PdfDropZone: a child element with its own drop handler that
    // calls preventDefault. The guard must not swallow the event before it
    // reaches the child (preventDefault !== stopPropagation).
    const zone = document.createElement('div');
    document.body.appendChild(zone);
    let zoneHandlerRan = false;
    zone.addEventListener('drop', (e) => { zoneHandlerRan = true; e.preventDefault(); });

    const drop = new Event('drop', { cancelable: true, bubbles: true });
    zone.dispatchEvent(drop);

    expect(zoneHandlerRan).toBe(true);
    expect(drop.defaultPrevented).toBe(true);
    document.body.removeChild(zone);
  });

  it('cleanup removes the listeners', () => {
    const off = installStrayDropGuard(window);
    off();
    const drop = new Event('drop', { cancelable: true, bubbles: true });
    window.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(false);
  });
});
