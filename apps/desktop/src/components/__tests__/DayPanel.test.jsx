import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('@flightsync/core/idb', () => ({
  getBoardingPassesForDate: vi.fn(async () => []),
  saveBoardingPass: vi.fn(async () => 1),
  deleteBoardingPass: vi.fn(async () => {}),
  bpToObjectURL: vi.fn(() => 'blob:fake'),
}));

import * as idb from '@flightsync/core/idb';
import DayPanel from '../DayPanel';

beforeEach(() => { vi.clearAllMocks(); cleanup(); });

const baseProps = {
  date: '2026-03-15',
  entry: null,
  readOnly: false,
  onSaveDay: vi.fn(),
  onOpenPass: vi.fn(),
  onPassesChanged: vi.fn(),
  onClose: vi.fn(),
};

describe('DayPanel', () => {
  it('1. renders the three sections', async () => {
    render(<DayPanel {...baseProps} />);
    await waitFor(() => expect(idb.getBoardingPassesForDate).toHaveBeenCalledWith('2026-03-15'));
    expect(screen.getByText('CLASSIFICATION')).toBeTruthy();
    expect(screen.getByText('BOARDING PASS')).toBeTruthy();
    expect(screen.getByText('NOTES')).toBeTruthy();
  });

  it('2. classification click saves immediately and keeps the panel open', async () => {
    const onSaveDay = vi.fn();
    const onClose = vi.fn();
    render(<DayPanel {...baseProps} onSaveDay={onSaveDay} onClose={onClose} />);
    await waitFor(() => expect(idb.getBoardingPassesForDate).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Mexique/i }));

    expect(onSaveDay).toHaveBeenCalledWith('2026-03-15', { location: 'mexico', notes: '' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('3. Effacer saves a null location', async () => {
    const onSaveDay = vi.fn();
    render(<DayPanel {...baseProps} entry={{ date: '2026-03-15', location: 'canada' }} onSaveDay={onSaveDay} />);
    await waitFor(() => expect(idb.getBoardingPassesForDate).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /^Effacer$/i }));

    expect(onSaveDay).toHaveBeenCalledWith('2026-03-15', { location: null, notes: '' });
  });

  it('4. closing saves the typed note with the current location', async () => {
    const onSaveDay = vi.fn();
    const onClose = vi.fn();
    render(<DayPanel
      {...baseProps}
      entry={{ date: '2026-03-15', location: 'transit', notes: '' }}
      onSaveDay={onSaveDay}
      onClose={onClose}
    />);
    await waitFor(() => expect(idb.getBoardingPassesForDate).toHaveBeenCalled());

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'YUL-CDG, hôtel Mercure' } });
    fireEvent.click(screen.getByRole('button', { name: /Fermer/i }));

    expect(onSaveDay).toHaveBeenCalledWith('2026-03-15', { location: 'transit', notes: 'YUL-CDG, hôtel Mercure' });
    expect(onClose).toHaveBeenCalled();
  });

  it('5. closing with nothing changed does not save', async () => {
    const onSaveDay = vi.fn();
    const onClose = vi.fn();
    render(<DayPanel
      {...baseProps}
      entry={{ date: '2026-03-15', location: 'canada', notes: 'déjà là' }}
      onSaveDay={onSaveDay}
      onClose={onClose}
    />);
    await waitFor(() => expect(idb.getBoardingPassesForDate).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Fermer/i }));

    expect(onSaveDay).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('6. lists existing passes and deletes one', async () => {
    idb.getBoardingPassesForDate.mockResolvedValue([
      { id: 7, date: '2026-03-15', fileName: 'bp.pdf', fileType: 'application/pdf', data: new ArrayBuffer(1) },
    ]);
    const onPassesChanged = vi.fn();
    render(<DayPanel {...baseProps} onPassesChanged={onPassesChanged} />);

    await screen.findByText(/bp\.pdf/);

    fireEvent.click(screen.getByTitle('Supprimer'));

    await waitFor(() => expect(idb.deleteBoardingPass).toHaveBeenCalledWith(7));
    expect(onPassesChanged).toHaveBeenCalled();
  });

  it('7. uploads a new pass via the file input', async () => {
    const onPassesChanged = vi.fn();
    render(<DayPanel {...baseProps} onPassesChanged={onPassesChanged} />);
    await waitFor(() => expect(idb.getBoardingPassesForDate).toHaveBeenCalled());

    const file = new File(['x'], 'carte.pdf', { type: 'application/pdf' });
    const input = document.querySelector('input[type="file"]');
    expect(input).not.toBeNull();

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(idb.saveBoardingPass).toHaveBeenCalledWith('2026-03-15', file));
    expect(onPassesChanged).toHaveBeenCalled();
  });

  it('shows an error when saving a pass fails', async () => {
    idb.saveBoardingPass.mockRejectedValueOnce(new Error('quota'));
    render(<DayPanel {...baseProps} />);
    const file = new File(['x'], 'carte.pdf', { type: 'application/pdf' });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });
    await screen.findByText(/Erreur boarding pass/);
    expect(baseProps.onPassesChanged).not.toHaveBeenCalled();
  });

  it('8. readOnly hides every edit affordance', async () => {
    const onSaveDay = vi.fn();
    const onClose = vi.fn();
    render(<DayPanel
      {...baseProps}
      entry={{ date: '2026-03-15', location: 'canada', notes: 'archive' }}
      readOnly={true}
      onSaveDay={onSaveDay}
      onClose={onClose}
    />);
    await waitFor(() => expect(idb.getBoardingPassesForDate).toHaveBeenCalled());

    // No 'Effacer' button
    expect(screen.queryByRole('button', { name: /^Effacer$/i })).toBeNull();
    // No '+ Ajouter' button
    expect(screen.queryByText(/Ajouter/i)).toBeNull();
    // Textarea is readOnly
    expect(screen.getByRole('textbox').readOnly).toBe(true);

    // Clicking Fermer must NOT trigger onSaveDay
    fireEvent.click(screen.getByRole('button', { name: /Fermer/i }));
    expect(onSaveDay).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
