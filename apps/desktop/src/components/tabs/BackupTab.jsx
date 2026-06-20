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
}) {
  const signedIn = !!authUser;
  const status = backupState?.status;
  const errorDetail = status === 'error' ? backupState?.log?.[0]?.detail : null;
  const reconnectNeeded = !!errorDetail && /reconnexion requise/i.test(errorDetail);
  const actionsDisabled = !signedIn || status === 'syncing';

  return (
    <div style={{ animation: "fadeIn 0.3s ease", display: "grid", gap: 20 }}>
      {/* ─── Compte Google — the only auth UI in the app ─── */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #1e3a5f, #0f2340)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icons.Cloud />
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: "#f1f5f9" }}>Compte Google</h3>
            <p style={{ fontSize: 12, color: "#64748b" }}>
              {signedIn ? `Connecté : ${authUser.email}` : "Sauvegarde de secours sur votre propre Drive"}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 16, background: "#0f1525", borderRadius: 10, border: "1px solid #1e2a45" }}>
          <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
            {signedIn
              ? "Sauvegarde automatique vers votre Google Drive — vos données ne quittent jamais votre compte."
              : "L'app fonctionne sans compte. Connectez un compte Google pour activer la sauvegarde de secours sur votre propre Drive."}
          </div>
          {signedIn ? (
            <button
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: "6px 12px", whiteSpace: "nowrap" }}
              onClick={onSignOutRequest}
            >
              Se déconnecter
            </button>
          ) : (
            <button
              className="btn btn-primary"
              style={{ fontSize: 12, padding: "6px 12px", whiteSpace: "nowrap" }}
              onClick={onSignIn}
            >
              Se connecter avec Google
            </button>
          )}
        </div>
      </div>

      {/* ─── Sauvegarde Google Drive ─── */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #1e3a5f, #0f2340)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icons.Shield />
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: "#f1f5f9" }}>Sauvegarde Google Drive</h3>
            <p style={{ fontSize: 12, color: "#64748b" }}>Sauvegarde de secours sur votre propre Drive</p>
          </div>
        </div>

        <div style={{ padding: 16, background: "#0f1525", borderRadius: 10, border: "1px solid #1e2a45", marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8, fontWeight: 600, letterSpacing: "0.04em" }}>DERNIER BACKUP</div>
          <div className="mono" style={{ fontSize: 14, color: lastBackup ? "#10b981" : "#f59e0b" }}>
            {lastBackup ? formatDate(lastBackup) : "Aucun backup effectué"}
          </div>
          {status === 'syncing' && (
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>Sauvegarde en cours…</div>
          )}
          {status === 'error' && errorDetail && (
            reconnectNeeded ? (
              <button
                className="btn btn-primary"
                style={{ fontSize: 12, padding: "6px 12px", marginTop: 10 }}
                onClick={onSignIn}
              >
                Reconnexion requise — se reconnecter
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
            <Icons.Cloud /> Sauvegarder maintenant (données + PDF)
          </button>
          <button
            className="btn btn-secondary"
            onClick={onRestoreRequest}
            disabled={actionsDisabled}
            style={{ flex: "1 1 180px", justifyContent: "center" }}
          >
            <Icons.Download /> Restaurer depuis Drive
          </button>
        </div>
      </div>

      {/* ─── Sauvegarde vers un dossier local ─── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 18 }}>📁</span>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: "#f1f5f9", margin: 0 }}>Dossier local</h3>
            <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>
              Sauvegarde automatique dans un dossier de votre Mac — placez-le dans
              iCloud Drive ou Dropbox pour une copie hors de l'appareil, sans compte Google.
            </p>
          </div>
        </div>
        {backupFolder ? (
          <>
            <p className="mono" style={{ fontSize: 11, color: "#94a3b8", overflowWrap: "anywhere" }}>{backupFolder}</p>
            {folderBackupStatus && (
              <p style={{ fontSize: 11, color: folderBackupStatus.error ? "#ef4444" : "#10b981" }}>
                {folderBackupStatus.error
                  ? `Erreur : ${folderBackupStatus.error}`
                  : `Dernière sauvegarde : ${formatDate(folderBackupStatus.at)}`}
              </p>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={runFolderBackupNow}>Sauvegarder maintenant</button>
              <button className="btn btn-secondary" onClick={restoreFromFolder}>Restaurer depuis le dossier</button>
              <button className="btn btn-secondary" onClick={chooseBackupFolder}>Changer de dossier</button>
              <button className="btn btn-secondary" onClick={disableFolderBackup}>Désactiver</button>
            </div>
          </>
        ) : (
          <button className="btn btn-primary" onClick={chooseBackupFolder}>Choisir un dossier…</button>
        )}
      </div>

      {/* ─── Export / import de fichier local ─── */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #065f46, #064e3b)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icons.Download />
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: "#f1f5f9" }}>Fichier local (JSON)</h3>
            <p style={{ fontSize: 12, color: "#64748b" }}>Export / import manuel d'un fichier sur ce Mac</p>
          </div>
        </div>

        <div className="row-stack" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ padding: 20, background: "#0a0f1e", borderRadius: 12, textAlign: "center" }}>
            <Icons.Download />
            <h4 style={{ fontSize: 14, fontWeight: 600, margin: "12px 0 8px", color: "#f1f5f9" }}>Exporter (fichier)</h4>
            <p style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>
              Télécharge un fichier JSON complet de vos données.
            </p>
            <button className="btn btn-primary" onClick={exportToJSON} style={{ width: "100%", justifyContent: "center" }}>
              <Icons.Download /> Exporter JSON
            </button>
          </div>

          <div style={{ padding: 20, background: "#0a0f1e", borderRadius: 12, textAlign: "center" }}>
            <Icons.Upload />
            <h4 style={{ fontSize: 14, fontWeight: 600, margin: "12px 0 8px", color: "#f1f5f9" }}>Importer (fichier)</h4>
            <p style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>
              Importez depuis un fichier JSON ou CSV. Choix de fusionner ou remplacer les données existantes.
            </p>
            <button className="btn btn-secondary" onClick={handleImportClick} style={{ width: "100%", justifyContent: "center" }}>
              <Icons.Upload /> Importer JSON / CSV
            </button>
            <p style={{ fontSize: 10, color: "#374151", marginTop: 8 }}>Accepte : .json .csv .tsv</p>
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
            <p style={{ fontSize: 12, color: "#64748b" }}>Pour déclarations fiscales et analyse dans Excel/Numbers</p>
          </div>
        </div>
        <button className="btn btn-success" onClick={exportToCSV}>
          <Icons.Download /> Exporter CSV
        </button>
      </div>

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #7c3aed, #5b21b6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icons.Calendar />
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: "#f1f5f9" }}>Sync Calendar & Plans de Vol</h3>
            <p style={{ fontSize: 12, color: "#64748b" }}>Demandez à Claude d'extraire vos données depuis votre calendrier ou vos PDFs</p>
          </div>
        </div>

        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ padding: 16, background: "#0f1525", borderRadius: 10, border: "1px solid #1e2a45" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#10b981", marginBottom: 6 }}>Export .ics (Apple / Google Calendar)</div>
            <p style={{ fontSize: 12, color: "#64748b", marginBottom: 12, lineHeight: 1.6 }}>
              Génère un fichier .ics importable dans n'importe quel calendrier (iCloud, Google, Outlook).
              Chaque vol devient un événement avec durée, route et données canadiennes.
            </p>
            <button className="btn btn-success" onClick={handleExportICS} disabled={flights.length === 0}>
              <Icons.Download /> Télécharger .ics ({flights.length} vol{flights.length !== 1 ? 's' : ''})
            </button>
          </div>

        </div>
      </div>

      <div className="card" style={{ borderColor: "#7f1d1d" }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "#ef4444", letterSpacing: "0.04em" }}>ZONE DE DANGER</h3>
        <p style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>Ces actions sont irréversibles. Assurez-vous d'avoir un backup avant de continuer.</p>
        <button className="btn btn-danger" onClick={clearAllData}>
          <Icons.Trash /> Supprimer toutes les données
        </button>
      </div>
    </div>
  );
}
