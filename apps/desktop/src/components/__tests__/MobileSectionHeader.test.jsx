// src/components/__tests__/MobileSectionHeader.test.jsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import MobileSectionHeader from '../MobileSectionHeader.jsx';

describe('MobileSectionHeader', () => {
  afterEach(() => cleanup());

  it('shows the section title', () => {
    render(<MobileSectionHeader title="Calendrier" onBack={() => {}} />);
    expect(screen.getByText('Calendrier')).toBeDefined();
  });

  it('calls onBack when the back control is clicked', () => {
    const onBack = vi.fn();
    render(<MobileSectionHeader title="Calendrier" onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: /retour/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
