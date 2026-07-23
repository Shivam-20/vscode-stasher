/** Normalize a repo-relative path to forward slashes for cross-platform comparison. */
export function normalizeRepoPath(p: string): string {
  return p.replace(/\\/g, '/');
}
