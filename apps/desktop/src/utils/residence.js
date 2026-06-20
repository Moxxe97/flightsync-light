// ─── Residence day tallying ─────────────────────────────────────
// Counting only: classification is fully manual via the calendar day panel
// (the GCal-driven derivation was removed with the Google Calendar
// integration on 2026-06-12).

// Single source of truth for "how many residence days in each location", so the
// Dashboard and the Calendar can never disagree. Counts are by `location` (NOT
// `type`): an entry can carry a free-form `type` tag independent of where the
// day was spent. Entries with NO location (location == null) are note-only
// days: untracked, excluded from every count including `total` and `outside`.
// Unknown non-null locations still count as `other` and as days outside Canada
// (robust for the 183-day residency threshold). The four known buckets plus
// `other` always sum to `total`.
export function tallyResidence(residence) {
  const counts = { canada: 0, mexico: 0, international: 0, transit: 0, other: 0 };
  const list = (residence || []).filter((r) => r && r.location != null);
  for (const r of list) {
    const loc = r.location;
    if (loc === 'canada' || loc === 'mexico' || loc === 'international' || loc === 'transit') {
      counts[loc] += 1;
    } else {
      counts.other += 1;
    }
  }
  const total = list.length;
  return { ...counts, total, outside: total - counts.canada };
}
