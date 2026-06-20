import { useState, useEffect } from 'react';
import { bpToObjectURL } from '@flightsync/core/idb';

const IconClose = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

const IconDownload = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);

const formatDate = (iso) => {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('fr-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
};

// Compute the object URL once from the pass blob (bpToObjectURL is synchronous).
// Revoke it when the component unmounts via a cleanup-only effect.
function usePassUrl(pass) {
  const [url] = useState(() => bpToObjectURL(pass));
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return url;
}

export default function BoardingPassModal({ pass, onClose }) {
  const url = usePassUrl(pass);

  const handleDownload = () => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = pass.fileName;
    a.click();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#0f1525', border: '1px solid #1e2a45', borderRadius: 16,
          width: '100%', maxWidth: 860, maxHeight: '90vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          columnGap: 12, padding: '14px 20px', borderBottom: '1px solid #1e2a45', flexShrink: 0,
        }}>
          <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>
              {formatDate(pass.date)}
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              <span style={{ marginLeft: 0, color: '#475569' }}>{pass.fileName}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            {url && (
              <button
                onClick={handleDownload}
                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 10px', background: '#1e2a45', border: '1px solid #2d3748', borderRadius: 6, color: '#a0aec0', cursor: 'pointer' }}
              >
                <IconDownload /> Télécharger
              </button>
            )}
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4 }}>
              <IconClose />
            </button>
          </div>
        </div>

        {/* Viewer */}
        <div style={{ flex: 1, overflow: 'auto', background: '#070c18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {!url ? (
            <div style={{ textAlign: 'center', color: '#64748b' }}>
              <div style={{ width: 32, height: 32, border: '3px solid rgba(99,179,237,0.2)', borderTop: '3px solid #63b3ed', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto' }} />
            </div>
          ) : pass.fileType === 'application/pdf' ? (
            <iframe
              src={url}
              style={{ width: '100%', height: '100%', border: 'none', minHeight: 500 }}
              title={pass.fileName}
            />
          ) : (
            <img
              src={url}
              alt={pass.fileName}
              style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain', borderRadius: 8, padding: 20 }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
