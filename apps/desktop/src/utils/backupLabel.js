// One line describing a Drive backup in the restore chooser:
//   "Mac (this device) · Nov 20, 2026, 9:14 a.m. · 52 flights, 120 days, 311 archived flights"
import { formatDate } from '@flightsync/core/util';

const PLATFORM_LABEL = { desktop: 'Mac', ios: 'iPhone / iPad', android: 'Android' };

export function describeBackup(b, myDeviceId) {
  const when = b.exportedAt ? formatDate(b.exportedAt) : 'date unknown';
  if (b.legacy) return `Older shared backup (before 0.2.14) · ${when}`;
  const who = PLATFORM_LABEL[b.platform] || 'Other device';
  const counts = [
    b.flights != null ? `${b.flights} flights` : null,
    b.days != null ? `${b.days} days` : null,
    b.archivedFlights ? `${b.archivedFlights} archived flights` : null,
  ].filter(Boolean).join(', ');
  return `${who}${myDeviceId && b.deviceId === myDeviceId ? ' (this device)' : ''} · ${when}${counts ? ` · ${counts}` : ''}`;
}

// Report text for rows a restore left out (parseBackupJson's `skipped`).
export function describeSkipped(skipped, max = 6) {
  const shown = skipped.slice(0, max).map((s) => `${s.label} (${s.reason})`).join('; ');
  const more = skipped.length > max ? `; and ${skipped.length - max} more` : '';
  const n = skipped.length;
  return `${n} row${n === 1 ? '' : 's'} could not be read and ${n === 1 ? 'was' : 'were'} left out: ${shown}${more}.`;
}
