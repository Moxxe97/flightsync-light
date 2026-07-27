// src/navigation/sections.js
import Icons from '../components/Icons';

// Single source of truth for both the desktop tab bar and the mobile home menu.
// Order = the menu order. `subtitle` is shown only in the mobile menu.
export const SECTIONS = [
  { id: 'dashboard', label: 'Dashboard',         subtitle: 'Summary & statistics',      icon: Icons.Cloud },
  { id: 'calendar',  label: 'Calendar',          subtitle: 'Residence days',            icon: Icons.Calendar },
  { id: 'backup',    label: 'Backup & Restore',  subtitle: 'Google Drive',              icon: Icons.Shield },
  { id: 'data',      label: 'Data',              subtitle: 'Flights & residence',       icon: Icons.Plane },
  { id: 'archive',   label: 'Archive',           subtitle: 'Past years',                icon: Icons.History },
  { id: 'history',   label: 'History',           subtitle: 'Backup log',                icon: Icons.History },
];
