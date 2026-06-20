// src/navigation/sections.js
import Icons from '../components/Icons';

// Single source of truth for both the desktop tab bar and the mobile home menu.
// Order = the menu order. `subtitle` is shown only in the mobile menu.
export const SECTIONS = [
  { id: 'dashboard', label: 'Tableau de Bord',  subtitle: 'Résumé & statistiques',     icon: Icons.Cloud },
  { id: 'calendar',  label: 'Calendrier',        subtitle: 'Jours de résidence',        icon: Icons.Calendar },
  { id: 'backup',    label: 'Backup & Restore',  subtitle: 'Google Drive',              icon: Icons.Shield },
  { id: 'data',      label: 'Données',           subtitle: 'Vols & résidence',          icon: Icons.Plane },
  { id: 'archive',   label: 'Archives',          subtitle: 'Années passées',            icon: Icons.History },
  { id: 'history',   label: 'Historique',        subtitle: 'Journal des sauvegardes',   icon: Icons.History },
];
