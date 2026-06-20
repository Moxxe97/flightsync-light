import { useState, useRef, useEffect, useCallback } from 'react';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument } from 'pdf-lib';

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
import { processPdfFile, parseFlightSummary, SUMMARY_HEADER, reconcile } from '@flightsync/core/parsing';
import { saveOFP } from '@flightsync/core/idb';
import { estimateRoute } from '@flightsync/core/geo';
import ReconciliationModal from './ReconciliationModal';

// ─── PDF Trimming ─────────────────────────────────────────────
// Extracts pages 0..cutPageIndex (inclusive) into a new PDF.
async function trimPdf(file, cutPageIndex) {
  const srcBytes = await file.arrayBuffer();
  const srcDoc = await PDFDocument.load(srcBytes);
  const trimmedDoc = await PDFDocument.create();
  const count = Math.min(cutPageIndex + 1, srcDoc.getPageCount());
  const indices = Array.from({ length: count }, (_, i) => i);
  const copied = await trimmedDoc.copyPages(srcDoc, indices);
  copied.forEach(p => trimmedDoc.addPage(p));
  return trimmedDoc.save(); // Uint8Array
}

// ─── Inline icons ─────────────────────────────────────────────
const IconUpload = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 16 12 12 8 16"/>
    <line x1="12" y1="12" x2="12" y2="21"/>
    <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
  </svg>
);

const IconPdf = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
    <polyline points="10 9 9 9 8 9"/>
  </svg>
);

const IconCheck = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const IconEdit = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
);

// Confidence badge
function ConfBadge({ score }) {
  const color = score >= 75 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';
  const label = score >= 75 ? 'Bon' : score >= 50 ? 'Moyen' : 'Faible';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 7px', borderRadius: 20, fontSize: 10, fontWeight: 700,
      background: `${color}22`, color, border: `1px solid ${color}44`,
    }}>
      {label} {score}%
    </span>
  );
}

// Editable cell for the review table
function EditCell({ value, onChange, mono, width, placeholder }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    onChange(draft);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        style={{
          background: '#0f1525', border: '1px solid #63b3ed', borderRadius: 4,
          color: '#f1f5f9', padding: '2px 6px', fontSize: 12, width: width || 80,
          fontFamily: mono ? "'DM Mono', monospace" : 'inherit', outline: 'none',
        }}
        placeholder={placeholder}
      />
    );
  }

  return (
    <span
      onClick={() => { setDraft(value); setEditing(true); }}
      style={{
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
        fontFamily: mono ? "'DM Mono', monospace" : 'inherit',
        color: value ? '#e2e8f0' : '#475569',
        borderBottom: '1px dashed #2d3748', paddingBottom: 1,
      }}
      title="Cliquer pour modifier"
    >
      {value || placeholder || '—'}
      <span style={{ opacity: 0.4, flexShrink: 0 }}><IconEdit /></span>
    </span>
  );
}

// ─── PDF Kind Sniffer ─────────────────────────────────────────
async function sniffPdfKind(file) {
  // Read page 1 text only; decide whether this is a flight summary or an OFP.
  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer, isEvalSupported: false }).promise;
  const page = await doc.getPage(1);
  const text = (await page.getTextContent()).items.map(it => it.str).join(' ');
  if (text.includes(SUMMARY_HEADER)) return 'summary';
  return 'ofp';
}

// ─── Main Component ───────────────────────────────────────────
export default function PdfDropZone({ onImport, notify, storedFlights = [], deviceId = 'unknown' }) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingFile, setProcessingFile] = useState('');
  const [flights, setFlights] = useState(null);   // null = not yet processed
  const [trimmedPdfs, setTrimmedPdfs] = useState([]); // [{ flightMeta, bytes, fileName, pageCount }]
  const [rawPreview, setRawPreview] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const [lastError, setLastError] = useState('');
  const [summaryPayload, setSummaryPayload] = useState(null);  // { month, missing, matchedCount, summaryCount } or null
  const fileInputRef = useRef(null);
  const dragCounter = useRef(0);
  const storedFlightsRef = useRef(storedFlights);
  useEffect(() => { storedFlightsRef.current = storedFlights; }, [storedFlights]);

  const processFiles = useCallback(async (fileList) => {
    const pdfs = Array.from(fileList).filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
    if (pdfs.length === 0) {
      notify('Aucun fichier PDF sélectionné.', 'error');
      return;
    }

    setIsProcessing(true);
    setLastError('');

    // Partition by kind on the first page.
    const ofpFiles = [];
    const summaryFiles = [];
    for (const file of pdfs) {
      setProcessingFile(file.name);
      try {
        const kind = await sniffPdfKind(file);
        (kind === 'summary' ? summaryFiles : ofpFiles).push(file);
      } catch (err) {
        console.warn('[sniff] failed for', file.name, err.message);
        ofpFiles.push(file); // default path
      }
    }

    // Summary path: only the first summary file is processed per drop — summaries
    // should be dropped one month at a time, and the modal is modal.
    if (summaryFiles.length > 0) {
      const file = summaryFiles[0];
      try {
        const parsed = await parseFlightSummary(file);
        const flownOnly = parsed.flights.filter(f => f.flightType === 'flown');
        if (flownOnly.length === 0) {
          notify('Sommaire reconnu mais aucun vol trouvé.', 'info');
        } else {
          const current = storedFlightsRef.current;
          const { missing, matched } = reconcile(flownOnly, current);
          const missingWithEstimates = missing.map(f => ({
            ...f,
            estimate: estimateRoute(f.departure, f.arrival, current),
          }));
          setSummaryPayload({
            month: parsed.month,
            missing: missingWithEstimates,
            matchedCount: matched.length,
            summaryCount: flownOnly.length,
          });
        }
      } catch (err) {
        console.error('[summary] failed:', err);
        notify(`Sommaire illisible : ${err.message || 'format non reconnu'}`, 'error');
      }
      if (summaryFiles.length > 1) {
        notify('Un seul sommaire traité à la fois — les autres ont été ignorés.', 'info');
      }
    }

    // OFP path: preserved from previous implementation.
    const extracted = [];
    const trimmed = [];
    let lastRaw = '';
    for (const file of ofpFiles) {
      setProcessingFile(file.name);
      try {
        const result = await processPdfFile(file);
        if (result.warning) notify(result.warning, 'info');
        if (result.error) {
          setLastError(result.error);
        } else {
          extracted.push(...result.flights);
          try {
            const cutIdx = result.cutPageIndex ?? 0;
            const bytes = await trimPdf(file, cutIdx);
            trimmed.push({
              flightMeta: result.flights.map(f => ({ id: f.id, date: f.date, flightNumber: f.flightNumber })),
              bytes,
              fileName: file.name,
              pageCount: cutIdx + 1,
            });
          } catch (trimErr) {
            console.warn('[ofp] trim failed for', file.name, trimErr.message);
          }
        }
        if (result.rawTextPreview) lastRaw = result.rawTextPreview;
      } catch (err) {
        setLastError(`Exception: ${err.message}`);
        console.error('[PDF] Erreur complète:', err);
      }
    }
    if (ofpFiles.length > 0) setTrimmedPdfs(trimmed);

    setIsProcessing(false);
    setProcessingFile('');

    if (ofpFiles.length === 0) return;  // summary-only drop; nothing to review in the OFP table

    if (extracted.length === 0) {
      setRawPreview(lastRaw);
      setFlights([]);
      return;
    }
    setRawPreview(lastRaw);
    setFlights(extracted);
  }, [notify]);

  const pickPdfViaTauri = useCallback(async () => {
    try {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const selected = await invoke('plugin:dialog|open', {
        options: { multiple: true, directory: false, filters: [{ name: 'PDF', extensions: ['pdf'] }] },
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      const files = [];
      for (const p of paths) {
        const bytes = await invoke('plugin:fs|read_file', { path: p });
        const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        files.push(new File([u8], String(p).split('/').pop() || 'plan.pdf', { type: 'application/pdf' }));
      }
      await processFiles(files);
    } catch (err) {
      notify(`Erreur ouverture PDF: ${err.message || err}`, 'error');
    }
  }, [processFiles, notify]);

  // ─── Drag events ─────────────────────────────────────────
  const onDragEnter = useCallback((e) => {
    e.preventDefault();
    dragCounter.current++;
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  }, []);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    processFiles(e.dataTransfer.files);
  }, [processFiles]);

  // ─── Flight field update ──────────────────────────────────
  const updateFlight = (idx, field, raw) => {
    setFlights(prev => prev.map((f, i) => {
      if (i !== idx) return f;
      const updated = { ...f, [field]: field === 'totalTime' || field === 'canadianTime' || field === 'distance' || field === 'canadianDistance' ? parseFloat(raw) || 0 : raw };
      if ((field === 'totalTime' || field === 'distance' || field === 'canadianDistance') && updated.distance > 0) {
        updated.canadianTime = parseFloat((updated.totalTime * updated.canadianDistance / updated.distance).toFixed(2));
      }
      return updated;
    }));
  };

  const confirmImport = async () => {
    for (const { flightMeta, bytes, fileName, pageCount } of trimmedPdfs) {
      for (const { id, date, flightNumber } of flightMeta) {
        try {
          await saveOFP(id, { date, flightNumber, fileName, data: bytes, pageCount });
        } catch (err) {
          console.warn('[ofp] saveOFP failed for', fileName, err.message);
        }
      }
    }
    onImport(flights);
    setFlights(null);
    setTrimmedPdfs([]);
    setRawPreview('');
    setShowRaw(false);
  };

  const reset = () => {
    setFlights(null);
    setTrimmedPdfs([]);
    setRawPreview('');
    setShowRaw(false);
  };

  // ─── Render ───────────────────────────────────────────────
  // ─── Render ───────────────────────────────────────────────
  return (
    <>
      {summaryPayload && (
        <ReconciliationModal
          month={summaryPayload.month}
          missing={summaryPayload.missing}
          matchedCount={summaryPayload.matchedCount}
          summaryCount={summaryPayload.summaryCount}
          deviceId={deviceId}
          onCancel={() => setSummaryPayload(null)}
          onConfirm={(flightsToAdd) => {
            if (flightsToAdd.length > 0) onImport(flightsToAdd);
            setSummaryPayload(null);
          }}
        />
      )}
      {isProcessing ? (
        // ─── Loading state ──────────────────────────────────
        <div style={{
          border: '2px dashed #2d3748', borderRadius: 14, padding: 40,
          textAlign: 'center', background: '#0f1525',
        }}>
          <div style={{
            width: 36, height: 36, border: '3px solid rgba(99,179,237,0.2)',
            borderTop: '3px solid #63b3ed', borderRadius: '50%',
            animation: 'spin 1s linear infinite', margin: '0 auto 16px',
          }} />
          <p style={{ color: '#a0aec0', fontSize: 13 }}>Lecture PDF en cours…</p>
          <p style={{ color: '#475569', fontSize: 11, marginTop: 4, fontFamily: "'DM Mono', monospace" }}>
            {processingFile}
          </p>
        </div>
      ) : flights !== null ? (
        // ─── Review table ───────────────────────────────────
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
            <div>
              <h4 style={{ fontSize: 14, fontWeight: 600, color: '#63b3ed', margin: 0 }}>
                {flights.length > 0 ? `${flights.length} vol(s) extrait(s) — Vérifier avant d'importer` : 'Aucun vol extrait'}
              </h4>
              <p style={{ fontSize: 11, color: '#475569', marginTop: 3 }}>
                Cliquez sur une valeur pour la modifier. Les champs en rouge ont été estimés.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                style={{ fontSize: 11, padding: '4px 10px', background: 'transparent', border: '1px solid #2d3748', borderRadius: 6, color: '#64748b', cursor: 'pointer' }}
                onClick={() => setShowRaw(v => !v)}
              >
                {showRaw ? 'Masquer' : 'Texte brut'}
              </button>
              <button
                style={{ fontSize: 11, padding: '4px 10px', background: 'transparent', border: '1px solid #2d3748', borderRadius: 6, color: '#a0aec0', cursor: 'pointer' }}
                onClick={reset}
              >
                Recommencer
              </button>
            </div>
          </div>

          {/* Raw text debug panel */}
          {showRaw && rawPreview && (
            <div style={{
              padding: 12, background: '#0a0f1e', borderRadius: 8, marginBottom: 16,
              border: '1px solid #1e2a45',
            }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                <button
                  onClick={() => navigator.clipboard.writeText(rawPreview)}
                  style={{ fontSize: 11, padding: '3px 10px', background: '#1e2a45', border: '1px solid #2d3748', borderRadius: 6, color: '#a0aec0', cursor: 'pointer' }}
                >Copier texte brut</button>
              </div>
              <pre style={{
                fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#64748b',
                whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto', margin: 0,
              }}>{rawPreview}</pre>
            </div>
          )}

          {flights.length === 0 ? (
            <div style={{ padding: 20, background: '#0a0f1e', borderRadius: 10, border: '1px solid #2d3748' }}>
              <p style={{ color: '#fca5a5', fontSize: 13, marginBottom: lastError ? 12 : 0 }}>
                Aucun vol extrait de ce PDF.
              </p>
              {lastError && (
                <p style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#ef4444', marginBottom: 12, wordBreak: 'break-all' }}>
                  Erreur : {lastError}
                </p>
              )}
              {rawPreview ? (
                <>
                  <p style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>
                    Texte extrait du PDF (vérifier si le format correspond) :
                  </p>
                  <pre style={{
                    fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#64748b',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200,
                    overflowY: 'auto', background: '#070c18', padding: 10, borderRadius: 6,
                    textAlign: 'left',
                  }}>{rawPreview}</pre>
                </>
              ) : (
                <p style={{ fontSize: 12, color: '#475569' }}>
                  PDF image/scanné (pas de texte extractible) ou format non reconnu.
                </p>
              )}
              <button
                onClick={reset}
                style={{ marginTop: 14, fontSize: 11, padding: '5px 12px', background: '#1e2a45', border: '1px solid #2d3748', borderRadius: 6, color: '#a0aec0', cursor: 'pointer' }}
              >
                Réessayer
              </button>
            </div>
          ) : (
            <>
              <div style={{ overflowX: 'auto', marginBottom: 16 }}>
                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 4px', fontSize: 12 }}>
                  <thead>
                    <tr>
                      {['Date', 'Vol', 'Route', 'Total (h)', 'Canada (h)', 'Dist (nm)', 'Fiabilité'].map(h => (
                        <th key={h} style={{
                          textAlign: 'left', padding: '6px 10px', fontSize: 10,
                          color: '#475569', letterSpacing: '0.08em', fontWeight: 600,
                          borderBottom: '1px solid #1e2a45',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {flights.map((f, idx) => {
                      const canPct = f.distance > 0 ? ((f.canadianDistance / f.distance) * 100).toFixed(0) : 0;
                      return (
                        <tr key={f.id} style={{ background: idx % 2 === 0 ? '#0f1525' : 'transparent' }}>
                          <td style={{ padding: '8px 10px' }}>
                            <EditCell value={f.date} onChange={v => updateFlight(idx, 'date', v)} mono width={90} placeholder="YYYY-MM-DD" />
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            <EditCell value={f.flightNumber} onChange={v => updateFlight(idx, 'flightNumber', v)} mono width={70} />
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <EditCell value={f.departure} onChange={v => updateFlight(idx, 'departure', v)} mono width={45} />
                              <span style={{ color: '#475569' }}>→</span>
                              <EditCell value={f.arrival} onChange={v => updateFlight(idx, 'arrival', v)} mono width={45} />
                            </span>
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            <EditCell value={String(f.totalTime)} onChange={v => updateFlight(idx, 'totalTime', v)} mono width={50} />
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            <span style={{ fontFamily: "'DM Mono', monospace", color: '#f59e0b' }}>
                              {f.canadianTime}h
                            </span>
                            <span style={{ color: '#374151', fontSize: 10, marginLeft: 4 }}>({canPct}%)</span>
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            <EditCell value={String(f.distance || '')} onChange={v => updateFlight(idx, 'distance', v)} mono width={60} placeholder="nm" />
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            <ConfBadge score={f._confidence} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  onClick={confirmImport}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                    color: 'white', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                  }}
                >
                  <IconCheck /> Importer {flights.length} vol{flights.length > 1 ? 's' : ''}
                </button>
                <p style={{ fontSize: 11, color: '#475569' }}>
                  Les doublons (même date + numéro de vol) seront automatiquement ignorés.
                </p>
              </div>
            </>
          )}
        </div>
      ) : (
        // ─── Drop zone ──────────────────────────────────────
        <div
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${isDragging ? '#63b3ed' : '#2d3748'}`,
            borderRadius: 14,
            padding: '40px 24px',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s',
            background: isDragging ? 'rgba(99,179,237,0.05)' : '#0f1525',
            transform: isDragging ? 'scale(1.01)' : 'scale(1)',
          }}
        >
          <div style={{ color: isDragging ? '#63b3ed' : '#475569', marginBottom: 12 }}>
            <IconUpload />
          </div>
          <p style={{ fontSize: 14, fontWeight: 600, color: isDragging ? '#63b3ed' : '#94a3b8', marginBottom: 6 }}>
            {isDragging ? 'Déposer le PDF ici' : 'Glisser-déposer des PDFs de plan de vol'}
          </p>
          <p style={{ fontSize: 12, color: '#475569' }}>
            ou cliquer pour sélectionner — Plans de vol AC, OFP, Crew Briefing
          </p>
          <p style={{ fontSize: 11, color: '#374151', marginTop: 8 }}>
            Plusieurs PDFs acceptés simultanément
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            multiple
            onChange={e => processFiles(e.target.files)}
            style={{ display: 'none' }}
            onClick={e => e.stopPropagation()}
          />
          {window.__TAURI_INTERNALS__ && (
            <button type="button" className="btn btn-secondary" onClick={e => { e.stopPropagation(); pickPdfViaTauri(); }} style={{ marginTop: 12 }}>
              Choisir un PDF…
            </button>
          )}
        </div>
      )}
    </>
  );
}
