import { Suspense, lazy } from 'react';

const PdfDropZone = lazy(() => import('./PdfDropZone'));

// Reusable "Import PDF — flight plans" card used on both the Backup and Data
// pages. Wraps the lazy PdfDropZone with its heading + Suspense fallback.
// `title`/`subtitle` default to the compact Data copy; callers (e.g. Backup)
// can override them. Spacing is left to the caller via `style` — the Backup tab
// uses a grid `gap`, so it passes none; the Data page passes a marginBottom.
export default function PdfImportCard({
  onImport,
  notify,
  storedFlights,
  archiveYears,
  deviceId,
  title = "PDF IMPORT — FLIGHT PLANS",
  subtitle = "OFP or Crew Briefing — automatic flight extraction.",
  style,
}) {
  return (
    <div className="card" style={style}>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#94a3b8", letterSpacing: "0.04em" }}>
        {title}
      </h3>
      <p style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
        {subtitle}
      </p>
      <Suspense fallback={<div style={{ padding: 24, textAlign: "center", color: "#475569", fontSize: 12 }}>Loading PDF module…</div>}>
        <PdfDropZone onImport={onImport} notify={notify} storedFlights={storedFlights} archiveYears={archiveYears} deviceId={deviceId} />
      </Suspense>
    </div>
  );
}
