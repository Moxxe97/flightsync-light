import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from "react";
import './App.css';
import { exportICS } from './utils/icsExport';
import { runBackup, findBackup, downloadBackup, restoreBlobs, BACKUP_FILENAME } from './utils/driveBackup';
import { runFolderBackup, restoreFolderBlobs } from './utils/folderBackup';
import { tallyResidence } from './utils/residence';
import { selectDisplayData, archiveYearList, adjacentYear } from './utils/archiveView';
import { getAllBoardingPassDates } from '@flightsync/core/idb';
import { onAuthChanged, signOut, signInWithGoogle } from './utils/cloudAuth';
import ConfirmModal from './components/ConfirmModal';
import BoardingPassModal from './components/BoardingPassModal';
const OFPModal = lazy(() => import('./components/OFPModal'));
import DayPanel from './components/DayPanel';
import { getAllOFPFlightIds, getAllBoardingPassInfo, getArchiveYear } from '@flightsync/core/idb';
import { listArchiveYears, saveYearToArchive, migrateLocalStorageArchives } from './utils/archiveStore';
import { backupYearToDrive, backupAllYears, restoreAllFromDrive } from './utils/driveArchive';
import { parseBackupJson, sanitizeStoredRows } from './utils/importValidation';
import { csvEscape } from './utils/exportEscape';
import Icons from './components/Icons';
import { SECTIONS } from './navigation/sections';
import { useIsMobile } from './utils/useIsMobile';
import { useMobileNav } from './utils/useMobileNav';
import MobileHomeMenu from './components/MobileHomeMenu';
import MobileSectionHeader from './components/MobileSectionHeader';
import { now, formatDate, timeSince } from '@flightsync/core/util';
import { mergeImportedFlights } from '@flightsync/core/parsing/merge-flights';
import HistoryTab from './components/tabs/HistoryTab';
import ArchiveTab from './components/tabs/ArchiveTab';
import DataTab from './components/tabs/DataTab';
import BackupTab from './components/tabs/BackupTab';
import DashboardTab from './components/tabs/DashboardTab';
import CalendarTab from './components/tabs/CalendarTab';
import { computeAllTimeSummary, computeFiscalYear } from '@flightsync/core/tax';

// ─────────────────────────────────────────────────────────
// AIR CANADA FLIGHT TRACKER — COMPLETE SYNC SYSTEM
// Local-first · Sauvegarde Google Drive · Calendrier
// ─────────────────────────────────────────────────────────

const STORAGE_KEYS = {
  FLIGHTS: "ac-flights-data",
  RESIDENCE: "ac-residence-data",
  SETTINGS: "ac-sync-settings",
  SYNC_LOG: "ac-sync-log",
  DEVICE_ID: "ac-device-id",
};

const SYNC_VERSION = "2.0.0";

// Debounced auto-backup: fire 3 minutes after the last data change.
const AUTO_BACKUP_DELAY_MS = 3 * 60 * 1000;

// ─── localStorage adapter (replaces window.storage) ───
const storage = {
  get: async (key) => ({ value: localStorage.getItem(key) }),
  set: async (key, value) => { localStorage.setItem(key, value); },
  delete: async (key) => { localStorage.removeItem(key); },
};


// Generate unique device ID
const generateDeviceId = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "DEV-";
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
};

export default function FlightSyncSystem() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const isMobile = useIsMobile();
  const mobileNav = useMobileNav();
  // Single source of truth for the visible section: the mobile shell drives it
  // through history-backed `mobileNav.section`; desktop drives it through `activeTab`.
  // Deriving (rather than mirroring into `activeTab`) keeps `activeTab`-dependent
  // effects firing correctly when back-nav resets `mobileNav.section` to null.
  const activeSection = isMobile ? mobileNav.section : activeTab;
  const openSection = (id) => { mobileNav.open(id); };
  const [deviceId, setDeviceId] = useState("");
  const [authUser, setAuthUser] = useState(null); // null = signed out, profile object = signed in
  const [backupState, setBackupState] = useState(() => ({
    status: 'idle', // idle | syncing | success | error
    // Single source of truth for lastBackup — an ISO string (matches now()),
    // persisted to localStorage('fsl-last-backup') so it lives OUTSIDE React
    // `settings` state. Keeping it out of settings is load-bearing: the
    // auto-backup scheduler effect has `settings` in its deps, so a backup
    // runner that wrote setSettings(...) would re-arm the timer → infinite loop.
    lastBackup: (typeof localStorage !== 'undefined' && localStorage.getItem('fsl-last-backup')) || null,
    log: [],
  }));
  const [flights, setFlights] = useState([]);
  const [residence, setResidence] = useState([]);
  const [settings, setSettings] = useState({
    autoSync: true,
    syncInterval: 5, // minutes
    mergeStrategy: "newest", // newest | manual | device-priority
    backupReminder: 7, // days
    backupFolder: '', // local folder destination for folder auto-backup
  });
  const [isLoading, setIsLoading] = useState(true);
  const backupTimerRef = useRef(null);
  const backupStatusResetRef = useRef(null);
  const folderBackupTimerRef = useRef(null);
  const [folderBackupStatus, setFolderBackupStatus] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [notification, setNotification] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const restoreOfferDismissedRef = useRef(false);
  const [boardingPassDates, setBoardingPassDates] = useState(new Set());
  const [dayPanelDate, setDayPanelDate] = useState(null); // date string or null
  const [viewingPass, setViewingPass] = useState(null);
  const [ofpFlightIds, setOfpFlightIds] = useState(new Set());
  const [ofpModalFlightId, setOfpModalFlightId] = useState(null);
  const [archiveYears, setArchiveYears] = useState([]); // [{ year, flights, residence }] newest first
  const [migrationDone, setMigrationDone] = useState(false); // gate auto-archive until the ls→idb migration completes
  const [viewYear, setViewYear] = useState(null); // null = live current year; "2025" = frozen archived year
  const [expandedArchiveYear, setExpandedArchiveYear] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { id, flightNumber, date }
  const [signOutConfirm, setSignOutConfirm] = useState(false);
  const [restoreOffer, setRestoreOffer] = useState(null); // { fileId } | null
  const [clearAllConfirm, setClearAllConfirm] = useState(false);
  const fileInputRef = useRef(null);

  // ─── BOARDING PASS DATES ─────────────────────────────
  const refreshBoardingPassDates = useCallback(async () => {
    const dates = await getAllBoardingPassDates();
    setBoardingPassDates(dates);
  }, []);

  useEffect(() => { refreshBoardingPassDates(); }, []);

  // ─── OFP FLIGHT IDS ──────────────────────────────────
  const refreshOFPIds = useCallback(async () => {
    const ids = await getAllOFPFlightIds();
    setOfpFlightIds(ids);
  }, []);

  useEffect(() => { refreshOFPIds(); }, []);

  // ─── ARCHIVE ──────────────────────────────────────────
  const loadArchives = useCallback(async () => {
    setArchiveYears(await listArchiveYears());
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const ofpFlightIds = [...await getAllOFPFlightIds()];
        const bpDates = (await getAllBoardingPassInfo()).map((b) => b.date);
        await migrateLocalStorageArchives({ ofpFlightIds, bpDates });
      } catch (err) {
        console.warn('[archive] migration skipped:', err.message);
      }
      await loadArchives();
      setMigrationDone(true);
    })();
  }, [loadArchives]);

  // ─── AUTO-ARCHIVE PREVIOUS-YEAR FLIGHTS ────────────────
  const archiveFiredRef = useRef(false);
  useEffect(() => {
    if (!migrationDone) return;
    if (flights.length === 0) return;          // not loaded yet
    if (archiveFiredRef.current) return;       // already ran this session
    archiveFiredRef.current = true;            // set immediately to prevent re-runs

    const currentYear = String(new Date().getFullYear());
    const toArchive = flights.filter(f => f.date && !f.date.startsWith(currentYear));
    if (toArchive.length === 0) return;        // nothing to archive

    // Group flights by year
    const byYear = {};
    for (const f of toArchive) {
      const yr = f.date.slice(0, 4);
      if (!byYear[yr]) byYear[yr] = [];
      byYear[yr].push(f);
    }

    (async () => {
      const ofpFlightIds = [...await getAllOFPFlightIds()];
      const bpDates = (await getAllBoardingPassInfo()).map((b) => b.date);

      // Archive flights + residence per past year into the IndexedDB store.
      // Build the year set from BOTH flights and residence so a past year that
      // has residence days but no flights is still archived.
      const toArchiveRes = residence.filter((r) => r.date && !r.date.startsWith(currentYear));
      const pastYears = new Set([...Object.keys(byYear), ...toArchiveRes.map((r) => r.date.slice(0, 4))]);
      for (const yr of pastYears) {
        const yrFlights = byYear[yr] || [];
        const yrResidence = residence.filter((r) => r.date && r.date.slice(0, 4) === yr);
        await saveYearToArchive(yr, { flights: yrFlights, residence: yrResidence, ofpFlightIds, bpDates });
      }

      // Remove archived entries from the active store (unchanged behaviour).
      const toKeep = flights.filter((f) => !f.date || f.date.startsWith(currentYear));
      const toKeepRes = residence.filter((r) => !r.date || r.date.startsWith(currentYear));
      await storage.set(STORAGE_KEYS.FLIGHTS, JSON.stringify(toKeep));
      await storage.set(STORAGE_KEYS.RESIDENCE, JSON.stringify(toKeepRes));
      setFlights(toKeep);
      setResidence(toKeepRes);

      loadArchives();

      // Best-effort: back up the freshly archived years to Drive. Never let a
      // Drive failure affect the (already-durable) local archive.
      if (authUser) {
        for (const yr of pastYears) {
          try {
            // saveYearToArchive just wrote this year, so getArchiveYear returns it.
            const rec = await getArchiveYear(yr);
            if (rec) await backupYearToDrive(rec);
          } catch (err) {
            console.warn(`[archive] Drive backup of ${yr} failed:`, err.message);
          }
        }
      }
    })();
  }, [flights, residence, loadArchives, migrationDone]);

  // ─── FULLSCREEN ───────────────────────────────────────
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  // Keyboard shortcut: Escape to exit
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape" && isFullscreen) setIsFullscreen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isFullscreen]);

  // ─── NOTIFICATION SYSTEM ─────────────────────────────
  const notify = useCallback((message, type = "info") => {
    setNotification({ message, type, id: Date.now() });
    setTimeout(() => setNotification(null), 4000);
  }, []);

  const backupArchivesToDrive = useCallback(async () => {
    if (!authUser) { notify("Connectez Google Drive d'abord (onglet Backup)", "error"); return; }
    const years = await listArchiveYears();
    if (years.length === 0) { notify("Aucune archive à sauvegarder", "info"); return; }
    notify(`Sauvegarde de ${years.length} année(s) sur Drive…`, "info");
    const results = await backupAllYears(years);
    const ok = results.filter((r) => r.status === 'backed-up').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const failed = results.filter((r) => r.status === 'error').length;
    notify(`Drive: ${ok} sauvegardée(s), ${skipped} à jour${failed ? `, ${failed} échec(s)` : ''}`, failed ? 'error' : 'success');
  }, [notify]);

  const restoringRef = useRef(false);
  const restoreArchivesFromDrive = useCallback(async () => {
    if (!authUser) { notify("Connectez Google Drive d'abord (onglet Backup)", "error"); return; }
    if (restoringRef.current) return; // guard: no concurrent/double-click restores
    restoringRef.current = true;
    try {
      notify("Recherche d'archives sur Drive…", "info");
      const results = await restoreAllFromDrive();
      if (results.length === 0) { notify("Aucune archive trouvée sur Drive", "info"); return; }
      const restored = results.filter((r) => r.status === 'restored').length;
      const failed = results.filter((r) => r.status === 'error').length;
      try {
        await loadArchives();
        await refreshBoardingPassDates();
        refreshOFPIds();
      } catch (err) {
        console.error('[restore] post-restore refresh failed:', err);
      }
      notify(`Drive: ${restored} année(s) restaurée(s)${failed ? `, ${failed} échec(s)` : ''}`, failed ? 'error' : 'success');
    } catch (err) {
      notify(`Erreur de restauration: ${err.message}`, 'error');
    } finally {
      restoringRef.current = false;
    }
  }, [notify, loadArchives, refreshBoardingPassDates, refreshOFPIds]);

  // ─── AUTH STATE SUBSCRIPTION ─────────────────────────
  useEffect(() => {
    const unsubscribe = onAuthChanged((user) => {
      setAuthUser(user);
    });
    return unsubscribe;
  }, []);

  // ─── INITIALIZE ──────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      try {
        // Remove legacy flag that could diverge from real auth state after sign-out.
        localStorage.removeItem('ac-gdrive-connected');

        // Get or create device ID
        let devId;
        try {
          const stored = await storage.get("ac-device-id");
          devId = stored?.value || generateDeviceId();
        } catch {
          devId = generateDeviceId();
        }
        setDeviceId(devId);
        try { await storage.set("ac-device-id", devId); } catch { /* ok */ }

        // Load data from storage
        await loadAllData();
      } catch (err) {
        console.error("Init error:", err);
        notify("Erreur d'initialisation du stockage", "error");
      }
      setIsLoading(false);
    };
    init();
  }, []);

  // ─── AUTO-SYNC ────────────────────────────────────────
  // There is intentionally NO periodic full-array push. Every mutation
  // (import, residence save/clear, delete, archive) syncs its own
  // change at edit time, and flushQueue retries on failure, so a timer that
  // re-uploads the ENTIRE flights/residence dataset every few minutes adds no
  // durability — it only amplifies writes and, because it re-creates docs via
  // set/merge, resurrects flights another device deleted. The manual "Sync"
  // button still triggers an explicit full push (syncToCloud) on demand.

  // ─── STORAGE OPERATIONS ──────────────────────────────
  const loadAllData = async () => {
    try {
      const safeGet = async (key) => {
        try {
          const res = await storage.get(key);
          return res?.value ? JSON.parse(res.value) : null;
        } catch {
          return null;
        }
      };

      const flightsData = sanitizeStoredRows(await safeGet(STORAGE_KEYS.FLIGHTS));
      const residenceData = sanitizeStoredRows(await safeGet(STORAGE_KEYS.RESIDENCE));
      const settingsData = (await safeGet(STORAGE_KEYS.SETTINGS)) || {};
      const logData = (await safeGet(STORAGE_KEYS.SYNC_LOG)) || [];

      setFlights(flightsData);
      // Calendrier Fiscal residency is sourced from Google Calendar pull, not local flights.
      setResidence(residenceData);
      setSettings((prev) => ({ ...prev, ...settingsData }));
      setBackupState((prev) => ({
        ...prev,
        log: logData.slice(0, 50),
      }));
    } catch (err) {
      console.error("Load error:", err);
    }
  };

  // ─── DRIVE BACKUP RUNNER ─────────────────────────────
  // The single Drive-backup path shared by the auto-scheduler, the manual
  // header/Dashboard "Sauvegarder" action, and saveToGDrive (overdue banner /
  // BackupTab). Always includeBlobs:true — driveBackup skips already-uploaded
  // PDFs by name, so the steady-state cost is one cheap JSON PATCH.
  const runDriveBackup = useCallback(async ({ manual = false } = {}) => {
    if (!authUser) return;
    // Never overwrite a remote backup with empty local state (fresh install /
    // declined restore). Manual and auto paths both route through here, so this
    // is the single source of truth for the empty guard.
    if (flights.length === 0 && residence.length === 0) {
      if (manual) notify('Aucune donnée à sauvegarder', 'info');
      return;
    }
    setBackupState((s) => ({ ...s, status: 'syncing' }));
    try {
      await runBackup({ flights, residence, settings, includeBlobs: true });
      const at = now();
      setBackupState((s) => ({
        status: 'success',
        lastBackup: at,
        log: [{ at, action: 'backup', detail: manual ? 'Sauvegarde manuelle' : 'Sauvegarde automatique' }, ...s.log].slice(0, 50),
      }));
      // Persist lastBackup directly (NOT via setSettings — that would re-arm the
      // auto-backup timer through the scheduler effect's `settings` dep → loop).
      try { localStorage.setItem('fsl-last-backup', String(at)); } catch { /* ok */ }
      // Reset the transient 'success' indicator back to 'idle' after 3s, unless
      // a newer backup is already in flight (don't clobber a 'syncing' status).
      clearTimeout(backupStatusResetRef.current);
      backupStatusResetRef.current = setTimeout(() => {
        setBackupState((p) => (p.status === 'success' ? { ...p, status: 'idle' } : p));
      }, 3000);
    } catch (err) {
      setBackupState((s) => ({
        ...s,
        status: 'error',
        log: [{ at: now(), action: 'backup_error', detail: err.message }, ...s.log].slice(0, 50),
      }));
      if (manual) notify(`Échec de la sauvegarde: ${err.message}`, 'error');
      // Auto-backup failures stay quiet; the next data change reschedules a retry.
    }
  }, [authUser, flights, residence, settings, notify]);

  // ─── DRIVE RESTORE ───────────────────────────────────
  // Restore REPLACES local data with the Drive snapshot. parseBackupJson throws
  // (returns { error }) on corrupt/foreign JSON BEFORE we touch local state, so
  // a bad download can't wipe the user's data. Mirrors executeImport's replace
  // persistence flow (setFlights/setResidence + storage.set), plus settings.
  const restoreFromDrive = useCallback(async (fileId) => {
    const text = await downloadBackup(fileId);
    const { preview, error } = parseBackupJson(text);
    if (error) throw new Error(error);
    const incoming = preview.data.data; // { flights, residence, settings? }
    const nextFlights = Array.isArray(incoming.flights) ? incoming.flights : [];
    const nextResidence = Array.isArray(incoming.residence) ? incoming.residence : [];

    setFlights(nextFlights);
    setResidence(nextResidence);
    await storage.set(STORAGE_KEYS.FLIGHTS, JSON.stringify(nextFlights));
    await storage.set(STORAGE_KEYS.RESIDENCE, JSON.stringify(nextResidence));
    if (incoming.settings && typeof incoming.settings === 'object') {
      const nextSettings = { ...settings, ...incoming.settings };
      setSettings(nextSettings);
      await storage.set(STORAGE_KEYS.SETTINGS, JSON.stringify(nextSettings));
    }
    notify('Données restaurées depuis Google Drive', 'success');

    // Re-download the PDF mirror (OFPs / boarding passes). A blob failure here
    // doesn't undo the JSON restore — the flights/residence are already in place.
    try {
      const { ofps, boardingPasses } = await restoreBlobs(nextFlights);
      if (ofps || boardingPasses) notify(`${ofps} OFP et ${boardingPasses} cartes récupérés`, 'success');
      await refreshOFPIds();
      await refreshBoardingPassDates();
    } catch (err) {
      notify(`Données restaurées, mais PDF incomplets: ${err.message}`, 'error');
    }
  }, [settings, notify, refreshOFPIds, refreshBoardingPassDates]);

  // Proactive restore offer (new-Mac scenario): signed in with an empty local
  // store + a backup found on the account → offer to restore once per session.
  useEffect(() => {
    if (!authUser || isLoading) return undefined;
    if (restoreOfferDismissedRef.current) return undefined;
    if (flights.length !== 0 || residence.length !== 0) return undefined;
    let cancelled = false;
    findBackup()
      .then((found) => { if (!cancelled && found) setRestoreOffer(found); })
      .catch(() => { /* offline / not found — stay silent */ });
    return () => { cancelled = true; };
  }, [authUser, isLoading, flights.length, residence.length]);

  // Manual "Sauvegarder" (header + Dashboard quick action): persist the local
  // snapshot, then push to Drive through the shared runner.
  const syncToCloud = async () => {
    if (!authUser) {
      notify("Connectez un compte Google (onglet Backup) pour sauvegarder", "error");
      return;
    }
    // The empty-state guard lives in runDriveBackup (single source of truth) —
    // it notifies "Aucune donnée à sauvegarder" and bails before any Drive PATCH.
    const timestamp = now();
    const flightPayload = JSON.stringify(
      flights.map((f) => ({ ...f, _lastModified: f._lastModified || timestamp, _deviceId: f._deviceId || deviceId }))
    );
    const residencePayload = JSON.stringify(
      residence.map((r) => ({ ...r, _lastModified: r._lastModified || timestamp, _deviceId: r._deviceId || deviceId }))
    );
    await storage.set(STORAGE_KEYS.FLIGHTS, flightPayload);
    await storage.set(STORAGE_KEYS.RESIDENCE, residencePayload);
    await storage.set(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));

    await runDriveBackup({ manual: true });
  };

  // ─── DEBOUNCED DRIVE AUTO-BACKUP ─────────────────────
  // Fire 3 min after the last data change, while signed in. includeBlobs is
  // cheap in steady state: already-uploaded PDFs are skipped by name. Declared
  // after runDriveBackup so it's initialized when this effect's deps evaluate.
  useEffect(() => {
    if (isLoading || !authUser) return undefined;
    clearTimeout(backupTimerRef.current);
    backupTimerRef.current = setTimeout(() => { runDriveBackup({}); }, AUTO_BACKUP_DELAY_MS);
    return () => clearTimeout(backupTimerRef.current);
  }, [flights, residence, settings, authUser, isLoading, runDriveBackup]);

  // Clear the pending status-reset timeout on unmount (App never unmounts in
  // practice, but this keeps the timer from firing into a torn-down tree).
  useEffect(() => () => clearTimeout(backupStatusResetRef.current), []);

  // ─── FOLDER BACKUP RUNNER ────────────────────────────
  const runFolderBackupNow = useCallback(async () => {
    if (!settings.backupFolder) return;
    try {
      await runFolderBackup({ folder: settings.backupFolder, flights, residence, settings });
      setFolderBackupStatus({ at: now(), error: null });
    } catch (err) {
      console.warn('[folder-backup] failed:', err);
      setFolderBackupStatus({ at: now(), error: err.message });
    }
  }, [settings, flights, residence]);

  // ─── DEBOUNCED FOLDER AUTO-BACKUP ────────────────────
  // Independent of Drive: Drive needs sign-in, the folder needs only a path.
  useEffect(() => {
    if (isLoading || !settings.backupFolder) return undefined;
    clearTimeout(folderBackupTimerRef.current);
    folderBackupTimerRef.current = setTimeout(() => { runFolderBackupNow(); }, AUTO_BACKUP_DELAY_MS);
    return () => clearTimeout(folderBackupTimerRef.current);
  }, [flights, residence, settings, isLoading, runFolderBackupNow]);

  // ─── FOLDER PICKER ───────────────────────────────────
  const chooseBackupFolder = async () => {
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (!invoke) return;
    const folder = await invoke('plugin:dialog|open', {
      options: { directory: true, title: 'Choisir le dossier de sauvegarde' },
    });
    if (typeof folder === 'string' && folder) {
      const newSettings = { ...settings, backupFolder: folder };
      setSettings(newSettings);
      await storage.set(STORAGE_KEYS.SETTINGS, JSON.stringify(newSettings));
      notify('Dossier de sauvegarde configuré', 'success');
    }
  };

  const disableFolderBackup = async () => {
    const newSettings = { ...settings, backupFolder: '' };
    setSettings(newSettings);
    await storage.set(STORAGE_KEYS.SETTINGS, JSON.stringify(newSettings));
  };

  // ─── RESTORE FROM FOLDER ─────────────────────────────
  const restoreFromFolder = async () => {
    if (!settings.backupFolder) return;
    try {
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const text = await readTextFile(`${settings.backupFolder}/${BACKUP_FILENAME}`);
      const { preview, error } = parseBackupJson(text);
      if (error) { notify(error, 'error'); return; }
      // Same merge-or-replace preview as a file import; the tag makes the
      // confirm step also restore the folder's PDF mirrors.
      setImportPreview({ ...preview, device: 'dossier local', _folderBlobs: settings.backupFolder });
    } catch (err) {
      notify(`Lecture du dossier impossible : ${err.message}`, 'error');
    }
  };

  // ─── IMPORT / EXPORT ─────────────────────────────────
  const exportToJSON = () => {
    // backupFolder is a machine-specific absolute path — never serialize it into an export file.
    const { backupFolder: _machineLocal, ...safeSettings } = settings;
    const exportData = {
      version: SYNC_VERSION,
      exportDate: now(),
      deviceId,
      data: {
        flights,
        residence,
        settings: { ...safeSettings, lastBackup: now() },
      },
      metadata: {
        totalFlights: flights.length,
        totalResidenceDays: residence.length,
        dateRange: flights.length > 0 ? {
          from: flights.reduce((min, f) => f.date < min ? f.date : min, flights[0]?.date),
          to: flights.reduce((max, f) => f.date > max ? f.date : max, flights[0]?.date),
        } : null,
      },
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `FlightSync-Light-Export-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);

    const newSettings = { ...settings, lastBackup: now() };
    setSettings(newSettings);
    storage.set(STORAGE_KEYS.SETTINGS, JSON.stringify(newSettings));
    notify("Backup JSON exporté avec succès", "success");
  };

  // ─── GOOGLE DRIVE AUTO-BACKUP ──────────────────────────
  const saveToGDrive = useCallback(async () => {
    if (!authUser) {
      notify("Connectez un compte Google (onglet Backup) pour sauvegarder", "error");
      return false;
    }
    try {
      // Route the upload through the single runner: it owns status + log + blobs
      // AND stamps lastBackup (localStorage 'fsl-last-backup', outside settings),
      // which is what clears the overdue banner. No setSettings here — that would
      // re-arm the auto-backup scheduler (settings is in its deps) → loop.
      await runDriveBackup({ manual: true });
      return true;
    } catch (err) {
      console.error("Google Drive backup error:", err);
      return false;
    }
  }, [authUser, runDriveBackup, notify]);

  const exportToCSV = () => {
    if (flights.length === 0) {
      notify("Aucun vol à exporter", "error");
      return;
    }
    const headers = ["Date", "Vol", "Départ", "Arrivée", "Temps Total (h)", "Temps Canada (h)", "% Canada", "Distance (nm)", "Distance Canada (nm)", "Notes"];
    const rows = [...flights]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((f) => [
        f.date, f.flightNumber, f.departure, f.arrival,
        f.totalTime, f.canadianTime,
        f.distance > 0 ? ((f.canadianDistance / f.distance) * 100).toFixed(1) : "0",
        f.distance || "", f.canadianDistance || "", f.notes || "",
      ].map(csvEscape));

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `AC-Flights-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    notify("Export CSV réussi", "success");
  };

  // Tauri WKWebView doesn't reliably open native file pickers from <input type="file">,
  // so in Tauri we open the file via the Tauri dialog + fs plugins and feed the text
  // into the same processImportText pipeline.
  const handleImportClick = async () => {
    if (window.__TAURI_INTERNALS__) {
      try {
        const invoke = window.__TAURI_INTERNALS__.invoke;
        const filePath = await invoke('plugin:dialog|open', {
          options: {
            multiple: false,
            directory: false,
            filters: [{ name: 'Backup', extensions: ['json', 'csv', 'tsv'] }],
          },
        });
        if (!filePath) return;
        let text = await invoke('plugin:fs|read_text_file', { path: filePath });
        // Tauri v2.x fs plugin may return raw bytes (number[]) instead of a string for read_text_file.
        // Fall back to read_file and decode as UTF-8 if we didn't get a usable string.
        if (typeof text !== 'string' || text.length === 0) {
          const bytes = await invoke('plugin:fs|read_file', { path: filePath });
          if (bytes && (Array.isArray(bytes) || bytes instanceof Uint8Array)) {
            text = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
          }
        }
        const filename = String(filePath).split('/').pop();
        processImportText(text, filename);
      } catch (err) {
        notify(`Erreur ouverture fichier: ${err.message || err}`, 'error');
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleFileImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => processImportText(event.target.result, file.name);
    reader.readAsText(file);
    e.target.value = "";
  };

  const processImportText = (text, filename) => {
    const ext = filename.split(".").pop().toLowerCase();

    // ─── JSON Import ───
    {
      if (ext === "json") {
        const { preview, error } = parseBackupJson(text);
        if (error) {
          notify(error, "error");
          return;
        }
        setImportPreview(preview.type === "flights" ? { ...preview, date: now(), device: "import" } : preview);
      }
      // ─── CSV Import ───
      else if (ext === "csv" || ext === "tsv") {
        try {
          const sep = ext === "tsv" ? "\t" : ",";
          const lines = text.split("\n").filter((l) => l.trim());
          if (lines.length < 2) {
            notify("CSV vide ou invalide", "error");
            return;
          }
          const headers = lines[0].split(sep).map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());

          const dateCol = headers.findIndex((h) => h.includes("date"));
          const flightCol = headers.findIndex((h) => h.includes("vol") || h.includes("flight") || h.includes("numéro"));
          const depCol = headers.findIndex((h) => h.includes("départ") || h.includes("departure") || h.includes("dep"));
          const arrCol = headers.findIndex((h) => h.includes("arrivée") || h.includes("arrival") || h.includes("arr"));
          const totalTimeCol = headers.findIndex((h) => h.includes("total") && h.includes("h") || h.includes("temps total") || h.includes("total time"));
          const canTimeCol = headers.findIndex((h) => h.includes("canada") && h.includes("h") || h.includes("temps canada") || h.includes("canadian time"));
          const distCol = headers.findIndex((h) => h.includes("distance") && !h.includes("canada"));
          const canDistCol = headers.findIndex((h) => h.includes("distance") && h.includes("canada"));
          const notesCol = headers.findIndex((h) => h.includes("note"));

          if (dateCol === -1) {
            notify("Colonne 'Date' introuvable dans le CSV", "error");
            return;
          }

          const parsedFlights = [];
          for (let i = 1; i < lines.length; i++) {
            const vals = lines[i].split(sep).map((v) => v.trim().replace(/^"|"$/g, ""));
            if (!vals[dateCol]) continue;

            parsedFlights.push({
              id: `csv-import-${i}-${Date.now()}`,
              date: vals[dateCol] || "",
              flightNumber: flightCol >= 0 ? vals[flightCol] : "",
              departure: depCol >= 0 ? vals[depCol] : "",
              arrival: arrCol >= 0 ? vals[arrCol] : "",
              totalTime: totalTimeCol >= 0 ? parseFloat(vals[totalTimeCol]) || 0 : 0,
              canadianTime: canTimeCol >= 0 ? parseFloat(vals[canTimeCol]) || 0 : 0,
              distance: distCol >= 0 ? parseFloat(vals[distCol]) || 0 : 0,
              canadianDistance: canDistCol >= 0 ? parseFloat(vals[canDistCol]) || 0 : 0,
              notes: notesCol >= 0 ? vals[notesCol] : "Import CSV",
              _lastModified: now(),
              _deviceId: deviceId,
            });
          }

          if (parsedFlights.length === 0) {
            notify("Aucun vol trouvé dans le CSV", "error");
            return;
          }

          setImportPreview({
            type: "csv",
            data: { data: { flights: parsedFlights, residence: [] } },
            flights: parsedFlights.length,
            residence: 0,
            date: now(),
            device: "CSV Import",
          });
        } catch (err) {
          notify("Erreur de lecture du CSV: " + err.message, "error");
        }
      }
      // ─── Unsupported ───
      else {
        notify(`Format .${ext} non supporté. Utilise JSON ou CSV.`, "error");
      }
    }
  };

  const executeImport = async (strategy) => {
    if (!importPreview) return;
    const incoming = importPreview.data.data;
    const timestamp = now();

    let finalFlights, finalResidence;
    if (strategy === "replace") {
      finalFlights = incoming.flights || [];
      finalResidence = incoming.residence || [];
    } else {
      const existingKeys = new Set(flights.map((f) => `${f.date}-${f.flightNumber}`));
      const newFlights = (incoming.flights || [])
        .filter((f) => !existingKeys.has(`${f.date}-${f.flightNumber}`))
        .map((f) => ({ ...f, _lastModified: timestamp, _deviceId: deviceId }));
      finalFlights = [...flights, ...newFlights];

      const existingDays = new Set(residence.map((r) => r.date));
      const newDays = (incoming.residence || [])
        .filter((r) => !existingDays.has(r.date))
        .map((r) => ({ ...r, _lastModified: timestamp, _deviceId: deviceId }));
      finalResidence = [...residence, ...newDays];
    }

    setFlights(finalFlights);
    setResidence(finalResidence);
    await storage.set(STORAGE_KEYS.FLIGHTS, JSON.stringify(finalFlights));
    await storage.set(STORAGE_KEYS.RESIDENCE, JSON.stringify(finalResidence));

    setImportPreview(null);
    notify(`Import ${strategy === "replace" ? "complet" : "fusionné"} réussi`, "success");

    // If this restore came from a local folder, re-import the PDF mirror.
    if (importPreview._folderBlobs) {
      try {
        const { ofps, boardingPasses } = await restoreFolderBlobs(importPreview._folderBlobs, finalFlights);
        if (ofps || boardingPasses) {
          await refreshBoardingPassDates();
          refreshOFPIds();
          notify(`${ofps} OFP + ${boardingPasses} boarding pass restaurés depuis le dossier`, 'success');
        }
      } catch (err) {
        console.warn('[folder-restore-blobs] failed:', err);
      }
    }
  };

  // ─── CALENDAR SYNC ───────────────────────────────────
  const handleExportICS = () => {
    if (flights.length === 0) { notify("Aucun vol à exporter", "info"); return; }
    exportICS(flights);
    notify(`${flights.length} vol(s) exportés en .ics`, "success");
  };

  // ─── DAY PANEL SAVE ─────────────────────────────────
  // Single writer for a day's manual state. location: 'canada'|'mexico'|
  // 'international'|'transit'|null. A null location with a non-empty note is a
  // valid "note-only" untracked day; null location AND empty note removes the
  // entry entirely (the day reverts to untracked, uncolored).
  const handleDayPanelSave = useCallback((date, { location = null, notes = '' }) => {
    const trimmed = (notes || '').trim();
    setResidence(prev => {
      const map = new Map(prev.map(r => [r.date, r]));
      if (location == null && !trimmed) {
        map.delete(date);
      } else {
        const entry = { date, location: location ?? null, _source: 'manual', _lastModified: now(), _deviceId: deviceId };
        if (trimmed) entry.notes = trimmed;
        map.set(date, entry);
      }
      const next = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
      storage.set(STORAGE_KEYS.RESIDENCE, JSON.stringify(next));
      return next;
    });
  }, [deviceId]);

  const performClearAllData = async () => {
    try {
      await Promise.all([
        storage.delete(STORAGE_KEYS.FLIGHTS),
        storage.delete(STORAGE_KEYS.RESIDENCE),
        storage.delete(STORAGE_KEYS.SYNC_LOG),
      ]);
      setFlights([]);
      setResidence([]);
      setBackupState((prev) => ({ ...prev, log: [] }));
      notify("Toutes les données ont été supprimées", "info");
    } catch {
      notify("Erreur lors de la suppression", "error");
    }
  };

  // ─── DELETE FLIGHT ───────────────────────────────────
  const deleteFlight = useCallback((id) => {
    setFlights(prev => {
      const next = prev.filter(f => f.id !== id);
      storage.set(STORAGE_KEYS.FLIGHTS, JSON.stringify(next));
      return next;
    });
  }, []);

  // ─── PDF IMPORT ──────────────────────────────────────
  const handlePdfImport = useCallback((pdfFlights) => {
    const timestamp = now();
    // mergeImportedFlights preserves each matched flight's existing id so a
    // re-import overwrites the row in place instead of orphaning it
    // (which would resurrect a duplicate and double-count CRA hours).
    const { flights: allFlights, added, updated } =
      mergeImportedFlights(flights, pdfFlights, { timestamp, deviceId });
    // Save flights directly — avoid stale closure bug in syncToCloud
    storage.set(STORAGE_KEYS.FLIGHTS, JSON.stringify(allFlights));
    setFlights(allFlights);
    const parts = [];
    if (added) parts.push(`${added} vol(s) importé(s)`);
    if (updated) parts.push(`${updated} vol(s) mis à jour`);
    notify(parts.join(', '), 'success');
    refreshOFPIds();
  }, [flights, deviceId, notify, refreshOFPIds]);

  // ─── COMPUTED VALUES ─────────────────────────────────
  const currentYear = new Date().getFullYear();
  // Read-only "view a past year": swap the dataset fed to the data tabs.
  const { flights: displayFlights, residence: displayResidence, readOnly: isArchiveView } = useMemo(
    () => selectDisplayData({ viewYear, flights, residence, archiveYears }),
    [viewYear, flights, residence, archiveYears],
  );
  const viewedYear = viewYear ? Number(viewYear) : currentYear;
  const { totalHours, canadianHours, canadianTimePct } = useMemo(
    () => computeAllTimeSummary(displayFlights), [displayFlights]);
  const fiscalYear = useMemo(
    () => computeFiscalYear(displayFlights, viewedYear), [displayFlights, viewedYear]);
  const daysOutside = useMemo(
    () => tallyResidence(displayResidence).outside, [displayResidence]);
  const backupOverdue = backupState.lastBackup
    ? (Date.now() - new Date(backupState.lastBackup).getTime()) / 86400000 > settings.backupReminder
    : true;

  // ─── TABS / SECTIONS (single source of truth in ./navigation/sections) ───
  const tabs = SECTIONS;
  const yearOptions = archiveYearList(archiveYears);
  const visibleTabs = viewYear ? tabs.filter((t) => !['sync', 'backup'].includes(t.id)) : tabs;
  const enterYear = (y) => {
    setViewYear(y);
    if (y && (activeSection === 'sync' || activeSection === 'backup')) {
      if (isMobile) openSection('dashboard');
      else setActiveTab('dashboard');
    }
  };

  // If the viewed archived year is no longer available, drop back to live.
  useEffect(() => {
    if (viewYear && archiveYears.length > 0 && !archiveYears.some((a) => a.year === viewYear)) {
      setViewYear(null);
    }
  }, [viewYear, archiveYears]);

  // ─── SECTION CONTENT (shared between desktop tabs and mobile shell) ───
  const sectionContent = (
    <>
      {/* ═══ DASHBOARD ═══════════════════════════════ */}
      {activeSection === "dashboard" && (
        <DashboardTab
          flights={displayFlights}
          residence={displayResidence}
          totalHours={totalHours}
          canadianHours={canadianHours}
          canadianTimePct={canadianTimePct}
          fiscalYear={fiscalYear}
          daysOutside={daysOutside}
          backupOverdue={backupOverdue}
          lastBackup={backupState.lastBackup}
          settings={settings}
          authUser={authUser}
          saveToGDrive={saveToGDrive}
          notify={notify}
          syncToCloud={syncToCloud}
          exportToJSON={exportToJSON}
          exportToCSV={exportToCSV}
          handleImportClick={handleImportClick}
          readOnly={isArchiveView}
        />
      )}

      {/* ═══ CALENDAR ═══════════════════════════════ */}
      {activeSection === "calendar" && (
        <CalendarTab
          residence={displayResidence}
          flights={displayFlights}
          boardingPassDates={boardingPassDates}
          setDayPanelDate={setDayPanelDate}
          year={viewedYear}
        />
      )}

      {/* ═══ BACKUP & RESTORE ═══════════════════════ */}
      {activeSection === "backup" && !isArchiveView && (
        <BackupTab
          flights={flights}
          authUser={authUser}
          backupState={backupState}
          lastBackup={backupState.lastBackup}
          onSignIn={() => signInWithGoogle().then(() => notify('Connecté', 'success')).catch((e) => notify(e.message, 'error'))}
          onSignOutRequest={() => setSignOutConfirm(true)}
          onBackupNow={() => runDriveBackup({ manual: true })}
          onRestoreRequest={async () => {
            try {
              const found = await findBackup();
              if (found) setRestoreOffer(found);
              else notify('Aucune sauvegarde trouvée sur ce compte', 'error');
            } catch (err) {
              notify(err.message, 'error');
            }
          }}
          exportToJSON={exportToJSON}
          handleImportClick={handleImportClick}
          exportToCSV={exportToCSV}
          handleExportICS={handleExportICS}
          clearAllData={() => setClearAllConfirm(true)}
          backupFolder={settings.backupFolder}
          folderBackupStatus={folderBackupStatus}
          chooseBackupFolder={chooseBackupFolder}
          disableFolderBackup={disableFolderBackup}
          runFolderBackupNow={runFolderBackupNow}
          restoreFromFolder={restoreFromFolder}
        />
      )}

      {/* ═══ DATA VIEW ═══════════════════════════════ */}
      {activeSection === "data" && (
        <DataTab
          flights={displayFlights}
          residence={displayResidence}
          ofpFlightIds={ofpFlightIds}
          setOfpModalFlightId={setOfpModalFlightId}
          setDeleteConfirm={setDeleteConfirm}
          handlePdfImport={handlePdfImport}
          notify={notify}
          deviceId={deviceId}
          readOnly={isArchiveView}
        />
      )}

      {/* ═══ ARCHIVES ════════════════════════════════ */}
      {activeSection === "archive" && (
        <ArchiveTab
          archiveYears={archiveYears}
          expandedArchiveYear={expandedArchiveYear}
          setExpandedArchiveYear={setExpandedArchiveYear}
          onOpenYear={enterYear}
          onBackupToDrive={backupArchivesToDrive}
          onRestoreFromDrive={restoreArchivesFromDrive}
        />
      )}

      {/* ═══ SYNC HISTORY ═══════════════════════════ */}
      {activeSection === "history" && <HistoryTab log={backupState.log} />}
    </>
  );

  if (isLoading) {
    return (
      <div style={{ minHeight: "100vh", background: "#0a0f1e", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 48, height: 48, border: "3px solid rgba(99,179,237,0.2)", borderTop: "3px solid #63b3ed", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 20px" }} />
          <p style={{ color: "#a0aec0", fontSize: 14, letterSpacing: "0.05em" }}>CHARGEMENT DES DONNÉES...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh", background: "#0a0f1e", fontFamily: "'DM Sans', system-ui, sans-serif", color: "#e2e8f0",
      ...(isFullscreen ? { position: "fixed", inset: 0, zIndex: 99999, overflowY: "auto", width: "100vw", height: "100vh" } : {}),
    }}>
      {/* ─── NOTIFICATION TOAST ───────────────────────── */}
      {notification && (
        <div style={{
          position: "fixed", top: 20, right: 20, zIndex: 1000,
          padding: "14px 24px", borderRadius: 12,
          background: notification.type === "success" ? "#064e3b" : notification.type === "error" ? "#7f1d1d" : "#1e2a45",
          color: notification.type === "success" ? "#6ee7b7" : notification.type === "error" ? "#fca5a5" : "#a0aec0",
          border: `1px solid ${notification.type === "success" ? "#065f46" : notification.type === "error" ? "#991b1b" : "#2d3748"}`,
          animation: "slideIn 0.3s ease",
          fontSize: 13, fontWeight: 500, boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        }}>
          {notification.message}
        </div>
      )}

      {/* ─── IMPORT MODAL ─────────────────────────────── */}
      {importPreview && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 999, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        }}>
          <div className="card" style={{ maxWidth: 500, width: "100%", animation: "slideIn 0.3s ease" }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20, color: "#63b3ed" }}>Aperçu de l'Import</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
              <div style={{ padding: 14, background: "#0a0f1e", borderRadius: 10, textAlign: "center" }}>
                <div className="mono" style={{ fontSize: 24, color: "#63b3ed" }}>{importPreview.flights}</div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>VOLS</div>
              </div>
              <div style={{ padding: 14, background: "#0a0f1e", borderRadius: 10, textAlign: "center" }}>
                <div className="mono" style={{ fontSize: 24, color: "#63b3ed" }}>{importPreview.residence}</div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>JOURS RÉSIDENCE</div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>
              <span className="mono">{formatDate(importPreview.date)}</span> · Appareil: <span className="mono">{importPreview.device}</span>
            </div>

            <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid #1e2a45" }}>
              <p style={{ fontSize: 13, color: "#a0aec0", marginBottom: 16 }}>Stratégie d'import :</p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="btn btn-primary" onClick={() => executeImport("merge")}>
                  <Icons.Merge /> Fusionner
                </button>
                <button className="btn btn-danger" onClick={() => executeImport("replace")}>
                  Remplacer tout
                </button>
                <button className="btn btn-secondary" onClick={() => setImportPreview(null)}>
                  Annuler
                </button>
              </div>
              <p style={{ fontSize: 11, color: "#475569", marginTop: 12 }}>
                Fusionner = ajoute les nouveaux vols sans toucher les existants. Remplacer = écrase tout.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ─── TITLE BAR (macOS drag strip) ─────────────── */}
      <div
        data-tauri-drag-region
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          const inv = window.__TAURI_INTERNALS__?.invoke;
          if (inv) inv('plugin:window|start_dragging').catch(() => {});
        }}
        onDoubleClick={() => {
          const inv = window.__TAURI_INTERNALS__?.invoke;
          if (inv) inv('plugin:window|toggle_maximize').catch(() => {});
        }}
        style={{
          height: 52,
          background: "#1a2440",
          borderBottom: "1px solid #2a3a5c",
          flexShrink: 0,
        }}
      />

      {/* ─── HEADER ───────────────────────────────────── */}
      <header style={{ padding: "18px 28px", borderBottom: "1px solid #1e2a45", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div
          onClick={() => { if (isMobile && mobileNav.section !== null) mobileNav.back(); }}
          style={{ display: "flex", alignItems: "center", gap: 14, cursor: isMobile && mobileNav.section !== null ? 'pointer' : 'default' }}
        >
          <div style={{
            width: 42, height: 42, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
            background: "linear-gradient(135deg, #1e3a5f 0%, #0f2340 100%)", border: "1px solid #2a4a6f",
          }}>
            <Icons.Plane />
          </div>
          <div>
            <h1 style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em", color: "#f1f5f9" }}>
              Flight Sync System
            </h1>
            <p style={{ fontSize: 11, color: "#475569", letterSpacing: "0.08em", fontWeight: 500 }}>
              AIR CANADA · B787 · {deviceId}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {yearOptions.length > 0 && (
            <select
              value={viewYear ?? ''}
              onChange={(e) => enterYear(e.target.value || null)}
              title="Voir une année archivée"
              style={{
                background: viewYear ? "#3b1d05" : "#0f1525",
                color: viewYear ? "#fbbf24" : "#a0aec0",
                border: `1px solid ${viewYear ? "#78350f" : "#1e2a45"}`,
                borderRadius: 10, padding: "8px 12px", fontSize: 12,
                fontFamily: "inherit", cursor: "pointer",
              }}
            >
              <option value="">Année en cours ({currentYear})</option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y} (archive)</option>
              ))}
            </select>
          )}
          {/* Backup status indicator */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "8px 16px",
            background: "#0f1525", borderRadius: 10, border: "1px solid #1e2a45",
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: backupState.status === "syncing" ? "#f59e0b" : backupState.status === "success" ? "#10b981" : backupState.status === "error" ? "#ef4444" : "#64748b",
              animation: backupState.status === "syncing" ? "syncPulse 1.5s infinite" : "none",
            }} />
            <span style={{ fontSize: 12, color: "#a0aec0" }}>
              {backupState.status === "syncing" ? "Sauvegarde..." : backupState.status === "success" ? "Sauvegardé" : backupState.status === "error" ? "Erreur" : timeSince(backupState.lastBackup)}
            </span>
          </div>

          <button className="btn btn-primary" onClick={syncToCloud} disabled={backupState.status === "syncing"} style={{ padding: "8px 16px" }}>
            <span style={{ display: "flex", animation: backupState.status === "syncing" ? "spin 1s linear infinite" : "none" }}><Icons.Sync /></span>
            Sauvegarder
          </button>

          <button
            className="btn btn-secondary"
            onClick={toggleFullscreen}
            style={{ padding: "8px 12px" }}
            title={isFullscreen ? "Quitter plein écran" : "Plein écran"}
          >
            {isFullscreen ? <Icons.ExitFullscreen /> : <Icons.Fullscreen />}
          </button>
        </div>
      </header>

      {viewYear && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 14,
          padding: "8px 16px", background: "#3b1d05", borderBottom: "1px solid #78350f",
          color: "#fbbf24", fontSize: 13, flexWrap: "wrap",
        }}>
          <button
            className="btn btn-secondary"
            style={{ padding: "4px 10px", fontSize: 12 }}
            onClick={() => enterYear(adjacentYear(yearOptions, viewYear, -1))}
            disabled={!adjacentYear(yearOptions, viewYear, -1)}
            title="Année plus ancienne"
          >‹</button>
          <span style={{ fontWeight: 600 }}>📅 Vue {viewYear} — lecture seule</span>
          <button
            className="btn btn-secondary"
            style={{ padding: "4px 10px", fontSize: 12 }}
            onClick={() => enterYear(adjacentYear(yearOptions, viewYear, +1))}
            disabled={!adjacentYear(yearOptions, viewYear, +1)}
            title="Année plus récente"
          >›</button>
          <button
            className="btn btn-primary"
            style={{ padding: "4px 12px", fontSize: 12 }}
            onClick={() => setViewYear(null)}
          >Quitter — revenir à {currentYear}</button>
        </div>
      )}
      {isMobile ? (
        mobileNav.section === null ? (
          <MobileHomeMenu sections={visibleTabs} onSelect={openSection} />
        ) : (
          <>
            <MobileSectionHeader
              title={tabs.find((s) => s.id === mobileNav.section)?.label ?? ''}
              onBack={mobileNav.back}
            />
            <main style={{ padding: 16 }}>{sectionContent}</main>
          </>
        )
      ) : (
        <>
          {/* ─── TAB NAVIGATION (desktop, unchanged) ─── */}
          <nav style={{ display: "flex", gap: 0, padding: "0 28px", borderBottom: "1px solid #1e2a45", overflowX: "auto" }}>
            {visibleTabs.map((tab) => (
              <button key={tab.id} className={`tab-btn ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}>
                <tab.icon /> {tab.label}
              </button>
            ))}
          </nav>
          {/* ─── CONTENT (desktop, unchanged) ─── */}
          <main style={{ padding: 28, maxWidth: isFullscreen ? "100%" : 1200, margin: "0 auto" }}>
            {sectionContent}
          </main>
        </>
      )}

      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept=".json,.csv,.tsv" onChange={handleFileImport} style={{ display: "none" }} />

      {/* Day Panel — classification, boarding passes, notes */}
      {dayPanelDate && (
        <DayPanel
          key={dayPanelDate}
          date={dayPanelDate}
          entry={displayResidence.find((r) => r.date === dayPanelDate) || null}
          readOnly={isArchiveView}
          onSaveDay={handleDayPanelSave}
          onOpenPass={(bp) => setViewingPass(bp)}
          onPassesChanged={refreshBoardingPassDates}
          onClose={() => setDayPanelDate(null)}
        />
      )}
      {viewingPass && (
        <BoardingPassModal pass={viewingPass} onClose={() => setViewingPass(null)} />
      )}

      {/* OFP Modal */}
      {ofpModalFlightId && (
        <Suspense fallback={null}>
          <OFPModal
            flightId={ofpModalFlightId}
            onClose={() => setOfpModalFlightId(null)}
          />
        </Suspense>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div
          onClick={() => setDeleteConfirm(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1100,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#0f1525', border: '1px solid #1e2a45', borderRadius: 14,
              padding: 28, maxWidth: 380, width: '90%', textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600, color: '#f1f5f9', marginBottom: 10 }}>
              Supprimer ce vol ?
            </div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 24 }}>
              {deleteConfirm.flightNumber} — {deleteConfirm.date}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                className="btn btn-secondary"
                style={{ padding: '8px 20px', fontSize: 13 }}
                onClick={() => setDeleteConfirm(null)}
              >
                Annuler
              </button>
              <button
                style={{
                  padding: '8px 20px', fontSize: 13, fontWeight: 600,
                  background: '#dc2626', border: 'none', borderRadius: 8,
                  color: '#fff', cursor: 'pointer',
                }}
                onClick={() => { deleteFlight(deleteConfirm.id); setDeleteConfirm(null); }}
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={signOutConfirm}
        title="Se déconnecter ?"
        message="Vos données restent sur ce Mac; la sauvegarde Drive reste sur votre compte Google."
        confirmLabel="Se déconnecter"
        cancelLabel="Annuler"
        onConfirm={() => { setSignOutConfirm(false); signOut().catch((e) => notify(e?.message || "Échec de la déconnexion", "error")); }}
        onCancel={() => setSignOutConfirm(false)}
      />

      <ConfirmModal
        open={!!restoreOffer}
        title="Sauvegarde trouvée sur Google Drive"
        message="Une sauvegarde FlightSync Light existe sur ce compte Google. Restaurer les données sur ce Mac ?"
        confirmLabel="Restaurer"
        cancelLabel="Plus tard"
        onConfirm={() => {
          const offer = restoreOffer;
          setRestoreOffer(null);
          if (offer) restoreFromDrive(offer.fileId).catch((err) => notify(`Échec de la restauration: ${err.message}`, 'error'));
        }}
        onCancel={() => { restoreOfferDismissedRef.current = true; setRestoreOffer(null); }}
      />

      <ConfirmModal
        open={clearAllConfirm}
        title="Supprimer TOUTES les données ?"
        message="Cette action est irréversible. Assurez-vous d'avoir un backup avant de continuer."
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        danger
        onConfirm={() => { setClearAllConfirm(false); performClearAllData(); }}
        onCancel={() => setClearAllConfirm(false)}
      />
    </div>
  );
}
