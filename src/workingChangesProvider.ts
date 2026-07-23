import * as vscode from 'vscode';
import * as path from 'path';
import { statusLabel, statusThemeIcon } from './statusHelpers';
import { getRepository, onDidChangeStashes } from './gitHelper';
import { fileTreeLabel } from './treeLabels';
import { normalizeRepoPath } from './pathUtils';
import type { Change } from './git';

// ─── Tree items ───────────────────────────────────────────────────────────────

/** Group header: "Staged Changes" or "Working Changes" */
export class ChangeGroupItem extends vscode.TreeItem {
  constructor(
    public readonly groupType: 'staged' | 'working',
    public readonly children: WorkingFileItem[],
  ) {
    const label = groupType === 'staged' ? 'Staged Changes' : 'Working Changes';
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.description = `${children.length} file${children.length !== 1 ? 's' : ''}`;
    this.contextValue = groupType === 'staged' ? 'changeGroupStaged' : 'changeGroupWorking';
    this.iconPath = new vscode.ThemeIcon(groupType === 'staged' ? 'git-commit' : 'edit');
  }
}

export class WorkingDirGroupItem extends vscode.TreeItem {
  constructor(
    public readonly dirPath: string,
    public readonly fileItems: WorkingFileItem[],
    groupType: 'staged' | 'working',
  ) {
    super(dirPath === '(root)' ? '(root)' : dirPath + '/', vscode.TreeItemCollapsibleState.Expanded);
    this.description = `${fileItems.length} file${fileItems.length !== 1 ? 's' : ''}`;
    this.iconPath = new vscode.ThemeIcon('folder');
    this.contextValue = 'workingDirGroup';
    this.id = `dirgroup-${groupType}-${dirPath}`;
  }
}

/** A single file in staged or working-tree changes */
export class WorkingFileItem extends vscode.TreeItem {
  public readonly change: Change;
  public readonly groupType: 'staged' | 'working';
  public readonly relativePath: string;

  constructor(change: Change, groupType: 'staged' | 'working', repoRoot: string) {
    const relativePath = path.relative(repoRoot, change.uri.fsPath);
    const badge = statusLabel(change.status);
    const { label, description } = fileTreeLabel(relativePath, badge);
    super(label, vscode.TreeItemCollapsibleState.None);

    this.change = change;
    this.groupType = groupType;
    this.relativePath = relativePath;
    this.id = `${groupType}:${change.uri.fsPath}`;

    this.description = description;
    this.tooltip = `${relativePath} [${badge}] — ${groupType}`;
    this.iconPath = statusThemeIcon(change.status);
    this.contextValue = 'workingFile';

    this.checkboxState = vscode.TreeItemCheckboxState.Checked;

    this.command = {
      title: 'Show Changes',
      command: 'stasher.showWorkingDiff',
      arguments: [this],
    };
  }
}

// ─── Provider ────────────────────────────────────────────────────────────────

type AnyItem = ChangeGroupItem | WorkingDirGroupItem | WorkingFileItem;

export class WorkingChangesProvider implements vscode.TreeDataProvider<AnyItem> {
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<AnyItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly _checkedIds = new Set<string>();
  private _allItems: WorkingFileItem[] = [];
  private _groupByDir = false;
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(context: vscode.ExtensionContext) {
    this._readConfig();
    context.subscriptions.push(
      onDidChangeStashes(() => this.refresh()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('stasher.groupWorkingByDirectory')) {
          this._readConfig();
          this._onDidChangeTreeData.fire();
        }
      }),
    );
  }

  private _readConfig(): void {
    const cfg = vscode.workspace.getConfiguration('stasher');
    this._groupByDir = cfg.get<boolean>('groupWorkingByDirectory', false);
  }

  refresh(): void {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => {
      this._buildItems();
      this._onDidChangeTreeData.fire();
    }, 400);
  }

  private _buildItems(): void {
    const repo = getRepository();
    if (!repo) {
      this._allItems = [];
      return;
    }
    const repoRoot = repo.rootUri.fsPath;

    const staged = repo.state.indexChanges.map(
      (c) => new WorkingFileItem(c, 'staged', repoRoot),
    );
    const working = repo.state.workingTreeChanges.map(
      (c) => new WorkingFileItem(c, 'working', repoRoot),
    );

    this._allItems = [...staged, ...working];

    const currentIds = new Set(this._allItems.map((item) => item.id!));
    for (const id of [...this._checkedIds]) {
      const baseId = id.startsWith('__unchecked__') ? id.slice(13) : id;
      if (!currentIds.has(baseId)) {
        this._checkedIds.delete(id);
      }
    }

    for (const item of this._allItems) {
      if (!this._checkedIds.has('__unchecked__' + item.id!)) {
        this._checkedIds.add(item.id!);
      }
    }
  }

  getTreeItem(element: AnyItem): vscode.TreeItem {
    if (element instanceof WorkingFileItem) {
      element.checkboxState = this._checkedIds.has(element.id!)
        ? vscode.TreeItemCheckboxState.Checked
        : vscode.TreeItemCheckboxState.Unchecked;
    }
    return element;
  }

  getChildren(element?: AnyItem): AnyItem[] {
    if (!element) {
      if (!getRepository()) {
        return [];
      }

      const staged = this._allItems.filter((item) => item.groupType === 'staged');
      const working = this._allItems.filter((item) => item.groupType === 'working');

      const groups: AnyItem[] = [];
      if (staged.length > 0) {
        groups.push(new ChangeGroupItem('staged', staged));
      }
      if (working.length > 0) {
        groups.push(new ChangeGroupItem('working', working));
      }
      return groups;
    }

    if (element instanceof ChangeGroupItem) {
      return this._groupByDir
        ? this._buildDirGroups(element.children, element.groupType)
        : element.children;
    }

    if (element instanceof WorkingDirGroupItem) {
      return element.fileItems;
    }

    return [];
  }

  handleCheckboxChange(
    items: ReadonlyArray<[AnyItem, vscode.TreeItemCheckboxState]>,
  ): void {
    for (const [item, state] of items) {
      if (!(item instanceof WorkingFileItem)) {
        continue;
      }
      if (state === vscode.TreeItemCheckboxState.Checked) {
        this._checkedIds.add(item.id!);
        this._checkedIds.delete('__unchecked__' + item.id!);
      } else {
        this._checkedIds.delete(item.id!);
        this._checkedIds.add('__unchecked__' + item.id!);
      }
    }
  }

  checkAllInGroup(groupType: 'staged' | 'working'): void {
    for (const item of this._itemsInGroup(groupType)) {
      this._checkedIds.add(item.id!);
      this._checkedIds.delete('__unchecked__' + item.id!);
    }
    this._onDidChangeTreeData.fire();
  }

  uncheckAllInGroup(groupType: 'staged' | 'working'): void {
    for (const item of this._itemsInGroup(groupType)) {
      this._checkedIds.delete(item.id!);
      this._checkedIds.add('__unchecked__' + item.id!);
    }
    this._onDidChangeTreeData.fire();
  }

  invertGroup(groupType: 'staged' | 'working'): void {
    for (const item of this._itemsInGroup(groupType)) {
      if (this._checkedIds.has(item.id!)) {
        this._checkedIds.delete(item.id!);
        this._checkedIds.add('__unchecked__' + item.id!);
      } else {
        this._checkedIds.add(item.id!);
        this._checkedIds.delete('__unchecked__' + item.id!);
      }
    }
    this._onDidChangeTreeData.fire();
  }

  private _itemsInGroup(groupType: 'staged' | 'working'): WorkingFileItem[] {
    return this._allItems.filter((item) => item.groupType === groupType);
  }

  getCheckedPaths(): string[] {
    return this._allItems
      .filter((item) => this._checkedIds.has(item.id!))
      .map((item) => item.change.uri.fsPath);
  }

  getAllPaths(): string[] {
    return this._allItems.map((item) => item.change.uri.fsPath);
  }

  hasAnyChanges(): boolean {
    return this._allItems.length > 0;
  }

  get changeCount(): number {
    return this._allItems.length;
  }

  getLocalRelativePaths(): string[] {
    const repo = getRepository();
    if (!repo) {
      return [];
    }
    const root = repo.rootUri.fsPath;
    const all = [...repo.state.indexChanges, ...repo.state.workingTreeChanges];
    return all.map((c) => normalizeRepoPath(path.relative(root, c.uri.fsPath)));
  }

  private _buildDirGroups(
    items: WorkingFileItem[],
    groupType: 'staged' | 'working',
  ): AnyItem[] {
    const map = new Map<string, WorkingFileItem[]>();
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
    return [...map.entries()].map(
      ([dir, fileItems]) => new WorkingDirGroupItem(dir, fileItems, groupType),
    );
  }

  dispose(): void {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    this._onDidChangeTreeData.dispose();
  }
}
