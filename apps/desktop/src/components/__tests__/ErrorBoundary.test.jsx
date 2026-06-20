import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ErrorBoundary from '../ErrorBoundary.jsx';

function Boom() {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>hello</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('hello')).toBeDefined();
  });

  it('renders fallback UI when child throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText(/something went wrong/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /reload/i })).toBeDefined();
    spy.mockRestore();
  });

  it('calls onError with the error and component stack', () => {
    const onError = vi.fn();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary onError={onError}>
        <Boom />
      </ErrorBoundary>
    );
    expect(onError).toHaveBeenCalledTimes(1);
    const [err, info] = onError.mock.calls[0];
    expect(err.message).toBe('boom');
    expect(typeof info.componentStack).toBe('string');
    spy.mockRestore();
  });

  it('reload button triggers a reload', () => {
    const reload = vi.fn();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary reloadFn={reload}>
        <Boom />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

function renderCrashed(reloadFn) {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const utils = render(
    <ErrorBoundary reloadFn={reloadFn}><Boom /></ErrorBoundary>
  );
  spy.mockRestore();
  return utils;
}

describe('ErrorBoundary reset escape', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('offers a reset button behind a two-step confirm', () => {
    renderCrashed(() => {});
    const btn = screen.getByText('Réinitialiser les données locales');
    fireEvent.click(btn);
    expect(screen.getByText(/irréversible/i)).toBeTruthy();
    expect(screen.getByText('Confirmer la réinitialisation')).toBeTruthy();
  });

  it('clears allowlisted localStorage keys and reloads on confirm', () => {
    localStorage.setItem('ac-flights-data', '{"evil":true}');
    localStorage.setItem('ac-residence-data', '[]');
    localStorage.setItem('ac-flights-archive-2024', '[]');
    localStorage.setItem('unrelated-key', 'keep');
    const reload = vi.fn();
    renderCrashed(reload);
    fireEvent.click(screen.getByText('Réinitialiser les données locales'));
    fireEvent.click(screen.getByText('Confirmer la réinitialisation'));
    expect(localStorage.getItem('ac-flights-data')).toBeNull();
    expect(localStorage.getItem('ac-residence-data')).toBeNull();
    expect(localStorage.getItem('ac-flights-archive-2024')).toBe('[]');
    expect(localStorage.getItem('unrelated-key')).toBe('keep');
    expect(reload).toHaveBeenCalled();
  });

  it('keeps the plain Reload button working', () => {
    const reload = vi.fn();
    renderCrashed(reload);
    fireEvent.click(screen.getByText('Reload'));
    expect(reload).toHaveBeenCalled();
  });
});
