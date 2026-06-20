import Icons from '../Icons';

export default function ArchiveTab({ archiveYears, expandedArchiveYear, setExpandedArchiveYear, onOpenYear, onBackupToDrive, onRestoreFromDrive }) {
  return (
    <div style={{ animation: "fadeIn 0.3s ease", display: "grid", gap: 16 }}>
      {archiveYears.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 48 }}>
          <Icons.History />
          <p style={{ marginTop: 14, fontSize: 14, color: "#94a3b8" }}>Aucune archive</p>
          <p style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
            Les vols des années passées apparaîtront ici automatiquement.
          </p>
          {onRestoreFromDrive && (
            <button className="btn btn-secondary" style={{ fontSize: 12, padding: '6px 12px', marginTop: 14 }} onClick={onRestoreFromDrive}>
              ↓ Restaurer depuis Drive
            </button>
          )}
        </div>
      ) : <>
        {(onBackupToDrive || onRestoreFromDrive) && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {onRestoreFromDrive && (
              <button className="btn btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }} onClick={onRestoreFromDrive}>
                ↓ Restaurer depuis Drive
              </button>
            )}
            {onBackupToDrive && (
              <button className="btn btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }} onClick={onBackupToDrive}>
                ☁︎ Sauvegarder sur Drive
              </button>
            )}
          </div>
        )}
        {archiveYears.map(({ year, flights: af, residence: ar }) => {
        const isOpen = expandedArchiveYear === year;
        const totalDistance = af.reduce((s, f) => s + (f.distance || 0), 0);
        const totalCanadianDistance = af.reduce((s, f) => s + (f.canadianDistance || 0), 0);
        const canadianPct = totalDistance > 0 ? ((totalCanadianDistance / totalDistance) * 100).toFixed(0) : 0;
        const daysCanada = ar.filter(r => r.location === "canada").length;
        const daysOutside = ar.filter(r => r.location !== "canada").length;
        return (
          <div key={year} className="card" style={{ padding: 0, overflow: "hidden" }}>
            <button
              onClick={() => setExpandedArchiveYear(isOpen ? null : year)}
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "16px 20px", background: "none", border: "none", cursor: "pointer",
                color: "#f1f5f9", textAlign: "left",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>{year}</span>
                <span style={{ fontSize: 12, color: "#64748b" }}>{af.length} vol{af.length !== 1 ? "s" : ""}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {onOpenYear && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); onOpenYear(year); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onOpenYear(year); } }}
                    style={{ fontSize: 12, color: "#63b3ed", border: "1px solid #1e3a5f", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}
                  >Ouvrir l'année →</span>
                )}
                <span style={{ color: "#475569", fontSize: 16, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>▶</span>
              </div>
            </button>

            {isOpen && (
              <div style={{ borderTop: "1px solid #1e2a45", padding: "20px" }}>
                <div className="row-stack" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
                  {[
                    { label: "VOLS", value: af.length, color: "#63b3ed" },
                    { label: "TEMPS CA %", value: `${canadianPct}%`, color: "#f59e0b" },
                    { label: "JOURS CA", value: daysCanada, color: "#ef4444" },
                    { label: "HORS CA", value: daysOutside, color: "#a78bfa" },
                  ].map(chip => (
                    <div key={chip.label} style={{ background: "#0a0f1e", borderRadius: 8, padding: "12px 10px", textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: chip.color }}>{chip.value}</div>
                      <div style={{ fontSize: 10, color: "#475569", marginTop: 4, letterSpacing: "0.06em" }}>{chip.label}</div>
                    </div>
                  ))}
                </div>

                {af.length === 0 ? (
                  <p style={{ fontSize: 12, color: "#475569", textAlign: "center", padding: 16 }}>Aucun vol archivé pour {year}.</p>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #1e2a45" }}>
                          {["Date", "Vol", "Route", "Total", "Canada", "%"].map(h => (
                            <th key={h} className="mono" style={{ padding: "8px 12px", fontSize: 10, color: "#475569", textAlign: "left", letterSpacing: "0.06em", fontWeight: 600 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[...af].sort((a, b) => b.date.localeCompare(a.date)).map((f, i) => (
                          <tr key={f.id || i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)" }}>
                            <td className="mono" style={{ padding: "10px 12px", fontSize: 13, color: "#a0aec0" }}>{f.date}</td>
                            <td className="mono" style={{ padding: "10px 12px", fontSize: 13, color: "#63b3ed", fontWeight: 500 }}>{f.flightNumber}</td>
                            <td style={{ padding: "10px 12px", fontSize: 13, color: "#a0aec0" }}>{f.departure} → {f.arrival}</td>
                            <td className="mono" style={{ padding: "10px 12px", fontSize: 13, color: "#a0aec0" }}>{f.totalTime?.toFixed(1)}h</td>
                            <td className="mono" style={{ padding: "10px 12px", fontSize: 13, color: "#f59e0b" }}>{f.canadianTime?.toFixed(1)}h</td>
                            <td className="mono" style={{ padding: "10px 12px", fontSize: 13, color: "#10b981" }}>
                              {f.distance > 0 ? ((f.canadianDistance / f.distance) * 100).toFixed(0) : 0}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      </>}
    </div>
  );
}
