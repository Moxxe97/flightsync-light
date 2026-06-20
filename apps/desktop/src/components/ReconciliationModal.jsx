import { useMemo, useState } from 'react';
import { useIsMobile } from '../utils/useIsMobile';

// month string "2026-03" → "mars 2026" (French, matching app UI)
const MONTH_LABELS_FR = [
  '', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

function monthLabel(month) {
  if (!month) return 'mois inconnu';
  const [y, m] = month.split('-');
  return `${MONTH_LABELS_FR[parseInt(m, 10)]} ${y}`;
}

function sourceBadge(source) {
  const map = {
    'history-avg':  { label: 'moyenne route', bg: '#10b98122', fg: '#10b981', br: '#10b98144' },
    'great-circle': { label: 'grand cercle',  bg: '#f59e0b22', fg: '#f59e0b', br: '#f59e0b44' },
    'manual':       { label: 'manuel',        bg: '#63b3ed22', fg: '#63b3ed', br: '#63b3ed44' },
    'unknown':      { label: 'inconnu',       bg: '#ef444422', fg: '#ef4444', br: '#ef444444' },
  };
  const s = map[source] || map.unknown;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 10,
      fontWeight: 700, background: s.bg, color: s.fg, border: `1px solid ${s.br}`,
    }}>{s.label}</span>
  );
}

function shortDate(iso) {
  const [, m, d] = iso.split('-');
  return `${d} ${MONTH_LABELS_FR[parseInt(m, 10)].slice(0, 3)}`;
}

/**
 * Props:
 *   month              — e.g. "2026-03"
 *   missing            — [{ date, flightNumber, departure, arrival, blockMinutes, pairing, estimate }]
 *                        where estimate = { distance, canadianDistance, source }
 *   matchedCount       — number
 *   summaryCount       — total rows in the summary
 *   onCancel()
 *   onConfirm(flightsToAdd)  — flightsToAdd are ready-to-persist flight records
 *   deviceId           — string, written into _deviceId
 */
export default function ReconciliationModal({
  month, missing, matchedCount, summaryCount, onCancel, onConfirm, deviceId,
}) {
  const initialRows = useMemo(() =>
    missing.map((f, i) => ({
      index: i,
      ...f,
      distance: f.estimate.distance,
      canadianDistance: f.estimate.canadianDistance,
      source: f.estimate.source,
      selected: f.estimate.source !== 'unknown',
    })),
    [missing],
  );
  const [rows, setRows] = useState(initialRows);
  const isMobile = useIsMobile();

  const update = (i, patch) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));

  const toggle = (i) => update(i, { selected: !rows[i].selected });

  const editDistance = (i, field, raw) => {
    const value = parseFloat(raw) || 0;
    const next = { ...rows[i], [field]: value, source: 'manual' };
    if (next.source === 'manual' && next.distance > 0 && next.canadianDistance >= 0) {
      next.selected = true;
    }
    setRows(prev => prev.map((r, idx) => idx === i ? next : r));
  };

  const selectedCount = rows.filter(r => r.selected).length;

  const confirm = () => {
    const timestamp = Date.now();
    const toAdd = rows
      .filter(r => r.selected && r.distance > 0)
      .map(r => {
        const totalTime = +(r.blockMinutes / 60).toFixed(2);
        const canadianTime = r.distance > 0
          ? +(totalTime * r.canadianDistance / r.distance).toFixed(2)
          : 0;
        return {
          id: `f-${r.date}-${r.flightNumber.toLowerCase()}`,
          date: r.date,
          flightNumber: r.flightNumber,
          departure: r.departure,
          arrival: r.arrival,
          totalTime,
          canadianTime,
          distance: r.distance,
          canadianDistance: r.canadianDistance,
          notes: `Auto-ajouté depuis le sommaire ${monthLabel(month)} — source: ${r.source}`,
          _lastModified: timestamp,
          _deviceId: deviceId,
        };
      });
    onConfirm(toAdd);
  };

  if (missing.length === 0) {
    return (
      <Backdrop onClose={onCancel}>
        <div style={modalShell}>
          <Header month={month} />
          <p style={{ color: '#94a3b8', fontSize: 13, margin: '0 0 16px' }}>
            Aucun vol manquant — les {summaryCount} vols du sommaire sont déjà enregistrés.
          </p>
          <Footer>
            <button onClick={onCancel} style={btnPrimary}>Fermer</button>
          </Footer>
        </div>
      </Backdrop>
    );
  }

  return (
    <Backdrop onClose={onCancel}>
      <div style={modalShell}>
        <Header month={month} />
        <p style={{ color: '#94a3b8', fontSize: 12, margin: '0 0 12px' }}>
          {summaryCount} vols dans le sommaire · {matchedCount} déjà enregistrés · {missing.length} à ajouter
        </p>
        <div style={{ overflowY: 'auto', maxHeight: '50vh', border: '1px solid #1e2a45', borderRadius: 8 }}>
          {rows.map((r, i) => {
            const pct = r.distance > 0 ? ((r.canadianDistance / r.distance) * 100).toFixed(1) : '—';
            const checkbox = (
              <input type="checkbox" checked={r.selected} disabled={r.source === 'unknown' && r.distance === 0}
                     onChange={() => toggle(i)} />
            );
            const distGroup = (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontFamily: "'DM Mono', monospace" }}>
                <label style={{ fontSize: 10, color: '#64748b' }}>dist</label>
                <input type="number" value={r.distance} min={0}
                       onChange={e => editDistance(i, 'distance', e.target.value)}
                       style={numInput} />
                <label style={{ fontSize: 10, color: '#64748b' }}>CA</label>
                <input type="number" value={r.canadianDistance} min={0}
                       onChange={e => editDistance(i, 'canadianDistance', e.target.value)}
                       style={numInput} />
                <span style={{ color: '#f59e0b' }}>{pct}%</span>
              </div>
            );
            // Mobile: stack each flight into a card (the desktop 6-column grid is far
            // too wide for a phone — its fixed columns alone exceed the modal width).
            return isMobile ? (
              <div key={`${r.date}-${r.flightNumber}`} data-testid="recon-row" style={{
                display: 'flex', flexDirection: 'column', gap: 8, padding: '12px',
                borderBottom: '1px solid #1e2a45', fontSize: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {checkbox}
                  <span style={{ fontFamily: "'DM Mono', monospace", color: '#f1f5f9', fontWeight: 600 }}>{r.flightNumber}</span>
                  <span style={{ color: '#94a3b8' }}>{shortDate(r.date)}</span>
                  <span style={{ marginLeft: 'auto' }}>{sourceBadge(r.source)}</span>
                </div>
                <span style={{ fontFamily: "'DM Mono', monospace", color: '#94a3b8' }}>{r.departure} → {r.arrival}</span>
                {distGroup}
              </div>
            ) : (
              <div key={`${r.date}-${r.flightNumber}`} data-testid="recon-row" style={{
                display: 'grid', gridTemplateColumns: '24px 80px 80px 110px 1fr auto',
                gap: 10, alignItems: 'center', padding: '10px 12px',
                borderBottom: '1px solid #1e2a45', fontSize: 12,
              }}>
                {checkbox}
                <span style={{ color: '#94a3b8' }}>{shortDate(r.date)}</span>
                <span style={{ fontFamily: "'DM Mono', monospace", color: '#f1f5f9' }}>{r.flightNumber}</span>
                <span style={{ fontFamily: "'DM Mono', monospace", color: '#94a3b8' }}>
                  {r.departure} → {r.arrival}
                </span>
                {distGroup}
                {sourceBadge(r.source)}
              </div>
            );
          })}
        </div>
        <Footer>
          <button onClick={onCancel} style={btnGhost}>Annuler</button>
          <button onClick={confirm} disabled={selectedCount === 0} style={{
            ...btnPrimary,
            opacity: selectedCount === 0 ? 0.4 : 1,
            cursor: selectedCount === 0 ? 'not-allowed' : 'pointer',
          }}>
            Ajouter sélectionnés ({selectedCount})
          </button>
        </Footer>
      </div>
    </Backdrop>
  );
}

function Header({ month }) {
  return (
    <h3 style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', margin: '0 0 6px' }}>
      Réconciliation — {monthLabel(month)}
    </h3>
  );
}

function Footer({ children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
      {children}
    </div>
  );
}

function Backdrop({ onClose, children }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(5,10,20,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        backdropFilter: 'blur(2px)',
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{ maxWidth: 900, width: '90vw' }}>
        {children}
      </div>
    </div>
  );
}

const modalShell = {
  background: '#0f1525', border: '1px solid #2d3748',
  borderRadius: 14, padding: 20, color: '#f1f5f9',
  fontFamily: 'inherit',
};

const btnPrimary = {
  padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
  background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
  color: 'white', fontSize: 13, fontWeight: 600,
};

const btnGhost = {
  padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
  background: 'transparent', border: '1px solid #2d3748',
  color: '#a0aec0', fontSize: 13, fontWeight: 500,
};

const numInput = {
  width: 64, padding: '3px 6px', background: '#0a0f1e',
  border: '1px solid #2d3748', borderRadius: 4,
  color: '#f1f5f9', fontFamily: "'DM Mono', monospace", fontSize: 11,
};
