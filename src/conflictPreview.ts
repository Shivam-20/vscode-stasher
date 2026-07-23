import { normalizeRepoPath } from './pathUtils';

/** Files that appear in both a stash and local changes may conflict on apply. */
export function getOverlappingFiles(
  stashFiles: string[],
  localRelativePaths: string[],
): string[] {
  const local = new Set(localRelativePaths.map(normalizeRepoPath));
  return stashFiles
    .map(normalizeRepoPath)
    .filter((f) => local.has(f));
}
