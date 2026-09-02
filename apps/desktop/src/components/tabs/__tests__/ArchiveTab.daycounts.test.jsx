import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('../../../utils/useIsMobile', () => ({ useIsMobile: () => false }));

import ArchiveTab from '../ArchiveTab';

afterEach(cleanup);

// The archive tiles must use the same day counter as the Dashboard and the
// Calendar (tallyResidence): distinct dates, no-location rows untracked.
describe('ArchiveTab day counts', () => {
  it('counts distinct dates and ignores location-less rows', () => {
    const residence = [
      { date: '2025-06-01', location: 'mexico' },
      { date: '2025-06-01', location: 'mexico' }, // duplicate date
      { date: '2025-06-02', location: 'canada' },
      { date: '2025-06-03' },                    // no location: untracked
    ];
    const { container } = render(
      <ArchiveTab
        archiveYears={[{ year: '2025', flights: [], residence }]}
        expandedArchiveYear="2025"
        setExpandedArchiveYear={() => {}}
        onOpenYear={() => {}}
        onBackupToDrive={() => {}}
        onRestoreFromDrive={() => {}}
      />,
    );
    const text = container.textContent;
    const outside = text.match(/(\d+)OUTSIDE CA/);
    const canada = text.match(/(\d+)CA DAYS/);
    expect(outside && Number(outside[1])).toBe(1);
    expect(canada && Number(canada[1])).toBe(1);
  });
});
