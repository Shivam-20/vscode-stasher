export interface StashListRow {
  /** Numeric index (0 = newest) */
  index: number;
  /** e.g. "stash@{0}" */
  ref: string;
  /** Short commit hash of the stash commit */
  hash: string;
  /** Branch name at the time the stash was created */
  branch: string;
  /** Full git stash subject line, e.g. "WIP on main: add feature" */
  message: string;
  /** ISO-8601 date string when this stash was created */
  date: string;
}

/** Parses stdout from `git stash list --format=%gd|%H|%gs|%ai`. */
export function parseListStashesOutput(stdout: string): StashListRow[] {
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line, i) => {
      const i1 = line.indexOf('|');
      const i2 = line.indexOf('|', i1 + 1);
      const iLast = line.lastIndexOf('|');
      const ref = line.slice(0, i1);
      const hash = line.slice(i1 + 1, i2);
      const subject = line.slice(i2 + 1, iLast);
      const date = line.slice(iLast + 1).trim();

      const branchMatch = subject.match(/^(?:WIP on|On) ([^:]+):/);
      const branch = branchMatch?.[1] ?? 'unknown';

      return { index: i, ref, hash, branch, message: subject, date };
    });
}
