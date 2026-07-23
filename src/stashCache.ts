import type { StashEntry } from './gitHelper';

type CachedChildren = {
  children: unknown[];
  groupByDir: boolean;
};

/** In-memory cache for stash file lists and file counts. */
export class StashCache {
  private readonly _children = new Map<string, CachedChildren>();
  private readonly _fileCounts = new Map<string, number>();
  private readonly _filePaths = new Map<string, string[]>();

  getChildren(ref: string, groupByDir: boolean): unknown[] | undefined {
    const hit = this._children.get(ref);
    if (hit && hit.groupByDir === groupByDir) {
      return hit.children;
    }
    return undefined;
  }

  setChildren(ref: string, groupByDir: boolean, children: unknown[]): void {
    this._children.set(ref, { children, groupByDir });
  }

  getFileCount(hash: string): number | undefined {
    return this._fileCounts.get(hash);
  }

  getFilePathsForEntry(entry: StashEntry): string[] | undefined {
    return this._filePaths.get(entry.ref);
  }

  setFilePathsForEntry(entry: StashEntry, paths: string[]): void {
    this._filePaths.set(entry.ref, paths);
    this._fileCounts.set(entry.hash, paths.length);
  }

  clearChildren(): void {
    this._children.clear();
  }

  pruneCounts(validHashes: Set<string>): void {
    for (const hash of this._fileCounts.keys()) {
      if (!validHashes.has(hash)) {
        this._fileCounts.delete(hash);
      }
    }
  }

  prunePaths(validRefs: Set<string>): void {
    for (const ref of this._filePaths.keys()) {
      if (!validRefs.has(ref)) {
        this._filePaths.delete(ref);
      }
    }
  }

  clear(): void {
    this.clearChildren();
    this._fileCounts.clear();
    this._filePaths.clear();
  }
}
