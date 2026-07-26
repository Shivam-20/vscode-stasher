import * as vscode from 'vscode';
import * as path from 'path';
import { statusLabel, statusThemeIcon } from './statusHelpers';
import { Status } from './gitEnums';
import { relativeTime, isStale } from './stashAge';
import { stripStashBranchPrefix } from './stashMessage';
import { fileTreeLabel, sortBranchNames } from './treeLabels';
import {
  isStashPinned, isStashArchived,
  getStashNote, getStashLabel, LABEL_EMOJI,
} from './stashNotes';
import { StashCache } from './stashCache';
import { TreeExpansionState, collapsibleState } from './treeExpansionState';
import {
  listStashes,
  getStashFiles,
  getStashFilePaths,
  getStashStats,
  getRepository,
  onDidChangeStashes,
  type StashEntry,
} from './gitHelper';

function truncateNote(note: string, max = 20): string {
  const trimmed = note.trim();
  if (trimmed.length <= max) { return trimmed; }
  return trimmed.substring(0, max - 1) + '\u2026';
}

function buildStashDescription(
  entry: StashEntry,
  groupedByBranch: boolean,
  fileCount: number | undefined,
  showFileCounts: boolean,
  note: string | undefined,
  showNotes: boolean,
  label?: ReturnType<typeof getStashLabel>,
  diffStat?: { added: number; removed: number },
  showDiffStat?: boolean,
): string {
  const age = relativeTime(entry.date);
  const emoji = label ? LABEL_EMOJI[label] : '';
  const parts: string[] = [entry.ref, age];

  if (showFileCounts && fileCount !== undefined) {
    parts.push(`${fileCount} file${fileCount !== 1 ? 's' : ''}`);
  }

  if (showDiffStat && diffStat) {
    parts.push(`+${diffStat.added}-${diffStat.removed}`);
  }

  if (!groupedByBranch) {
    parts.push(entry.branch);
  }

  if (emoji) {
    parts.push(emoji);
  }

  if (showNotes && note) {
    parts.push(`"${truncateNote(note)}"`);
  }

  return parts.join(' · ');
}

// ─── Tree item types ──────────────────────────────────────────────────────────

export class StashBranchGroupItem extends vscode.TreeItem {
  constructor(
    public readonly branchName: string,
    public readonly stashes: StashEntry[],
    expansion: TreeExpansionState,
  ) {
    const id = `branchgroup-${branchName}`;
    super(
      branchName,
      collapsibleState(id, expansion, vscode.TreeItemCollapsibleState.Expanded),
    );
    this.description = `${stashes.length} stash${stashes.length !== 1 ? 'es' : ''}`;
    this.iconPath = new vscode.ThemeIcon('git-branch');
    this.contextValue = 'branchGroup';
    this.id = id;
  }
}

export class StashDirGroupItem extends vscode.TreeItem {
  constructor(
    public readonly dirPath: string,
    public readonly fileItems: StashFileTreeItem[],
    stashRef: string,
  ) {
    super(dirPath === '(root)' ? '(root)' : dirPath + '/', vscode.TreeItemCollapsibleState.Expanded);
    this.description = `${fileItems.length} file${fileItems.length !== 1 ? 's' : ''}`;
    this.iconPath = new vscode.ThemeIcon('folder');
    this.contextValue = 'stashDirGroup';
    this.id = `dirgroup-${stashRef}-${dirPath}`;
  }
}

export class StashTreeItem extends vscode.TreeItem {
  public readonly stashEntry: StashEntry;

  constructor(
    entry: StashEntry,
    pinned: boolean,
    archived: boolean,
    note: string | undefined,
    label: ReturnType<typeof getStashLabel> | undefined,
    groupedByBranch: boolean,
    staleThreshold: number,
    fileCount: number | undefined,
    showFileCounts: boolean,
    showNotes: boolean,
    expansion: TreeExpansionState,
    diffStat?: { added: number; removed: number },
    showDiffStat?: boolean,
  ) {
    const displayMessage = groupedByBranch ? stripStashBranchPrefix(entry.message) : entry.message;
    const msg = displayMessage.length > 55 ? displayMessage.substring(0, 52) + '\u2026' : displayMessage;
    const id = `stash-${entry.hash}`;
    super(
      msg,
      collapsibleState(id, expansion, vscode.TreeItemCollapsibleState.Collapsed),
    );
    this.stashEntry = entry;
    this.id = id;

    const age = relativeTime(entry.date);
    const stale = isStale(entry.date, staleThreshold);
    this.description = buildStashDescription(
      entry, groupedByBranch, fileCount, showFileCounts, note, showNotes, label,
      diffStat, showDiffStat,
    );

    if (archived) {
      this.contextValue = pinned ? 'stashEntryArchivedPinned' : 'stashEntryArchived';
      this.iconPath = new vscode.ThemeIcon('archive', new vscode.ThemeColor('charts.gray'));
    } else if (pinned) {
      this.iconPath = new vscode.ThemeIcon('pinned', new vscode.ThemeColor('charts.yellow'));
      this.contextValue = 'stashEntryPinned';
    } else if (stale) {
      this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
      this.contextValue = 'stashEntry';
    } else {
      this.iconPath = new vscode.ThemeIcon('archive');
      this.contextValue = 'stashEntry';
    }

    const parts = [
      `**${entry.ref}**\n\n${entry.message}\n\n`,
      `_Branch: ${entry.branch}_\n_Created: ${age} (${entry.date})_\n`,
      `_Hash: ${entry.hash}_`,
      fileCount !== undefined ? `\n_Files: ${fileCount}_` : '',
      diffStat ? `\n_+${diffStat.added} / -${diffStat.removed}_` : '',
      note ? `\n\n\u{1F4DD} _Note: ${note}_` : '',
      pinned ? '\n\n\u{1F4CC} _Pinned_' : '',
      archived ? '\n\n\u{1F4E6} _Archived_' : '',
      label ? `\n\n${LABEL_EMOJI[label]} _${label}_` : '',
      stale ? `\n\n\u26A0\uFE0F _Older than ${staleThreshold} days_` : '',
    ];
    this.tooltip = new vscode.MarkdownString(parts.join(''));
  }
}

export class StashFileTreeItem extends vscode.TreeItem {
  public readonly absolutePath: string;
  public readonly relativePath: string;
  public readonly changeUri: vscode.Uri;
  public readonly stashRef: string;
  public readonly fileStatus: Status;

  constructor(changeUri: vscode.Uri, status: Status, stashRef: string, repoRoot: string) {
    const absPath = changeUri.fsPath;
    const relativePath = path.relative(repoRoot, absPath);
    const badge = statusLabel(status);
    const { label, description } = fileTreeLabel(relativePath, badge);
    super(label, vscode.TreeItemCollapsibleState.None);
    this.absolutePath = absPath;
    this.relativePath = relativePath;
    this.changeUri = changeUri;
    this.stashRef = stashRef;
    this.fileStatus = status;
    this.description = description;
    this.tooltip = `${relativePath} [${badge}]`;
    this.iconPath = statusThemeIcon(status);
    this.contextValue = 'stashFile';
    this.id = `stashfile-${stashRef}-${relativePath}`;
    this.command = { title: 'Show File Diff', command: 'stasher.showFileDiff', arguments: [this] };
  }
}

export class StashLoadingItem extends vscode.TreeItem {
  constructor() {
    super('Loading files\u2026', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('loading~spin');
    this.contextValue = 'stashLoading';
  }
}

export class StashErrorItem extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('warning');
    this.contextValue = 'stashError';
  }
}

// ─── Tree Data Provider ───────────────────────────────────────────────────────

type AnyTreeItem =
  | StashBranchGroupItem
  | StashDirGroupItem
  | StashTreeItem
  | StashFileTreeItem
  | StashLoadingItem
  | StashErrorItem;

export type SortField = 'date' | 'branch' | 'message' | 'fileCount' | 'label';
export type SortOrder = 'asc' | 'desc';

export class StashTreeDataProvider implements vscode.TreeDataProvider<AnyTreeItem> {
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<AnyTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly _cache = new StashCache();
  private readonly _expansion: TreeExpansionState;
  private _stashes: StashEntry[] = [];
  private _filterQuery = '';
  private _showArchived = false;
  private _groupByBranch = false;
  private _groupByDir = false;
  private _staleThreshold = 7;
  private _showNotesInTree = true;
  private _showFileCountsInTree = true;
  private _showDiffStatInTree = false;
  private _sortBy: SortField = 'date';
  private _sortOrder: SortOrder = 'desc';
  private readonly _checkedIds = new Set<string>();
  private readonly _context: vscode.ExtensionContext;
  private readonly _loadingRefs = new Set<string>();
  private _countDebounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(context: vscode.ExtensionContext, expansion: TreeExpansionState) {
    this._context = context;
    this._expansion = expansion;
    this._readConfig();
    context.subscriptions.push(
      onDidChangeStashes(() => {
        this._cache.clearChildren();
        this.refresh();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('stasher')) {
          this._readConfig();
          this._onDidChangeTreeData.fire();
        }
      }),
    );
  }

  private _readConfig(): void {
    const cfg = vscode.workspace.getConfiguration('stasher');
    this._groupByBranch = cfg.get<boolean>('groupByBranch', false);
    this._groupByDir = cfg.get<boolean>('groupFilesByDirectory', false);
    this._staleThreshold = cfg.get<number>('staleThresholdDays', 7);
    this._showNotesInTree = cfg.get<boolean>('showNotesInTree', true);
    this._showFileCountsInTree = cfg.get<boolean>('showFileCountsInTree', true);
    this._showDiffStatInTree = cfg.get<boolean>('showDiffStatInTree', false);
    this._sortBy = cfg.get<SortField>('sortBy', 'date');
    this._sortOrder = cfg.get<SortOrder>('sortOrder', 'desc');
  }

  refresh(): void {
    this._stashes = listStashes();
    const validHashes = new Set(this._stashes.map((s) => s.hash));
    const validRefs = new Set(this._stashes.map((s) => s.ref));
    this._cache.pruneCounts(validHashes);
    this._cache.prunePaths(validRefs);
    this._cache.pruneDiffStats(validHashes);

    const validIds = new Set(
      this._stashes.map((s) => `stash-${s.hash}`),
    );
    for (const s of this._stashes) {
      validIds.add(`branchgroup-${s.branch}`);
    }
    this._expansion.prune(validIds);
    this._onDidChangeTreeData.fire();
    this._scheduleFileCounts();
  }

  private _scheduleFileCounts(): void {
    if (this._countDebounceTimer) {
      clearTimeout(this._countDebounceTimer);
    }
    this._countDebounceTimer = setTimeout(() => {
      void this._loadFileCountsInBackground();
      void this._loadDiffStatsInBackground();
    }, 400);
  }

  setFilter(q: string): void {
    this._filterQuery = q.toLowerCase().trim();
    this._onDidChangeTreeData.fire();
  }

  clearFilter(): void {
    this._filterQuery = '';
    this._onDidChangeTreeData.fire();
  }

  toggleShowArchived(): void {
    this._showArchived = !this._showArchived;
    this._onDidChangeTreeData.fire();
  }

  get hasFilter(): boolean { return this._filterQuery.length > 0; }
  get filterQuery(): string { return this._filterQuery; }
  get showArchived(): boolean { return this._showArchived; }
  get groupByBranch(): boolean { return this._groupByBranch; }
  get groupByDir(): boolean { return this._groupByDir; }
  get staleThresholdDays(): number { return this._staleThreshold; }
  get expansion(): TreeExpansionState { return this._expansion; }
  get cache(): StashCache { return this._cache; }

  get visibleStashCount(): number {
    return this._getVisibleStashes().length;
  }

  get staleUnpinnedCount(): number {
    const ctx = this._context;
    return this._stashes.filter(
      (s) => isStale(s.date, this._staleThreshold) && !isStashPinned(ctx, s.hash) && !isStashArchived(ctx, s.hash),
    ).length;
  }

  getTreeItem(el: AnyTreeItem): vscode.TreeItem {
    if (el instanceof StashTreeItem) {
      el.checkboxState = this._checkedIds.has(el.id!)
        ? vscode.TreeItemCheckboxState.Checked
        : vscode.TreeItemCheckboxState.Unchecked;
    }
    return el;
  }

  async getChildren(element?: AnyTreeItem): Promise<AnyTreeItem[]> {
    if (!element) {
      const stashes = this._getVisibleStashes();
      if (this._groupByBranch) {
        return this._buildBranchGroups(stashes);
      }
      return this._buildStashItems(stashes);
    }

    if (element instanceof StashBranchGroupItem) {
      return this._buildStashItems(element.stashes);
    }

    if (element instanceof StashTreeItem) {
      return this._getStashChildren(element);
    }

    if (element instanceof StashDirGroupItem) {
      return element.fileItems;
    }

    return [];
  }

  private _getVisibleStashes(): StashEntry[] {
    const ctx = this._context;
    let filtered = this._stashes;

    if (!this._showArchived) {
      filtered = filtered.filter((s) => !isStashArchived(ctx, s.hash));
    }

    if (this._filterQuery) {
      const q = this._filterQuery;
      filtered = filtered.filter((s) =>
        s.message.toLowerCase().includes(q) ||
        s.branch.toLowerCase().includes(q) ||
        s.ref.toLowerCase().includes(q),
      );
    }

    return filtered;
  }

  private _sortStashes(stashes: StashEntry[]): StashEntry[] {
    const ctx = this._context;
    const { _sortBy: sortBy, _sortOrder: sortOrder } = this;

    // Build lookup maps once to avoid repeated workspaceState reads
    // inside the O(n log n) comparator
    const pinnedSet = new Set(
      stashes.filter((s) => isStashPinned(ctx, s.hash)).map((s) => s.hash),
    );
    const labelCache = new Map<string, string>();
    for (const s of stashes) {
      labelCache.set(s.hash, getStashLabel(ctx, s.hash) ?? '');
    }

    // Field-specific comparison (ascending); direction applied below
    const fieldCmp = (a: StashEntry, b: StashEntry): number => {
      let result = 0;
      switch (sortBy) {
        case 'date':
          result = a.date.localeCompare(b.date);
          break;
        case 'branch':
          result = a.branch.localeCompare(b.branch);
          break;
        case 'message':
          result = a.message.localeCompare(b.message);
          break;
        case 'fileCount': {
          const ca = this._cache.getFileCount(a.hash) ?? 0;
          const cb = this._cache.getFileCount(b.hash) ?? 0;
          result = ca - cb;
          break;
        }
        case 'label':
          result = (labelCache.get(a.hash) ?? '').localeCompare(labelCache.get(b.hash) ?? '');
          break;
        default:
          result = a.date.localeCompare(b.date);
      }
      // Negate for descending so newest/largest comes first
      return sortOrder === 'desc' ? -result : result;
    };

    // Unified comparator: pinned-first, then by selected field
    return [...stashes].sort((a, b) => {
      const pinDiff = (pinnedSet.has(b.hash) ? 1 : 0) - (pinnedSet.has(a.hash) ? 1 : 0);
      return pinDiff !== 0 ? pinDiff : fieldCmp(a, b);
    });
  }

  private _buildStashItems(stashes: StashEntry[]): StashTreeItem[] {
    const ctx = this._context;
    const sorted = this._sortStashes(stashes);
    return sorted.map((s) => new StashTreeItem(
      s,
      isStashPinned(ctx, s.hash),
      isStashArchived(ctx, s.hash),
      getStashNote(ctx, s.hash),
      getStashLabel(ctx, s.hash),
      this._groupByBranch,
      this._staleThreshold,
      this._showFileCountsInTree ? this._cache.getFileCount(s.hash) : undefined,
      this._showFileCountsInTree,
      this._showNotesInTree,
      this._expansion,
      this._showDiffStatInTree ? this._cache.getDiffStat(s.hash) : undefined,
      this._showDiffStatInTree,
    ));
  }

  private _buildBranchGroups(stashes: StashEntry[]): StashBranchGroupItem[] {
    const map = new Map<string, StashEntry[]>();
    for (const s of stashes) {
      const arr = map.get(s.branch) ?? [];
      arr.push(s);
      map.set(s.branch, arr);
    }
    const currentBranch = getRepository()?.state.HEAD?.name;
    const sortedBranches = sortBranchNames([...map.keys()], currentBranch);
    return sortedBranches.map(
      (branch) => new StashBranchGroupItem(branch, map.get(branch)!, this._expansion),
    );
  }

  private async _getStashChildren(element: StashTreeItem): Promise<AnyTreeItem[]> {
    const entry = element.stashEntry;
    const cached = this._cache.getChildren(entry.ref, this._groupByDir);
    if (cached) {
      return cached as AnyTreeItem[];
    }

    if (this._loadingRefs.has(entry.ref)) {
      return [new StashLoadingItem()];
    }

    this._loadingRefs.add(entry.ref);
    void this._loadStashChildren(entry, element);
    return [new StashLoadingItem()];
  }

  private async _loadStashChildren(entry: StashEntry, element: StashTreeItem): Promise<void> {
    try {
      const children = await this._resolveStashChildren(entry);
      this._cache.setChildren(entry.ref, this._groupByDir, children);
      const paths = this._collectRelativePaths(children);
      if (paths.length > 0) {
        this._cache.setFilePathsForEntry(entry, paths);
      }
      this._onDidChangeTreeData.fire(element);
    } finally {
      this._loadingRefs.delete(entry.ref);
    }
  }

  private async _resolveStashChildren(entry: StashEntry): Promise<AnyTreeItem[]> {
    const repo = getRepository();
    if (!repo) {
      return [new StashErrorItem('Repository not available')];
    }
    const repoRoot = repo.rootUri.fsPath;
    try {
      const { tracked, untracked } = await getStashFiles(entry.ref);
      const all = [...tracked, ...untracked];
      if (all.length === 0) {
        return [new StashErrorItem('No file changes found in this stash')];
      }
      const fileItems = all.map(
        (c) => new StashFileTreeItem(c.uri, c.status, entry.ref, repoRoot),
      );
      return this._groupByDir ? this._buildDirGroups(fileItems, entry.ref) : fileItems;
    } catch (err) {
      return [new StashErrorItem(
        `Could not load files: ${err instanceof Error ? err.message : String(err)}`,
      )];
    }
  }

  private _collectRelativePaths(children: AnyTreeItem[]): string[] {
    const paths: string[] = [];
    for (const child of children) {
      if (child instanceof StashFileTreeItem) {
        paths.push(child.relativePath);
      } else if (child instanceof StashDirGroupItem) {
        paths.push(...child.fileItems.map((f) => f.relativePath));
      }
    }
    return paths;
  }

  private _buildDirGroups(items: StashFileTreeItem[], stashRef: string): AnyTreeItem[] {
    const map = new Map<string, StashFileTreeItem[]>();
    for (const item of items) {
      const dir = path.dirname(item.relativePath);
      const key = dir === '.' ? '(root)' : dir;
      const arr = map.get(key) ?? [];
      arr.push(item);
      map.set(key, arr);
    }
    if (map.size <= 1) {
      return items;
    }
    return [...map.entries()].map(([dir, fItems]) => new StashDirGroupItem(dir, fItems, stashRef));
  }

  private async _loadFileCountsInBackground(): Promise<void> {
    if (!this._showFileCountsInTree) {
      return;
    }
    const pending = this._stashes.filter((s) => this._cache.getFileCount(s.hash) === undefined);
    if (pending.length === 0) {
      return;
    }
    for (const entry of pending) {
      const paths = getStashFilePaths(entry);
      this._cache.setFilePathsForEntry(entry, paths);
    }
    this._onDidChangeTreeData.fire();
  }

  // ── Checkbox handling ──────────────────────────────────────────────────────

  handleCheckboxChange(
    items: ReadonlyArray<[AnyTreeItem, vscode.TreeItemCheckboxState]>,
  ): void {
    for (const [item, state] of items) {
      if (!(item instanceof StashTreeItem)) {
        continue;
      }
      if (state === vscode.TreeItemCheckboxState.Checked) {
        this._checkedIds.add(item.id!);
      } else {
        this._checkedIds.delete(item.id!);
      }
    }
  }

  /** Returns stash entries for all checked items in the current view. */
  getCheckedStashes(): StashEntry[] {
    return this._stashes.filter(
      (s) => this._checkedIds.has(`stash-${s.hash}`),
    );
  }

  // ── Diff stat background loading ───────────────────────────────────────────

  private async _loadDiffStatsInBackground(): Promise<void> {
    if (!this._showDiffStatInTree) {
      return;
    }
    const ctx = this._context;
    const pending = this._stashes.filter(
      (s) => !isStashArchived(ctx, s.hash) && this._cache.getDiffStat(s.hash) === undefined,
    );
    if (pending.length === 0) {
      return;
    }
    // Process in batches and yield to the event loop between batches
    // so the extension host doesn't freeze on repos with many stashes
    const BATCH_SIZE = 5;
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      for (const entry of batch) {
        try {
          const stats = getStashStats(entry);
          this._cache.setDiffStat(entry.hash, stats);
        } catch {
          // skip entries that fail
        }
      }
      // Fire after each batch so UI updates incrementally
      this._onDidChangeTreeData.fire();
      if (i + BATCH_SIZE < pending.length) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  dispose(): void {
    if (this._countDebounceTimer) {
      clearTimeout(this._countDebounceTimer);
    }
    this._cache.clear();
    this._onDidChangeTreeData.dispose();
  }
}
