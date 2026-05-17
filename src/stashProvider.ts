import * as vscode from 'vscode';
import * as path from 'path';
import { statusLabel, statusThemeIcon } from './statusHelpers';
import { Status } from './gitEnums';
import { relativeTime, isStale } from './stashAge';
import { isStashPinned, getStashNote, getStashLabel, LABEL_EMOJI } from './stashNotes';
import {
  listStashes,
  getStashFiles,
  getRepository,
  onDidChangeStashes,
  type StashEntry,
} from './gitHelper';

// ─── Tree item types ──────────────────────────────────────────────────────────

export class StashBranchGroupItem extends vscode.TreeItem {
  constructor(
    public readonly branchName: string,
    public readonly stashes: StashEntry[],
  ) {
    super(`${branchName}`, vscode.TreeItemCollapsibleState.Expanded);
    this.description = `${stashes.length} stash${stashes.length !== 1 ? 'es' : ''}`;
    this.iconPath = new vscode.ThemeIcon('git-branch');
    this.contextValue = 'branchGroup';
    this.id = `branchgroup-${branchName}`;
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
    pinned: boolean = false,
    note?: string,
    label?: ReturnType<typeof getStashLabel>,
  ) {
    const msg = entry.message.length > 55 ? entry.message.substring(0, 52) + '\u2026' : entry.message;
    super(msg, vscode.TreeItemCollapsibleState.Collapsed);
    this.stashEntry = entry;

    const age   = relativeTime(entry.date);
    const stale = isStale(entry.date);
    const emoji = label ? LABEL_EMOJI[label] : '';

    this.description = `${entry.branch}  ${age}${emoji ? '  ' + emoji : ''}`;

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
      note   ? `\n\n\u{1F4DD} _Note: ${note}_`         : '',
      pinned ? '\n\n\u{1F4CC} _Pinned_'                : '',
      label  ? `\n\n${LABEL_EMOJI[label]} _${label}_`  : '',
      stale  ? '\n\n\u26A0\uFE0F _Older than 7 days_'  : '',
    ];
    this.tooltip = new vscode.MarkdownString(parts.join(''));
    this.id = `stash-${entry.hash}`;
  }
}

export class StashFileTreeItem extends vscode.TreeItem {
  public readonly absolutePath: string;
  public readonly changeUri: vscode.Uri;
  public readonly stashRef: string;
  public readonly fileStatus: Status;

  constructor(changeUri: vscode.Uri, status: Status, stashRef: string, repoRoot: string) {
    const absPath = changeUri.fsPath;
    const relativePath = path.relative(repoRoot, absPath);
    super(relativePath, vscode.TreeItemCollapsibleState.None);
    this.absolutePath = absPath;
    this.changeUri    = changeUri;
    this.stashRef     = stashRef;
    this.fileStatus   = status;
    this.description  = statusLabel(status);
    this.tooltip      = `${relativePath} [${statusLabel(status)}]`;
    this.iconPath     = statusThemeIcon(status);
    this.contextValue = 'stashFile';
    this.id           = `stashfile-${stashRef}-${relativePath}`;
    this.command      = { title: 'Show File Diff', command: 'stasher.showFileDiff', arguments: [this] };
  }
}

export class StashLoadingItem extends vscode.TreeItem {
  constructor() {
    super('Loading files\u2026', vscode.TreeItemCollapsibleState.None);
    this.iconPath     = new vscode.ThemeIcon('loading~spin');
    this.contextValue = 'stashLoading';
  }
}

export class StashErrorItem extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath     = new vscode.ThemeIcon('warning');
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

  private _stashes: StashEntry[] = [];
  private _filterQuery    = '';
  private _groupByBranch  = false;
  private _groupByDir     = false;
  private readonly _context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
    this._readConfig();
    context.subscriptions.push(
      onDidChangeStashes(() => this.refresh()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('stasher')) { this._readConfig(); this._onDidChangeTreeData.fire(); }
      }),
    );
  }

  private _readConfig(): void {
    const cfg = vscode.workspace.getConfiguration('stasher');
    this._groupByBranch = cfg.get<boolean>('groupByBranch', false);
    this._groupByDir    = cfg.get<boolean>('groupFilesByDirectory', false);
  }

  refresh(): void {
    this._stashes = listStashes();
    this._onDidChangeTreeData.fire();
  }

  setFilter(q: string): void  { this._filterQuery = q.toLowerCase().trim(); this._onDidChangeTreeData.fire(); }
  clearFilter(): void          { this._filterQuery = ''; this._onDidChangeTreeData.fire(); }
  get hasFilter(): boolean     { return this._filterQuery.length > 0; }
  get filterQuery(): string    { return this._filterQuery; }
  get groupByBranch(): boolean { return this._groupByBranch; }
  get groupByDir(): boolean    { return this._groupByDir; }

  getTreeItem(el: AnyTreeItem): vscode.TreeItem { return el; }

  async getChildren(element?: AnyTreeItem): Promise<AnyTreeItem[]> {
    // ── Root ──────────────────────────────────────────────────────────────────
    if (!element) {
      let stashes = this._stashes;
      if (this._filterQuery) {
        stashes = stashes.filter((s) =>
          s.message.toLowerCase().includes(this._filterQuery) ||
          s.branch.toLowerCase().includes(this._filterQuery) ||
          s.ref.toLowerCase().includes(this._filterQuery)
        );
      }
      if (this._groupByBranch) {
        return this._buildBranchGroups(stashes);
      }
      return this._buildStashItems(stashes);
    }

    // ── Branch group → stash items ────────────────────────────────────────────
    if (element instanceof StashBranchGroupItem) {
      return this._buildStashItems(element.stashes);
    }

    // ── Stash entry → files (possibly dir-grouped) ────────────────────────────
    if (element instanceof StashTreeItem) {
      return this._getStashChildren(element.stashEntry);
    }

    // ── Dir group → flat file items ───────────────────────────────────────────
    if (element instanceof StashDirGroupItem) {
      return element.fileItems;
    }

    return [];
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private _buildStashItems(stashes: StashEntry[]): StashTreeItem[] {
    const ctx = this._context;
    const sorted = [
      ...stashes.filter((s) => isStashPinned(ctx, s.hash)),
      ...stashes.filter((s) => !isStashPinned(ctx, s.hash)),
    ];
    return sorted.map((s) =>
      new StashTreeItem(s, isStashPinned(ctx, s.hash), getStashNote(ctx, s.hash), getStashLabel(ctx, s.hash))
    );
  }

  private _buildBranchGroups(stashes: StashEntry[]): StashBranchGroupItem[] {
    const map = new Map<string, StashEntry[]>();
    for (const s of stashes) {
      const arr = map.get(s.branch) ?? [];
      arr.push(s);
      map.set(s.branch, arr);
    }
    return [...map.entries()].map(([branch, entries]) => new StashBranchGroupItem(branch, entries));
  }

  private async _getStashChildren(entry: StashEntry): Promise<AnyTreeItem[]> {
    const repo = getRepository();
    if (!repo) { return [new StashErrorItem('Repository not available')]; }
    const repoRoot = repo.rootUri.fsPath;
    try {
      const { tracked, untracked } = await getStashFiles(entry.ref);
      const all = [...tracked, ...untracked];
      if (all.length === 0) { return [new StashErrorItem('No file changes found in this stash')]; }
      const fileItems = all.map((c) => new StashFileTreeItem(c.uri, c.status, entry.ref, repoRoot));
      return this._groupByDir ? this._buildDirGroups(fileItems, entry.ref) : fileItems;
    } catch (err) {
      return [new StashErrorItem(`Could not load files: ${err instanceof Error ? err.message : String(err)}`)];
    }
  }

  private _buildDirGroups(items: StashFileTreeItem[], stashRef: string): AnyTreeItem[] {
    const map = new Map<string, StashFileTreeItem[]>();
    for (const item of items) {
      const rel = item.label as string;
      const dir = path.dirname(rel);
      const key = dir === '.' ? '(root)' : dir;
      const arr = map.get(key) ?? [];
      arr.push(item);
      map.set(key, arr);
    }
    // If everything is in one directory, don't bother grouping
    if (map.size <= 1) { return items; }
    return [...map.entries()].map(([dir, fItems]) => new StashDirGroupItem(dir, fItems, stashRef));
  }

  dispose(): void { this._onDidChangeTreeData.dispose(); }
}
