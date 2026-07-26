import { spawnSync } from 'child_process';
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

/**
 * Uses `git merge-tree` to find conflicting hunks between a stash and HEAD.
 * Returns an array of conflict summary lines, or undefined if the tool fails.
 */
export function getMergeTreeConflicts(
  gitPath: string,
  repoRoot: string,
  stashRef: string,
): string[] | undefined {
  try {
    const result = spawnSync(
      gitPath,
      ['merge-tree', `${stashRef}^1`, 'HEAD', stashRef],
      { cwd: repoRoot, encoding: 'utf8', timeout: 10000 },
    );
    if (result.status !== 0 || !result.stdout) {
      return undefined;
    }

    const lines = result.stdout.split('\n');
    const conflictLines: string[] = [];
    let inConflict = false;

    for (const line of lines) {
      if (line.startsWith('@@') || line.startsWith('+++') || line.startsWith('---')) {
        if (inConflict) {
          conflictLines.push(line);
        }
        continue;
      }
      if (line.startsWith('+') || line.startsWith('-')) {
        if (inConflict) {
          conflictLines.push(line);
        }
        continue;
      }
      // Non-diff line — check if it starts a conflict section
      if (line.includes('CONFLICT')) {
        inConflict = true;
        conflictLines.push(line);
        continue;
      }
      // If we hit a non-diff, non-conflict line after being in conflict, section ended
      if (inConflict && line.trim() && !line.startsWith(' ')) {
        inConflict = false;
      }
    }

    return conflictLines.length > 0 ? conflictLines : undefined;
  } catch {
    return undefined;
  }
}
