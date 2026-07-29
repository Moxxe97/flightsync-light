import Icons from '../Icons';
import { formatDate } from '@flightsync/core/util';

export default function BackupTab({
  flights,
  authUser,
  backupState,
  lastBackup,
  onSignIn,
  onSignOutRequest,
  onBackupNow,
  onRestoreRequest,
  exportToJSON,
  handleImportClick,
  exportToCSV,
  handleExportICS,
  clearAllData,
  backupFolder,
  folderBackupStatus,
  chooseBackupFolder,
  disableFolderBackup,
  runFolderBackupNow,
  restoreFromFolder,
  isMobile,
}) {
  const signedIn = !!authUser;
  const status = backupState?.status;
  const errorDetail = status === 'error' ? backupState?.log?.[0]?.detail : null;
  const reconnectNeeded = !!errorDetail && /reconnection required/i.test(errorDetail);
  const actionsDisabled = !signedIn || status === 'syncing';

  return (
    <div style={{ animation: "fadeIn 0.3s ease", display: "grid", gap: 20 }}>
      {/* ─── Google account — the only auth UI in the app ─── */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #1e3a5f, #0f2340)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icons.Cloud />
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: "#f1f5f9" }}>Google Account</h3>
            <p style={{ fontSize: 12, color: "#64748b" }}>
              {signedIn ? `Signed in: ${authUser.email}` : "Safety backup to your own Drive"}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 16, background: "#0f1525", borderRadius: 10, border: "1px solid #1e2a45" }}>
          <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
            {signedIn
              ? "Automatic backup to your Google Drive — your data never leaves your account."
              : "The app works without an account. Connect a Google account to enable the safety backup to your own Drive."}
          </div>
          {signedIn ? (
            <button
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: "6px 12px", whiteSpace: "nowrap" }}
              onClick={onSignOutRequest}
            >
              Sign out
            </button>
          ) : (
            <button
              className="btn btn-primary"
              style={{ fontSize: 12, padding: "6px 12px", whiteSpace: "nowrap" }}
              onClick={onSignIn}
            >
              Sign in with Google
            </button>
          )}
        </div>
      </div>

      {/* ─── Google Drive backup ─── */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #1e3a5f, #0f2340)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icons.Shield />
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: "#f1f5f9" }}>Google Drive Backup</h3>
            <p style={{ fontSize: 12, color: "#64748b" }}>Safety backup to your own Drive</p>
          </div>
        </div>

        <div style={{ padding: 16, background: "#0f1525", borderRadius: 10, border: "1px solid #1e2a45", marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8, fontWeight: 600, letterSpacing: "0.04em" }}>LAST BACKUP</div>
          <div className="mono" style={{ fontSize: 14, color: lastBackup ? "#10b981" : "#f59e0b" }}>
            {lastBackup ? formatDate(lastBackup) : "No backup yet"}
          </div>
          {status === 'syncing' && (
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>Backing up…</div>
          )}
          {status === 'error' && errorDetail && (
            reconnectNeeded ? (
              <button
                className="btn btn-primary"
                style={{ fontSize: 12, padding: "6px 12px", marginTop: 10 }}
                onClick={onSignIn}
              >
                Reconnection required — sign in again
              </button>
            ) : (
              <div style={{ fontSize: 12, color: "#ef4444", marginTop: 8 }}>{errorDetail}</div>
            )
          )}
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button
            className="btn btn-primary"
            onClick={onBackupNow}
            disabled={actionsDisabled}
            style={{ flex: "1 1 220px", justifyContent: "center" }}
          >
            <Icons.Cloud /> Back up now (data + PDFs)
          </button>
          <button
            className="btn btn-secondary"
            onClick={onRestoreRequest}
            disabled={actionsDisabled}
            style={{ flex: "1 1 180px", justifyContent: "center" }}
          >
            <Icons.Download /> Restore from Drive
          </button>
        </div>
      </div>

      {/* ─── Local folder backup ─── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 18 }}>📁</span>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: "#f1f5f9", margin: 0 }}>Local Folder</h3>
            <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>
              {isMobile
                ? "Automatic backup into this app's Documents folder — on iPhone it appears in the Files app under FlightSync Light."
                : "Automatic backup to a folder on your Mac — put it in iCloud Drive or Dropbox for an off-device copy, no Google account needed."}
            </p>
          </div>
        </div>
        {backupFolder ? (
          <>
            <p className="mono" style={{ fontSize: 11, color: "#94a3b8", overflowWrap: "anywhere" }}>{backupFolder}</p>
            {folderBackupStatus && (
              <p style={{ fontSize: 11, color: folderBackupStatus.error ? "#ef4444" : "#10b981" }}>
                {folderBackupStatus.error
                  ? `Error: ${folderBackupStatus.error}`
                  : `Last backup: ${formatDate(folderBackupStatus.at)}`}
              </p>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={runFolderBackupNow}>Back up now</button>
              <button className="btn btn-secondary" onClick={restoreFromFolder}>Restore from folder</button>
              {!isMobile && (
                <button className="btn btn-secondary" onClick={chooseBackupFolder}>Change folder</button>
              )}
              <button className="btn btn-secondary" onClick={disableFolderBackup}>Turn off</button>
            </div>
          </>
        ) : (
          <button className="btn btn-primary" onClick={chooseBackupFolder}>
            {isMobile ? "Enable local backup" : "Choose a folder…"}
          </button>
        )}
      </div>

      {/* ─── Local file export / import ─── */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #065f46, #064e3b)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icons.Download />
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: "#f1f5f9" }}>Local File (JSON)</h3>
            <p style={{ fontSize: 12, color: "#64748b" }}>Manual file export / import on this Mac</p>
          </div>
        </div>

        <div className="row-stack" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ padding: 20, background: "#0a0f1e", borderRadius: 12, textAlign: "center" }}>
            <Icons.Download />
            <h4 style={{ fontSize: 14, fontWeight: 600, margin: "12px 0 8px", color: "#f1f5f9" }}>Export (file)</h4>
            <p style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>
              Downloads a complete JSON file of your data.
            </p>
            <button className="btn btn-primary" onClick={exportToJSON} style={{ width: "100%", justifyContent: "center" }}>
              <Icons.Download /> Export JSON
            </button>
          </div>

          <div style={{ padding: 20, background: "#0a0f1e", borderRadius: 12, textAlign: "center" }}>
            <Icons.Upload />
            <h4 style={{ fontSize: 14, fontWeight: 600, margin: "12px 0 8px", color: "#f1f5f9" }}>Import (file)</h4>
            <p style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>
              Import from a JSON or CSV file. Choose to merge with or replace existing data.
            </p>
            <button className="btn btn-secondary" onClick={handleImportClick} style={{ width: "100%", justifyContent: "center" }}>
              <Icons.Upload /> Import JSON / CSV
            </button>
            <p style={{ fontSize: 10, color: "#374151", marginTop: 8 }}>Accepts: .json .csv .tsv</p>
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #065f46, #064e3b)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icons.Download />
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: "#f1f5f9" }}>Export CSV (Excel / Numbers)</h3>
            <p style={{ fontSize: 12, color: "#64748b" }}>For tax filings and analysis in Excel/Numbers</p>
          </div>
        </div>
        <button className="btn btn-success" onClick={exportToCSV}>
          <Icons.Download /> Export CSV
        </button>
      </div>

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #7c3aed, #5b21b6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icons.Calendar />
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: "#f1f5f9" }}>Calendar & Flight Plan Export</h3>
            <p style={{ fontSize: 12, color: "#64748b" }}>Take your flights with you as calendar events</p>
          </div>
        </div>

        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ padding: 16, background: "#0f1525", borderRadius: 10, border: "1px solid #1e2a45" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#10b981", marginBottom: 6 }}>Export .ics (Apple / Google Calendar)</div>
            <p style={{ fontSize: 12, color: "#64748b", marginBottom: 12, lineHeight: 1.6 }}>
              Generates an .ics file you can import into any calendar (iCloud, Google, Outlook).
              Each flight becomes an event with duration, route and Canadian data.
            </p>
            <button className="btn btn-success" onClick={handleExportICS} disabled={flights.length === 0}>
              <Icons.Download /> Download .ics ({flights.length} flight{flights.length !== 1 ? 's' : ''})
            </button>
          </div>

        </div>
      </div>

      <div className="card" style={{ borderColor: "#7f1d1d" }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "#ef4444", letterSpacing: "0.04em" }}>DANGER ZONE</h3>
        <p style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>These actions are irreversible. Make sure you have a backup before continuing.</p>
        <button className="btn btn-danger" onClick={clearAllData}>
          <Icons.Trash /> Delete all data
        </button>
      </div>
    </div>
  );
}
