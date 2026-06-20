import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ConfirmModal from '../ConfirmModal';

afterEach(cleanup);

const base = {
  open: true,
  title: 'Se déconnecter ?',
  message: 'Vos données locales sont conservées.',
  confirmLabel: 'Se déconnecter',
  cancelLabel: 'Annuler',
  onConfirm: () => {},
  onCancel: () => {},
};

describe('ConfirmModal', () => {
  it('renders the title, message, and both buttons when open', () => {
    render(<ConfirmModal {...base} />);
    expect(screen.getByText('Se déconnecter ?')).toBeTruthy();
    expect(screen.getByText('Vos données locales sont conservées.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeTruthy();
  });

  it('renders nothing when not open', () => {
    const { container } = render(<ConfirmModal {...base} open={false} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('button', { name: 'Se déconnecter' })).toBeNull();
  });

  it('calls onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(<ConfirmModal {...base} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when the cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmModal {...base} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when the overlay backdrop is clicked', () => {
    const onCancel = vi.fn();
    const { container } = render(<ConfirmModal {...base} onCancel={onCancel} />);
    fireEvent.click(container.firstChild); // the overlay
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
