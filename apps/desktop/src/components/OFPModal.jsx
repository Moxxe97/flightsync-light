import { useState, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { getOFP } from '@flightsync/core/idb';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

const RENDER_SCALE = 1.8;

const IconClose = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

// One page: a fixed-aspect placeholder that rasterizes itself (canvas →
// blob → object URL) only when it approaches the viewport, and revokes its
// URL on unmount. Replaces the old render-all-pages-as-data-URLs flow that
// stalled the main thread for seconds on a 30-60-page OFP (audit #27).
function OFPPage({ pdf, pageNumber, aspectRatio }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  const hostRef = useRef(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || !pdf) return undefined;
    let cancelled = false;
    let objectUrl = null;
    const observer = new IntersectionObserver(async (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: RENDER_SCALE });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        if (cancelled) return;
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        page.cleanup();
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch (err) {
        console.error(`[OFPModal] page ${pageNumber} render failed:`, err);
        if (!cancelled) setFailed(true);
      }
    }, { rootMargin: '600px 0px' });
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [pdf, pageNumber]);

  return (
    <div
      ref={hostRef}
      aria-label={`Page ${pageNumber}`}
      style={{ width: '100%', maxWidth: 860, aspectRatio: `1 / ${aspectRatio}`, background: '#0b1322', borderRadius: 4 }}
    >
      {src && (
        <img src={src} alt={`Page ${pageNumber}`} style={{ width: '100%', display: 'block', borderRadius: 4 }} />
      )}
      {failed && (
        <p style={{ fontSize: 12, color: '#475569', textAlign: 'center', paddingTop: 24 }}>Page {pageNumber} illisible.</p>
      )}
    </div>
  );
}

export default function OFPModal({ flightId, onClose }) {
  const [record, setRecord] = useState(null);
  const [pdf, setPdf] = useState(null);
  const [aspectRatio, setAspectRatio] = useState(792 / 612);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let loadingTask = null;
    (async () => {
      try {
        const rec = await getOFP(flightId);
        if (cancelled) return;
        if (!rec?.data) { setError(true); return; }

        setRecord(rec);
        const bytes = rec.data instanceof Uint8Array ? rec.data : new Uint8Array(rec.data);
        // isEvalSupported: false neutralizes CVE-2024-4367 — defense-in-depth
        // on top of the no-'unsafe-eval' CSP. bytes.slice(): pdfjs 4 transfers
        // (detaches) the buffer it's given; keep record.data usable.
        loadingTask = pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false });
        const doc = await loadingTask.promise;
        if (cancelled) return;
        const first = await doc.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        first.cleanup();
        if (cancelled) return;
        setAspectRatio(vp.height / vp.width);
        setPdf(doc);
      } catch (err) {
        console.error('[OFPModal] render failed:', err);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      // destroys the worker AND the document — frees the decoded PDF (audit #27)
      if (loadingTask) loadingTask.destroy().catch(() => {});
    };
  }, [flightId]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#0f1525', border: '1px solid #1e2a45', borderRadius: 16,
          width: '100%', maxWidth: 900, maxHeight: '92vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          columnGap: 12, padding: '14px 20px', borderBottom: '1px solid #1e2a45', flexShrink: 0,
        }}>
          {/* minWidth: 0 + overflowWrap — sans ça, un nom de fichier insécable impose
              sa largeur au header et pousse le X hors du cadre (overflow: hidden)
              en portrait. */}
          <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>
              {record?.flightNumber ? `${record.flightNumber} — Plan de vol` : 'Plan de vol'}
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
              {record ? `${record.fileName} · ${(record.pageCount ?? pdf?.numPages ?? 0)} page${(record.pageCount ?? pdf?.numPages ?? 0) > 1 ? 's' : ''}` : ''}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4, flexShrink: 0 }}
          >
            <IconClose />
          </button>
        </div>

        {/* Viewer */}
        <div style={{
          flex: 1, overflowY: 'auto', background: '#070c18',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: loading || error ? 0 : '16px 0', gap: 12,
        }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
              <div style={{
                width: 32, height: 32, border: '3px solid rgba(99,179,237,0.2)',
                borderTop: '3px solid #63b3ed', borderRadius: '50%',
                animation: 'spin 1s linear infinite',
              }} />
            </div>
          ) : error || !pdf ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
              <p style={{ fontSize: 12, color: '#475569' }}>Plan de vol introuvable.</p>
            </div>
          ) : (
            Array.from({ length: pdf.numPages }, (_, i) => (
              <OFPPage key={i + 1} pdf={pdf} pageNumber={i + 1} aspectRatio={aspectRatio} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
