import type { StashEntry } from './gitHelper';

/**
 * Human-readable relative time from an ISO-8601 date string.
 * e.g. "2h ago", "3 days ago", "just now"
 */
export function relativeTime(isoDate: string): string {
  const then = Date.parse(isoDate);
  if (isNaN(then)) {
    return '';
  }
  const diffMs = Date.now() - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) { return 'just now'; }
  if (diffMin < 60) { return `${diffMin}m ago`; }
  if (diffHr < 24)  { return `${diffHr}h ago`; }
  if (diffDay < 7)  { return `${diffDay}d ago`; }
  if (diffDay < 30) { return `${Math.floor(diffDay / 7)}w ago`; }
  if (diffDay < 365){ return `${Math.floor(diffDay / 30)}mo ago`; }
  return `${Math.floor(diffDay / 365)}y ago`;
}

/** Returns true if the stash is older than `thresholdDays` days. */
export function isStale(isoDate: string, thresholdDays = 7): boolean {
  const then = Date.parse(isoDate);
  if (isNaN(then)) {
    return false;
  }
  const diffDay = (Date.now() - then) / (1000 * 60 * 60 * 24);
  return diffDay > thresholdDays;
}

/** Returns stashes older than the threshold. */
export function getStaleStashes(entries: StashEntry[], thresholdDays = 7): StashEntry[] {
  return entries.filter((e) => isStale(e.date, thresholdDays));
}

/**
 * Returns stashes that are stale, unpinned, AND not archived.
 * Used by auto-cleanup (#1) to find candidates for archiving.
 */
export function getStaleUnpinnedUnarchivedStashes(
  entries: StashEntry[],
  thresholdDays: number,
  pinnedHashes: Set<string>,
  archivedHashes: Set<string>,
): StashEntry[] {
  return entries.filter(
    (e) =>
      isStale(e.date, thresholdDays) &&
      !pinnedHashes.has(e.hash) &&
      !archivedHashes.has(e.hash),
  );
}
