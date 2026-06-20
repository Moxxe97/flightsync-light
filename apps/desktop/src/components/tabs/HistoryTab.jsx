import Icons from '../Icons';
import { formatDate } from '@flightsync/core/util';

// Action → display metadata. Drive-backup entries (action: 'backup' /
// 'backup_error') use the {at, action, detail} shape; the legacy sync entries
// used {timestamp, deviceId, action, flights, residence}. Both render here.
const ACTION_META = {
  backup: { label: "Sauvegarde Drive", bg: "#0f2e1f", color: "#34d399", Icon: Icons.Upload },
  backup_error: { label: "Échec sauvegarde", bg: "#3a1414", color: "#f87171", Icon: Icons.Alert },
  sync_push: { label: "Sauvegarde locale", bg: "#1e3a5f", color: "#63b3ed", Icon: Icons.Upload },
  sync_pull: { label: "Rechargement", bg: "#2d1b69", color: "#a78bfa", Icon: Icons.Download },
};
const DEFAULT_META = { label: "Synchronisation", bg: "#1e2a45", color: "#a0aec0", Icon: Icons.Sync };

export default function HistoryTab({ log }) {
  return (
    <div style={{ animation: "fadeIn 0.3s ease" }}>
      <div className="card">
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 20, color: "#94a3b8", letterSpacing: "0.04em" }}>
          HISTORIQUE DE SYNCHRONISATION
        </h3>
        {log.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "#475569" }}>
            <Icons.History />
            <p style={{ marginTop: 12, fontSize: 14 }}>Aucun historique de synchronisation</p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {log.map((entry, i) => {
              const meta = ACTION_META[entry.action] || DEFAULT_META;
              const { Icon } = meta;
              // Backup entries stamp `at`; legacy entries stamp `timestamp`.
              const when = entry.at ?? entry.timestamp;
              const subtitle = entry.detail
                ?? (entry.flights !== undefined ? `${entry.flights} vols · ${entry.residence || 0} jours` : null);
              return (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "12px 16px",
                  background: i % 2 === 0 ? "#0f1525" : "transparent", borderRadius: 8,
                }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
                    background: meta.bg, color: meta.color, flexShrink: 0,
                  }}>
                    <Icon />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#e2e8f0" }}>{meta.label}</div>
                    <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>{subtitle}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div className="mono" style={{ fontSize: 12, color: "#64748b" }}>{when ? formatDate(when) : '—'}</div>
                    {entry.deviceId && <div className="mono" style={{ fontSize: 10, color: "#374151" }}>{entry.deviceId}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
