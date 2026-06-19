/** Files that appear in both a stash and local changes may conflict on apply. */
export function getOverlappingFiles(
  stashFiles: string[],
  localRelativePaths: string[],
): string[] {
  const local = new Set(localRelativePaths);
  return stashFiles.filter((f) => local.has(f));
}
