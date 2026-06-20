import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const mobile = vi.hoisted(() => ({ value: false }));
vi.mock('../../utils/useIsMobile', () => ({ useIsMobile: () => mobile.value }));

import ReconciliationModal from '../ReconciliationModal';

afterEach(cleanup);

const missing = [{
  date: '2026-03-15', flightNumber: 'AC123', departure: 'YUL', arrival: 'YYZ',
  blockMinutes: 90, pairing: 'P1',
  estimate: { distance: 290, canadianDistance: 290, source: 'history-avg' },
}];
const props = {
  month: '2026-03', missing, matchedCount: 0, summaryCount: 1,
  onCancel: () => {}, onConfirm: () => {}, deviceId: 'DEV-TEST',
};

describe('ReconciliationModal row layout', () => {
  it('renders each flight as a grid row on desktop', () => {
    mobile.value = false;
    render(<ReconciliationModal {...props} />);
    const row = screen.getByText('AC123').closest('[data-testid="recon-row"]');
    expect(row).not.toBeNull();
    expect(row.style.display).toBe('grid');
  });

  it('stacks each flight into a column card on mobile', () => {
    mobile.value = true;
    render(<ReconciliationModal {...props} />);
    const row = screen.getByText('AC123').closest('[data-testid="recon-row"]');
    expect(row).not.toBeNull();
    expect(row.style.flexDirection).toBe('column');
  });
});
