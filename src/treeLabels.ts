import * as path from 'path';

/** Basename + parent folder label for file rows in tree views. */
export function fileTreeLabel(
  relativePath: string,
  status: string,
): { label: string; description: string } {
  const dirname = path.dirname(relativePath);
  const label = path.basename(relativePath);
  const description =
    dirname === '.' ? status : `${dirname} · ${status}`;
  return { label, description };
}

/** Sort branch names: current branch first, then alphabetical. */
export function sortBranchNames(branches: string[], currentBranch?: string): string[] {
  return [...branches].sort((a, b) => {
    if (currentBranch) {
      if (a === currentBranch && b !== currentBranch) { return -1; }
      if (b === currentBranch && a !== currentBranch) { return 1; }
    }
    return a.localeCompare(b);
  });
}
