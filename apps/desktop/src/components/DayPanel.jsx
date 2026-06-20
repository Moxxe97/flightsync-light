// src/components/DayPanel.jsx — one panel for everything about a calendar day:
// classification (saved immediately), boarding passes (IndexedDB), notes
// (saved when the panel closes). Replaces DayChooser + ResidenceEditModal.
import { useEffect, useRef, useState } from 'react';
import {
  getBoardingPassesForDate,
  saveBoardingPass,
  deleteBoardingPass,
} from '@flightsync/core/idb';

const OPTIONS = [
  { key: 'canada',        emoji: '🏠', label: 'Canada',        color: '#ef4444' },
  { key: 'mexico',        emoji: '🌴', label: 'Mexique',       color: '#10b981' },
  { key: 'international', emoji: '🌍', label: 'International', color: '#3b82f6' },
  { key: 'transit',       emoji: '✈️', label: 'Transit',       color: '#f59e0b' },
];

const sectionTitle = {
  fontSize: 11, fontWeight: 600, color: '#64748b', letterSpacing: '0.06em',
  margin: '14px 0 8px',
};

export default function DayPanel({
  date, entry, readOnly = false,
  onSaveDay, onOpenPass, onPassesChanged, onClose,
}) {
  const [location, setLocation] = useState(entry?.location ?? null);
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [passes, setPasses] = useState([]);
  const [bpError, setBpError] = useState(null);
  const fileInputRef = useRef(null);
  const initial = useRef({ location: entry?.location ?? null, notes: entry?.notes ?? '' });

  const refreshPasses = async () => {
    const result = await getBoardingPassesForDate(date);
    setPasses(result);
  };
  useEffect(() => { void getBoardingPassesForDate(date).then(setPasses); }, [date]);

  const pick = (key) => {
    if (readOnly) return;
    setLocation(key);
    onSaveDay(date, { location: key, notes });
  };

  const close = () => {
    if (!readOnly &&
        (location !== initial.current.location || notes !== initial.current.notes)) {
      onSaveDay(date, { location, notes });
    }
    onClose();
  };

  const addFiles = async (files) => {
    setBpError(null);
    try {
      for (const f of files) await saveBoardingPass(date, f);
      await refreshPasses();
      onPassesChanged();
    } catch (err) {
      setBpError(`Erreur boarding pass : ${err.message}`);
    }
  };

  const removePass = async (id) => {
    setBpError(null);
    try {
      await deleteBoardingPass(id);
      await refreshPasses();
      onPassesChanged();
    } catch (err) {
      setBpError(`Erreur boarding pass : ${err.message}`);
    }
  };

  const weekday = new Date(date + 'T12:00:00')
    .toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });

  const btnBase = {
    padding: '10px 8px', borderRadius: 10, cursor: readOnly ? 'default' : 'pointer',
    color: '#e2e8f0', fontSize: 13, fontWeight: 600,
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
  };

  return (
    <div onClick={close} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100000,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: '#0f1525', border: '1px solid #1e2a45', borderRadius: 12,
        padding: 20, width: 'min(92vw, 400px)', maxHeight: '86vh', overflowY: 'auto',
        fontFamily: "'DM Sans', system-ui, sans-serif", color: '#e2e8f0',
      }}>
        <div style={{ fontSize: 12, color: '#64748b', letterSpacing: '0.04em' }}>{date}</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', textTransform: 'capitalize' }}>
          {weekday}
        </div>

        <div style={sectionTitle}>CLASSIFICATION</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {OPTIONS.map((opt) => {
            const selected = location === opt.key;
            return (
              <button key={opt.key} onClick={() => pick(opt.key)} disabled={readOnly} style={{
                ...btnBase,
                background: selected ? `${opt.color}22` : '#0a0f1e',
                border: selected ? `2px solid ${opt.color}` : '1px solid #1e2a45',
              }}>
                <span style={{ fontSize: 20 }}>{opt.emoji}</span>{opt.label}
              </button>
            );
          })}
        </div>
        {!readOnly && location != null && (
          <button onClick={() => { setLocation(null); onSaveDay(date, { location: null, notes }); }} style={{
            marginTop: 8, width: '100%', padding: '7px 12px', borderRadius: 8, cursor: 'pointer',
            background: 'transparent', border: '1px solid #374151', color: '#94a3b8', fontSize: 12,
          }}>
            Effacer
          </button>
        )}

        <div style={sectionTitle}>BOARDING PASS</div>
        {passes.length === 0 && (
          <div style={{ fontSize: 12, color: '#475569' }}>Aucun boarding pass</div>
        )}
        {passes.map((bp) => (
          <div key={bp.id} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
            background: '#0a0f1e', border: '1px solid #1e2a45', borderRadius: 8, marginBottom: 6,
          }}>
            <button onClick={() => onOpenPass(bp)} style={{
              flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer',
              color: '#a78bfa', fontSize: 12, textAlign: 'left',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              📎 {bp.fileName}
            </button>
            {!readOnly && (
              <button title="Supprimer" onClick={() => removePass(bp.id)} style={{
                background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 13,
              }}>
                🗑
              </button>
            )}
          </div>
        ))}
        {bpError && (
          <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 6 }}>{bpError}</div>
        )}
        {!readOnly && (
          <>
            <button onClick={() => fileInputRef.current?.click()} style={{
              width: '100%', padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
              background: '#0a0f1e', border: '1px dashed #2d3a55', color: '#94a3b8', fontSize: 12,
            }}>
              + Ajouter un fichier (PDF / image)
            </button>
            <input
              ref={fileInputRef} type="file" accept="application/pdf,image/*" multiple
              onChange={(e) => { addFiles(Array.from(e.target.files || [])); e.target.value = ''; }}
              style={{ display: 'none' }}
            />
          </>
        )}

        <div style={sectionTitle}>NOTES</div>
        <textarea
          value={notes}
          readOnly={readOnly}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={readOnly ? '' : 'Hôtel, rotation, contexte…'}
          rows={3}
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'vertical',
            background: '#0a0f1e', border: '1px solid #1e2a45', borderRadius: 8,
            color: '#e2e8f0', fontSize: 13, padding: 10,
            fontFamily: "'DM Sans', system-ui, sans-serif",
          }}
        />

        <button onClick={close} style={{
          marginTop: 14, width: '100%', padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
          background: '#1e2a45', border: '1px solid #2d3748', color: '#e2e8f0', fontSize: 13, fontWeight: 600,
        }}>
          Fermer
        </button>
      </div>
    </div>
  );
}
