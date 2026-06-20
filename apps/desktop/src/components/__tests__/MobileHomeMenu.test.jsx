// src/components/__tests__/MobileHomeMenu.test.jsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import MobileHomeMenu from '../MobileHomeMenu.jsx';

const Dot = () => <svg data-testid="icon" />;
const sections = [
  { id: 'dashboard', label: 'Tableau de Bord', subtitle: 'Résumé', icon: Dot },
  { id: 'calendar', label: 'Calendrier', subtitle: 'Jours', icon: Dot },
];

describe('MobileHomeMenu', () => {
  afterEach(() => cleanup());

  it('renders one button per section, in order, with labels', () => {
    render(<MobileHomeMenu sections={sections} onSelect={() => {}} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toContain('Tableau de Bord');
    expect(buttons[1].textContent).toContain('Calendrier');
  });

  it('calls onSelect with the section id when a row is clicked', () => {
    const onSelect = vi.fn();
    render(<MobileHomeMenu sections={sections} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Calendrier'));
    expect(onSelect).toHaveBeenCalledWith('calendar');
  });
});
