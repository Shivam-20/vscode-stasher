import * as vscode from 'vscode';
import * as path from 'path';
import { statusLabel, statusThemeIcon } from './statusHelpers';
import { Status } from './gitEnums';
import { getRepository, onDidChangeStashes } from './gitHelper';
import type { Change } from './git';

// ─── Tree items ───────────────────────────────────────────────────────────────

/** Group header: "Staged Changes" or "Working Changes" */
export class ChangeGroupItem extends vscode.TreeItem {
  constructor(
    public readonly groupLabel: string,
    public readonly children: WorkingFileItem[]
  ) {
    super(groupLabel, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'changeGroup';
    this.iconPath = new vscode.ThemeIcon('list-flat');
  }
}

/** A single file in staged or working-tree changes */
export class WorkingFileItem extends vscode.TreeItem {
  public readonly change: Change;
  public readonly groupType: 'staged' | 'working';

  constructor(change: Change, groupType: 'staged' | 'working', repoRoot: string) {
    const relativePath = path.relative(repoRoot, change.uri.fsPath);
    super(relativePath, vscode.TreeItemCollapsibleState.None);

    this.change = change;
    this.groupType = groupType;
    this.id = `${groupType}:${change.uri.fsPath}`;

    this.description = statusLabel(change.status);
    this.tooltip = `${relativePath} [${statusLabel(change.status)}] — ${groupType}`;
    this.iconPath = statusThemeIcon(change.status);
    this.contextValue = 'workingFile';

    // Default to checked so the user can selectively uncheck
    this.checkboxState = vscode.TreeItemCheckboxState.Checked;

    this.command = {
      title: 'Show Changes',
      command: 'stasher.showWorkingDiff',
      arguments: [this]
    };
  }
}

// ─── Provider ────────────────────────────────────────────────────────────────

type AnyItem = ChangeGroupItem | WorkingFileItem;

export class WorkingChangesProvider implements vscode.TreeDataProvider<AnyItem> {
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<AnyItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** Tracks checked state per item id */
  private _checkedIds = new Set<string>();
  private _allItems: WorkingFileItem[] = [];

  constructor(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      onDidChangeStashes(() => this.refresh())
    );
  }

  refresh(): void {
    this._buildItems();
    this._onDidChangeTreeData.fire();
  }

  private _buildItems(): void {
    const repo = getRepository();
    if (!repo) {
      this._allItems = [];
      return;
    }
    const repoRoot = repo.rootUri.fsPath;

    const staged = repo.state.indexChanges.map(
      (c) => new WorkingFileItem(c, 'staged', repoRoot)
    );
    const working = repo.state.workingTreeChanges.map(
      (c) => new WorkingFileItem(c, 'working', repoRoot)
    );

    this._allItems = [...staged, ...working];

    // Remove stale IDs for items that no longer exist in the working tree
    const currentIds = new Set(this._allItems.map((item) => item.id!));
    for (const id of [...this._checkedIds]) {
      const baseId = id.startsWith('__unchecked__') ? id.slice(13) : id;
      if (!currentIds.has(baseId)) {
        this._checkedIds.delete(id);
      }
    }

    // Any new item that hasn't been explicitly unchecked starts as checked
    for (const item of this._allItems) {
      if (!this._checkedIds.has('__unchecked__' + item.id!)) {
        this._checkedIds.add(item.id!);
      }
    }
  }

  // ── TreeDataProvider ────────────────────────────────────────────────────────

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
        groups.push(new ChangeGroupItem(`Staged Changes (${staged.length})`, staged));
      }
      if (working.length > 0) {
        groups.push(new ChangeGroupItem(`Working Changes (${working.length})`, working));
      }
      return groups;
    }

    if (element instanceof ChangeGroupItem) {
      return element.children;
    }
    return [];
  }

  // ── Checkbox management ──────────────────────────────────────────────────────

  handleCheckboxChange(
    items: ReadonlyArray<[AnyItem, vscode.TreeItemCheckboxState]>
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

  /** Returns file paths of all checked working file items */
  getCheckedPaths(): string[] {
    return this._allItems
      .filter((item) => this._checkedIds.has(item.id!))
      .map((item) => item.change.uri.fsPath);
  }

  /** Returns ALL file paths regardless of checkbox state */
  getAllPaths(): string[] {
    return this._allItems.map((item) => item.change.uri.fsPath);
  }

  hasAnyChanges(): boolean {
    return this._allItems.length > 0;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
