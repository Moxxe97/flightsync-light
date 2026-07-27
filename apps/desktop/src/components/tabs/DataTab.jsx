import Icons from '../Icons';
import PdfImportCard from '../PdfImportCard';

export default function DataTab({
  flights,
  residence,
  ofpFlightIds,
  setOfpModalFlightId,
  setDeleteConfirm,
  handlePdfImport,
  notify,
  deviceId,
  readOnly = false,
  onRescoreOfps,
  rescoreBusy = null,
}) {
  return (
    <div style={{ animation: "fadeIn 0.3s ease" }}>
      {!readOnly && (
        <PdfImportCard onImport={handlePdfImport} notify={notify} storedFlights={flights} deviceId={deviceId} style={{ marginBottom: 20 }} />
      )}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "#94a3b8", letterSpacing: "0.04em" }}>
            FLIGHTS LOGGED ({flights.length})
          </h3>
          {!readOnly && onRescoreOfps && ofpFlightIds.size > 0 && (
            <button
              onClick={onRescoreOfps}
              disabled={!!rescoreBusy}
              title="Recompute each flight's Canadian hours and distances from its stored OFP"
              style={{
                background: "none", border: "1px solid #1e3a5f", borderRadius: 6,
                color: "#63b3ed", cursor: rescoreBusy ? "wait" : "pointer",
                padding: "5px 10px", fontSize: 11, opacity: rescoreBusy ? 0.5 : 0.8,
                transition: "opacity 0.15s",
              }}
              onMouseEnter={e => { if (!rescoreBusy) e.currentTarget.style.opacity = 1; }}
              onMouseLeave={e => { if (!rescoreBusy) e.currentTarget.style.opacity = 0.8; }}
            >
              {rescoreBusy
                ? `Recomputing ${rescoreBusy.done}/${rescoreBusy.total}…`
                : "↻ Recompute (OFP)"}
            </button>
          )}
        </div>

        {flights.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "#475569" }}>
            <Icons.Plane />
            <p style={{ marginTop: 12, fontSize: 14 }}>No flights logged</p>
            <p style={{ fontSize: 12, marginTop: 4 }}>Drop your OFP PDFs here or import a JSON backup from the Backup tab.</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 4px" }}>
              <thead>
                <tr>
                  {["Date", "Flight", "Route", "Total Hours", "Canada Hours", "% CAN", "Device", ""].map((h) => (
                    <th key={h} style={{
                      textAlign: "left", padding: "8px 12px", fontSize: 10, color: "#475569",
                      letterSpacing: "0.1em", fontWeight: 600, borderBottom: "1px solid #1e2a45",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...flights]
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((f, i) => (
                    <tr key={f.id} style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)" }}>
                      <td className="mono" style={{ padding: "10px 12px", fontSize: 13, color: "#a0aec0" }}>{f.date}</td>
                      <td className="mono" style={{ padding: "10px 12px", fontSize: 13, color: "#63b3ed", fontWeight: 500 }}>{f.flightNumber}</td>
                      <td style={{ padding: "10px 12px", fontSize: 13, color: "#a0aec0" }}>{f.departure} → {f.arrival}</td>
                      <td className="mono" style={{ padding: "10px 12px", fontSize: 13, color: "#a0aec0" }}>{f.totalTime?.toFixed(1)}h</td>
                      <td className="mono" style={{ padding: "10px 12px", fontSize: 13, color: "#f59e0b" }}>{f.canadianTime?.toFixed(1)}h</td>
                      <td className="mono" style={{ padding: "10px 12px", fontSize: 13, color: "#10b981" }}>
                        {f.distance > 0 ? ((f.canadianDistance / f.distance) * 100).toFixed(0) : 0}%
                      </td>
                      <td className="mono" style={{ padding: "10px 12px", fontSize: 11, color: "#475569" }}>{f._deviceId || "—"}</td>
                      <td style={{ padding: "6px 8px", display: "flex", gap: 4, alignItems: "center" }}>
                        {ofpFlightIds.has(f.id) && (
                          <button
                            onClick={() => setOfpModalFlightId(f.id)}
                            title="View flight plan"
                            style={{
                              background: "none", border: "1px solid #1e3a5f", borderRadius: 6,
                              color: "#63b3ed", cursor: "pointer", padding: "3px 7px", fontSize: 11,
                              opacity: 0.7, transition: "opacity 0.15s",
                            }}
                            onMouseEnter={e => e.currentTarget.style.opacity = 1}
                            onMouseLeave={e => e.currentTarget.style.opacity = 0.7}
                          >OFP</button>
                        )}
                        {!readOnly && (
                          <button
                            onClick={() => setDeleteConfirm({ id: f.id, flightNumber: f.flightNumber, date: f.date })}
                            title="Delete this flight"
                            style={{
                              background: "none", border: "1px solid #7f1d1d", borderRadius: 6,
                              color: "#ef4444", cursor: "pointer", padding: "3px 7px", fontSize: 11,
                              opacity: 0.6, transition: "opacity 0.15s",
                            }}
                            onMouseEnter={e => e.currentTarget.style.opacity = 1}
                            onMouseLeave={e => e.currentTarget.style.opacity = 0.6}
                          >✕</button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {residence.length > 0 && (
        <div className="card" style={{ marginTop: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: "#94a3b8", letterSpacing: "0.04em" }}>
            RESIDENCE DAYS ({residence.length})
          </h3>
          <div className="row-stack" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            {[
              { label: "Canada", count: residence.filter((r) => r.location === "canada").length, color: "#ef4444", icon: "🏠" },
              { label: "Home", count: residence.filter((r) => r.location === "mexico").length, color: "#10b981", icon: "🌴" },
              { label: "International", count: residence.filter((r) => r.location === "international").length, color: "#63b3ed", icon: "🌍" },
              { label: "Outside Canada", count: residence.filter((r) => r.location !== "canada").length, color: "#a78bfa", icon: "✈️" },
            ].map((cat) => (
              <div key={cat.label} style={{ padding: 16, background: "#0a0f1e", borderRadius: 10, textAlign: "center" }}>
                <div style={{ fontSize: 24 }}>{cat.icon}</div>
                <div className="stat-value" style={{ color: cat.color, fontSize: 22, margin: "8px 0 4px" }}>{cat.count}</div>
                <div style={{ fontSize: 11, color: "#475569", letterSpacing: "0.06em" }}>{cat.label.toUpperCase()}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
