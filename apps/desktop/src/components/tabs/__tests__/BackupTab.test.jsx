import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import BackupTab from '../BackupTab';

afterEach(cleanup);

// Minimal props so the pure view renders without crashing.
const baseProps = {
  flights: [],
  authUser: null,
  backupState: { status: 'idle', lastBackup: null, log: [] },
  lastBackup: null,
  onSignIn: () => {},
  onSignOutRequest: () => {},
  onBackupNow: () => {},
  onRestoreRequest: () => {},
  exportToJSON: () => {},
  handleImportClick: () => {},
  exportToCSV: () => {},
  handleExportICS: () => {},
  clearAllData: () => {},
  // Folder backup props (new — C3/C4)
  backupFolder: '',
  folderBackupStatus: null,
  chooseBackupFolder: () => {},
  disableFolderBackup: () => {},
  runFolderBackupNow: () => {},
  restoreFromFolder: () => {},
};

describe('BackupTab — signed out', () => {
  it('renders the sign-in button and disables backup + restore', () => {
    render(<BackupTab {...baseProps} authUser={null} />);
    expect(screen.getByRole('button', { name: 'Se connecter avec Google' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Se déconnecter' })).toBeNull();
    expect(screen.getByRole('button', { name: /Sauvegarder maintenant/ }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /Restaurer depuis Drive/ }).disabled).toBe(true);
  });

  it('calls onSignIn when the sign-in button is clicked', () => {
    const onSignIn = vi.fn();
    render(<BackupTab {...baseProps} authUser={null} onSignIn={onSignIn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter avec Google' }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });
});

describe('BackupTab — signed in', () => {
  const signedIn = { ...baseProps, authUser: { email: 'pilote@example.com' } };

  it('shows the connected email and enables backup + restore', () => {
    render(<BackupTab {...signedIn} />);
    expect(screen.getByText(/pilote@example\.com/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Sauvegarder maintenant/ }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: /Restaurer depuis Drive/ }).disabled).toBe(false);
  });

  it('wires the backup, restore and sign-out handlers', () => {
    const onBackupNow = vi.fn();
    const onRestoreRequest = vi.fn();
    const onSignOutRequest = vi.fn();
    render(<BackupTab {...signedIn} onBackupNow={onBackupNow} onRestoreRequest={onRestoreRequest} onSignOutRequest={onSignOutRequest} />);
    fireEvent.click(screen.getByRole('button', { name: /Sauvegarder maintenant/ }));
    fireEvent.click(screen.getByRole('button', { name: /Restaurer depuis Drive/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    expect(onBackupNow).toHaveBeenCalledTimes(1);
    expect(onRestoreRequest).toHaveBeenCalledTimes(1);
    expect(onSignOutRequest).toHaveBeenCalledTimes(1);
  });

  it('disables actions while a backup is syncing', () => {
    render(<BackupTab {...signedIn} backupState={{ status: 'syncing', lastBackup: null, log: [] }} />);
    expect(screen.getByText('Sauvegarde en cours…')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Sauvegarder maintenant/ }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /Restaurer depuis Drive/ }).disabled).toBe(true);
  });
});

describe('BackupTab — error state', () => {
  it("shows a reconnect button when the error says 'reconnexion requise'", () => {
    const backupState = { status: 'error', lastBackup: null, log: [{ detail: 'Token expiré — reconnexion requise' }] };
    const onSignIn = vi.fn();
    render(<BackupTab {...baseProps} authUser={{ email: 'pilote@example.com' }} backupState={backupState} onSignIn={onSignIn} />);
    const reconnect = screen.getByRole('button', { name: /Reconnexion requise/ });
    expect(reconnect).toBeTruthy();
    fireEvent.click(reconnect);
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('shows the raw error detail in red for a non-auth error', () => {
    const backupState = { status: 'error', lastBackup: null, log: [{ detail: 'Drive: HTTP 500' }] };
    render(<BackupTab {...baseProps} authUser={{ email: 'pilote@example.com' }} backupState={backupState} />);
    expect(screen.getByText('Drive: HTTP 500')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Reconnexion requise/ })).toBeNull();
  });
});
