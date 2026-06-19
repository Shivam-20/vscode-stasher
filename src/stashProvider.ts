import * as vscode from 'vscode';
import * as path from 'path';
import { statusLabel, statusThemeIcon } from './statusHelpers';
import { Status } from './gitEnums';
import { relativeTime, isStale } from './stashAge';
import { stripStashBranchPrefix } from './stashMessage';
import { fileTreeLabel, sortBranchNames } from './treeLabels';
import { isStashPinned, getStashNote, getStashLabel, LABEL_EMOJI } from './stashNotes';
import { StashCache } from './stashCache';
import { TreeExpansionState, collapsibleState } from './treeExpansionState';
import {
  listStashes,
  getStashFiles,
  getStashFilePaths,
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
): string {
  const age = relativeTime(entry.date);
  const emoji = label ? LABEL_EMOJI[label] : '';
  const parts: string[] = [entry.ref, age];

  if (showFileCounts && fileCount !== undefined) {
    parts.push(`${fileCount} file${fileCount !== 1 ? 's' : ''}`);
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
    note: string | undefined,
    label: ReturnType<typeof getStashLabel> | undefined,
    groupedByBranch: boolean,
    staleThreshold: number,
    fileCount: number | undefined,
    showFileCounts: boolean,
    showNotes: boolean,
    expansion: TreeExpansionState,
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
      entry,
      groupedByBranch,
      fileCount,
      showFileCounts,
      note,
      showNotes,
      label,
    );

    if (pinned) {
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
      note ? `\n\n\u{1F4DD} _Note: ${note}_` : '',
      pinned ? '\n\n\u{1F4CC} _Pinned_' : '',
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

export class StashTreeDataProvider implements vscode.TreeDataProvider<AnyTreeItem> {
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<AnyTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly _cache = new StashCache();
  private readonly _expansion: TreeExpansionState;
  private _stashes: StashEntry[] = [];
  private _filterQuery = '';
  private _groupByBranch = false;
  private _groupByDir = false;
  private _staleThreshold = 7;
  private _showNotesInTree = true;
  private _showFileCountsInTree = true;
  private readonly _context: vscode.ExtensionContext;
  private readonly _loadingRefs = new Set<string>();

  constructor(context: vscode.ExtensionContext, expansion: TreeExpansionState) {
    this._context = context;
    this._expansion = expansion;
    this._readConfig();
    context.subscriptions.push(
      onDidChangeStashes(() => {
        this._cache.clear();
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
  }

  refresh(): void {
    this._stashes = listStashes();
    const validIds = new Set(
      this._stashes.map((s) => `stash-${s.hash}`),
    );
    for (const s of this._stashes) {
      validIds.add(`branchgroup-${s.branch}`);
    }
    this._expansion.prune(validIds);
    this._onDidChangeTreeData.fire();
    void this._loadFileCountsInBackground();
  }

  setFilter(q: string): void {
    this._filterQuery = q.toLowerCase().trim();
    this._onDidChangeTreeData.fire();
  }

  clearFilter(): void {
    this._filterQuery = '';
    this._onDidChangeTreeData.fire();
  }

  get hasFilter(): boolean { return this._filterQuery.length > 0; }
  get filterQuery(): string { return this._filterQuery; }
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
      (s) => isStale(s.date, this._staleThreshold) && !isStashPinned(ctx, s.hash),
    ).length;
  }

  getTreeItem(el: AnyTreeItem): vscode.TreeItem { return el; }

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
    if (!this._filterQuery) {
      return this._stashes;
    }
    return this._stashes.filter((s) =>
      s.message.toLowerCase().includes(this._filterQuery) ||
      s.branch.toLowerCase().includes(this._filterQuery) ||
      s.ref.toLowerCase().includes(this._filterQuery),
    );
  }

  private _buildStashItems(stashes: StashEntry[]): StashTreeItem[] {
    const ctx = this._context;
    const sorted = [
      ...stashes.filter((s) => isStashPinned(ctx, s.hash)),
      ...stashes.filter((s) => !isStashPinned(ctx, s.hash)),
    ];
    return sorted.map((s) => new StashTreeItem(
      s,
      isStashPinned(ctx, s.hash),
      getStashNote(ctx, s.hash),
      getStashLabel(ctx, s.hash),
      this._groupByBranch,
      this._staleThreshold,
      this._showFileCountsInTree ? this._cache.getFileCount(s.hash) : undefined,
      this._showFileCountsInTree,
      this._showNotesInTree,
      this._expansion,
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

  dispose(): void {
    this._cache.clear();
    this._onDidChangeTreeData.dispose();
  }
}
