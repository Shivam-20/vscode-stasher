import * as vscode from 'vscode';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { Status } from './gitEnums';
import { getRepository, onDidChangeStashes } from './gitHelper';
import type { Change } from './git';

// ─── Status helpers ───────────────────────────────────────────────────────────

function statusLabel(status: Status): string {
  switch (status) {
    case Status.INDEX_MODIFIED:
    case Status.MODIFIED:
      return 'M';
    case Status.INDEX_ADDED:
    case Status.UNTRACKED:
    case Status.INTENT_TO_ADD:
      return 'A';
    case Status.INDEX_DELETED:
    case Status.DELETED:
      return 'D';
    case Status.INDEX_RENAMED:
      return 'R';
    default:
      return '?';
  }
}

function statusIcon(status: Status): vscode.ThemeIcon {
  switch (status) {
    case Status.INDEX_ADDED:
    case Status.UNTRACKED:
    case Status.INTENT_TO_ADD:
      return new vscode.ThemeIcon(
        'diff-added',
        new vscode.ThemeColor('gitDecoration.addedResourceForeground')
      );
    case Status.INDEX_DELETED:
    case Status.DELETED:
      return new vscode.ThemeIcon(
        'diff-removed',
        new vscode.ThemeColor('gitDecoration.deletedResourceForeground')
      );
    default:
      return new vscode.ThemeIcon(
        'diff-modified',
        new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')
      );
  }
}

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

    this.description = statusLabel(change.status);
    this.tooltip = `${relativePath} [${statusLabel(change.status)}] — ${groupType}`;
    this.iconPath = statusIcon(change.status);
    this.contextValue = 'workingFile';

    // Default to checked so the user can selectively uncheck
    this.checkboxState = vscode.TreeItemCheckboxState.Checked;
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

    // Any new item that hasn't been explicitly unchecked starts as checked
    for (const item of this._allItems) {
      if (!this._checkedIds.has('__unchecked__' + item.id)) {
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
      // Root: build groups lazily
      this._buildItems();
      const repo = getRepository();
      if (!repo) {
        return [];
      }
      const repoRoot = repo.rootUri.fsPath;

      const staged = repo.state.indexChanges.map(
        (c) => new WorkingFileItem(c, 'staged', repoRoot)
      );
      const working = repo.state.workingTreeChanges.map(
        (c) => new WorkingFileItem(c, 'working', repoRoot)
      );
      this._allItems = [...staged, ...working];

      // Restore/set checkbox state
      for (const item of this._allItems) {
        if (!this._checkedIds.has('__unchecked__' + item.id!)) {
          this._checkedIds.add(item.id!);
        }
        item.checkboxState = this._checkedIds.has(item.id!)
          ? vscode.TreeItemCheckboxState.Checked
          : vscode.TreeItemCheckboxState.Unchecked;
      }

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
