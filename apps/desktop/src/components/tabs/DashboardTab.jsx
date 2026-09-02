import Icons from '../Icons';
import { formatDate } from '@flightsync/core/util';
import { useIsMobile } from '../../utils/useIsMobile';
import { tallyResidence } from '../../utils/residence';
import { residencyProgress, residencyThresholdDays } from '../../utils/residencyThreshold';

export default function DashboardTab({
  flights,
  residence,
  totalHours,
  canadianHours,
  canadianTimePct,
  fiscalYear,
  daysOutside,
  backupOverdue,
  lastBackup,
  settings,
  authUser,
  saveToGDrive,
  notify,
  syncToCloud,
  exportToJSON,
  exportToCSV,
  handleImportClick,
  readOnly = false,
}) {
  const isEmpty = flights.length === 0 && residence.length === 0;
  const isConnected = !!authUser;
  const isMobile = useIsMobile();
  const tally = tallyResidence(residence);
  const threshold = residencyThresholdDays(fiscalYear?.year);

  return (
    <div style={{ animation: "fadeIn 0.3s ease" }}>
      {!readOnly && isEmpty && (
        <div className="card" style={{ marginBottom: 24, padding: 32, background: "linear-gradient(135deg, #1e3a5f 0%, #0f2340 100%)", border: "1px solid #2a4a6f" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#f1f5f9", marginBottom: 10, textAlign: "center" }}>Welcome to FlightSync Light</div>
          <p style={{ fontSize: 14, color: "#a0aec0", marginBottom: 28, lineHeight: 1.6, textAlign: "center", maxWidth: 560, marginLeft: "auto", marginRight: "auto" }}>
            Three ways to get started: connect Google Drive for backups, classify your residence days in the Calendar tab, or import an existing JSON backup.
          </p>

          <div className="row-stack" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 8 }}>
            <div style={{ padding: 18, background: "#0a0f1e", borderRadius: 12, border: "1px solid #1e2a45" }}>
              <div style={{ fontSize: 11, color: isConnected ? "#10b981" : "#64748b", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 8 }}>
                1 — GOOGLE DRIVE {isConnected && "✓"}
              </div>
              <p style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14, lineHeight: 1.5 }}>
                Manual export — a safety backup to your own Google Drive.
              </p>
              {isConnected ? (
                <div style={{ fontSize: 12, color: "#10b981", padding: "8px 12px", textAlign: "center" }}>
                  Connected
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "#64748b", padding: "8px 12px", textAlign: "center", fontStyle: "italic" }}>
                  Connect Google in the Backup tab
                </div>
              )}
            </div>

            <div style={{ padding: 18, background: "#0a0f1e", borderRadius: 12, border: "1px solid #1e2a45" }}>
              <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 8 }}>
                2 — CALENDAR
              </div>
              <p style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14, lineHeight: 1.5 }}>
                Classify each day to track your residence days.
              </p>
              <button
                className="btn btn-secondary"
                onClick={() => notify("Open the Calendar tab to classify your days", "info")}
                style={{ width: "100%", justifyContent: "center", fontSize: 12, padding: "8px 12px" }}
              >
                Open the Calendar tab →
              </button>
            </div>

            <div style={{ padding: 18, background: "#0a0f1e", borderRadius: 12, border: "1px solid #1e2a45" }}>
              <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 8 }}>
                3 — IMPORT BACKUP
              </div>
              <p style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14, lineHeight: 1.5 }}>
                Restore an existing JSON backup.
              </p>
              <button
                className="btn btn-secondary"
                onClick={handleImportClick}
                style={{ width: "100%", justifyContent: "center", fontSize: 12, padding: "8px 12px" }}
              >
                Import JSON / CSV
              </button>
            </div>
          </div>

          <p style={{ fontSize: 11, color: "#64748b", marginTop: 18, textAlign: "center" }}>
            Or drop your OFP PDFs in the <strong style={{ color: "#a0aec0" }}>Data</strong> tab for automatic extraction.
          </p>
        </div>
      )}

      {!readOnly && backupOverdue && (
        <div style={{
          padding: "14px 20px", background: "#451a03", border: "1px solid #78350f", borderRadius: 12,
          marginBottom: 24, display: "flex", alignItems: "center", gap: 12, fontSize: 13,
        }}>
          <Icons.Alert />
          <span style={{ color: "#fbbf24" }}>
            {lastBackup
              ? `Last backup: ${formatDate(lastBackup)}. A new backup is recommended.`
              : "No backup yet. Export your data to keep it safe."}
          </span>
          <button className="btn btn-secondary" style={{ marginLeft: "auto", padding: "6px 14px", fontSize: 12 }} onClick={authUser ? () => saveToGDrive(settings).then(ok => ok && notify("Google Drive backup complete", "success")) : exportToJSON}>
            Back up now
          </button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(6, 1fr)", gap: isMobile ? 10 : 16, marginBottom: isMobile ? 20 : 28 }}>
        {[
          { label: "FLIGHTS LOGGED", value: flights.length, color: "#63b3ed" },
          { label: "TOTAL HOURS", value: totalHours.toFixed(1), color: "#a78bfa" },
          { label: "CANADA HOURS", value: canadianHours.toFixed(1), color: "#f59e0b" },
          { label: "% CAN. TIME", value: `${canadianTimePct}%`, color: "#10b981" },
          { label: "DAYS OUTSIDE CANADA", value: daysOutside, color: "#ec4899" },
          { label: "DEVICES", value: 1, color: "#64748b" },
        ].map((stat, i) => (
          <div key={i} className="card" style={{ textAlign: "center", padding: isMobile ? "14px 8px" : "20px 16px" }}>
            <div className="stat-value" style={{ color: stat.color, fontSize: isMobile ? 22 : undefined }}>{stat.value}</div>
            <div style={{ fontSize: isMobile ? 9 : 10, color: "#475569", marginTop: 6, letterSpacing: isMobile ? "0.08em" : "0.1em", fontWeight: 600 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {!readOnly && (
        <div className="card">
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: "#94a3b8", letterSpacing: "0.04em" }}>QUICK ACTIONS</h3>
          <div className="row-stack" style={{ display: "flex", gap: 10, flexWrap: "nowrap" }}>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={syncToCloud}><Icons.Sync /> Back up to Drive</button>
            <button className="btn btn-success" style={{ flex: 1 }} onClick={exportToJSON}><Icons.Download /> Export JSON</button>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={exportToCSV}><Icons.Download /> Export CSV</button>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={handleImportClick}><Icons.Upload /> Import</button>
          </div>
        </div>
      )}

      {flights.length > 0 && (
        <div className="card" style={{ marginTop: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 20, color: "#94a3b8", letterSpacing: "0.04em" }}>
            FISCAL SUMMARY {fiscalYear.year}
          </h3>

          <div className="row-stack" style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 20, marginBottom: 24 }}>
            <div style={{ padding: 20, background: "linear-gradient(135deg, #1e3a5f 0%, #0f2340 100%)", borderRadius: 14, textAlign: "center", border: "1px solid #2a4a6f" }}>
              <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.1em", marginBottom: 8 }}>CANADIAN PROPORTION</div>
              <div className="stat-value" style={{ fontSize: 36, color: "#f59e0b" }}>{fiscalYear.canadianTimePct}%</div>
              <div style={{ fontSize: 12, color: "#475569", marginTop: 6 }}>
                {fiscalYear.canadianHours.toFixed(1)} h / {fiscalYear.totalHours.toFixed(1)} h
              </div>
              <div style={{ fontSize: 10, color: "#374151", marginTop: 6, letterSpacing: "0.04em" }}>
                Distance: {fiscalYear.canadianPct}% ({fiscalYear.canadianDistance.toLocaleString()} / {fiscalYear.totalDistance.toLocaleString()} nm)
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {[
                { label: "TOTAL DISTANCE", value: `${fiscalYear.totalDistance.toLocaleString()} nm`, color: "#a78bfa" },
                { label: "CANADA DISTANCE", value: `${fiscalYear.canadianDistance.toLocaleString()} nm`, color: "#f59e0b" },
              ].map((item, i) => (
                <div key={i} style={{ padding: 14, background: "#0a0f1e", borderRadius: 10 }}>
                  <div style={{ fontSize: 10, color: "#475569", letterSpacing: "0.08em", marginBottom: 4 }}>{item.label}</div>
                  <div className="mono" style={{ fontSize: 16, color: item.color, fontWeight: 500 }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10, fontWeight: 600, letterSpacing: "0.04em" }}>B787 FLIGHTS — {fiscalYear.year}</div>
            <div style={{ display: "grid", gap: 6 }}>
              {fiscalYear.flights.slice().sort((a, b) => a.date.localeCompare(b.date)).map((f) => (
                isMobile ? (
                  <div key={f.id} data-testid="fiscal-flight-row" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 14px", background: "#0a0f1e", borderRadius: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="mono" style={{ fontSize: 13, color: "#63b3ed", fontWeight: 600 }}>{f.flightNumber}</span>
                      <span style={{ fontSize: 13, color: "#a0aec0", flex: 1, minWidth: 0 }}>{f.departure} → {f.arrival}</span>
                      <span className="mono" style={{ fontSize: 11, color: "#475569" }}>{f.date.slice(5)}</span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px" }}>
                      <span className="mono" style={{ fontSize: 12, color: "#a78bfa" }}>{f.totalTime}h</span>
                      <span className="mono" style={{ fontSize: 12, color: "#f59e0b" }}>{f.canadianTime}h CAN</span>
                      <span className="mono" style={{ fontSize: 12, color: "#10b981" }}>{f.distance} nm</span>
                      <span className="mono" style={{ fontSize: 12, color: "#f59e0b", opacity: 0.7 }}>{f.canadianDistance} nm CAN</span>
                    </div>
                  </div>
                ) : (
                  <div key={f.id} data-testid="fiscal-flight-row" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, padding: "10px 14px", background: "#0a0f1e", borderRadius: 8 }}>
                    <span className="mono" style={{ fontSize: 12, color: "#475569", width: 70 }}>{f.date.slice(5)}</span>
                    <span className="mono" style={{ fontSize: 13, color: "#63b3ed", fontWeight: 600, width: 70 }}>{f.flightNumber}</span>
                    <span style={{ fontSize: 13, color: "#a0aec0", flex: 1 }}>{f.departure} → {f.arrival}</span>
                    <span className="mono" style={{ fontSize: 12, color: "#a78bfa" }}>{f.totalTime}h</span>
                    <span className="mono" style={{ fontSize: 12, color: "#f59e0b" }}>{f.canadianTime}h CAN</span>
                    <span className="mono" style={{ fontSize: 12, color: "#f59e0b", opacity: 0.7 }}>{f.canadianDistance} nm CAN</span>
                    <span className="mono" style={{ fontSize: 12, color: "#10b981" }}>{f.distance} nm</span>
                  </div>
                )
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10, fontWeight: 600, letterSpacing: "0.04em" }}>TAX RESIDENCE — {threshold}-DAY THRESHOLD</div>
            <div className="row-stack" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
              {[
                { label: "🏠 CANADA", count: tally.canada, color: "#ef4444" },
                { label: "🌴 HOME", count: tally.mexico, color: "#10b981" },
                { label: "🌍 INTERNATIONAL", count: tally.international, color: "#3b82f6" },
                { label: "✈️ TRANSIT", count: tally.transit, color: "#f59e0b" },
              ].map((cat) => (
                <div key={cat.label} style={{ padding: 14, background: "#0a0f1e", borderRadius: 10, textAlign: "center" }}>
                  <div style={{ fontSize: 11, marginBottom: 4 }}>{cat.label}</div>
                  <div className="mono" style={{ fontSize: 22, color: cat.color, fontWeight: 500 }}>{cat.count}</div>
                  <div style={{ fontSize: 10, color: "#374151" }}>days</div>
                </div>
              ))}
            </div>

            {(() => {
              const outsideDays = tally.outside;
              const { pct, crossed, margin } = residencyProgress(outsideDays, fiscalYear?.year);
              return (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
                    <span style={{ color: "#a0aec0" }}>Days outside Canada: <span className="mono" style={{ color: "#10b981" }}>{outsideDays}</span> / {threshold}</span>
                    <span style={{ color: "#64748b" }}>{crossed ? "Past threshold:" : "Remaining margin:"} <span className="mono" style={{ color: crossed ? "#10b981" : "#f59e0b" }}>{margin}</span> days</span>
                  </div>
                  <div style={{ height: 8, background: "#1e2a45", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 4, transition: "width 1s ease",
                      width: `${pct}%`,
                      background: crossed ? "linear-gradient(90deg, #10b981, #34d399)" : pct < 60 ? "linear-gradient(90deg, #10b981, #34d399)" : pct < 85 ? "linear-gradient(90deg, #f59e0b, #fbbf24)" : "linear-gradient(90deg, #ef4444, #f87171)",
                    }} />
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
