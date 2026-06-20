import { Component } from 'react';

const btnStyle = {
  padding: '8px 20px',
  fontSize: 14,
  cursor: 'pointer',
  background: '#3a3a3a',
  color: '#fff',
  border: '1px solid #555',
  borderRadius: 6,
};

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, confirmingReset: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    if (typeof this.props.onError === 'function') {
      this.props.onError(error, info);
    }
  }

  // injectable for tests
  reload = () => (this.props.reloadFn || (() => window.location.reload()))();

  // Allowlist, NOT the ac- prefix: legacy archive keys (ac-*-archive-YYYY)
  // may still be the only copy of an archived year if the idb migration
  // hasn't run — and in a boot crash-loop it never has.
  static RESET_KEYS = ['ac-flights-data', 'ac-residence-data', 'ac-sync-settings', 'ac-sync-log', 'ac-device-id'];

  // Crash-loop escape (audit #23): a poisoned localStorage row crashes every
  // boot and Reload can't recover. Clearing the app's data/settings keys breaks
  // the loop. IndexedDB (OFPs / boarding passes / archives) is deliberately left
  // alone — it isn't read during the boot path that crashes, and it holds the
  // user's only copy of archived years.
  resetLocalData = () => {
    try {
      ErrorBoundary.RESET_KEYS.forEach((k) => localStorage.removeItem(k));
    } catch { /* storage unavailable — reload anyway */ }
    this.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{
        padding: 32,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#eee',
        background: '#1a1a1a',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
      }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Something went wrong</h1>
        <p style={{ margin: 0, opacity: 0.7 }}>The app hit an unexpected error. Reloading should recover.</p>
        <button onClick={this.reload} style={btnStyle}>Reload</button>
        {!this.state.confirmingReset ? (
          <button
            onClick={() => this.setState({ confirmingReset: true })}
            style={{ ...btnStyle, background: 'none', border: '1px solid #7f1d1d', color: '#fca5a5' }}
          >
            Réinitialiser les données locales
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <p style={{ margin: 0, fontSize: 13, color: '#fca5a5', maxWidth: 420, textAlign: 'center' }}>
              Action irréversible : efface les vols/résidence locaux (les archives et
              plans de vol sont conservés). Vos données sont stockées localement sur ce Mac.
            </p>
            <button
              onClick={this.resetLocalData}
              style={{ ...btnStyle, background: '#7f1d1d', border: '1px solid #991b1b' }}
            >
              Confirmer la réinitialisation
            </button>
          </div>
        )}
      </div>
    );
  }
}
