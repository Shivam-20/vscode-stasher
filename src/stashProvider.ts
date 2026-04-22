import * as vscode from 'vscode';
import * as path from 'path';
import { Status } from './gitEnums';
import {
  listStashes,
  getStashFiles,
  getRepository,
  onDidChangeStashes,
  type StashEntry,
} from './gitHelper';

// ─── Status badge helpers ─────────────────────────────────────────────────────

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
    case Status.INDEX_COPIED:
      return 'C';
    case Status.BOTH_MODIFIED:
      return 'C!';
    default:
      return '?';
  }
}

function statusThemeIcon(status: Status): vscode.ThemeIcon {
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

// ─── Tree item types ──────────────────────────────────────────────────────────

export class StashTreeItem extends vscode.TreeItem {
  public readonly stashEntry: StashEntry;

  constructor(entry: StashEntry) {
    // Truncate long messages for the label
    const label =
      entry.message.length > 55
        ? entry.message.substring(0, 52) + '…'
        : entry.message;

    super(label, vscode.TreeItemCollapsibleState.Collapsed);

    this.stashEntry = entry;
    this.description = entry.branch;
    this.tooltip = new vscode.MarkdownString(
      `**${entry.ref}**\n\n${entry.message}\n\n_Branch: ${entry.branch}_\n\n_Hash: ${entry.hash}_`
    );
    this.iconPath = new vscode.ThemeIcon('archive');
    this.contextValue = 'stashEntry';
    this.id = `stash-${entry.hash}`;
  }
}

export class StashFileTreeItem extends vscode.TreeItem {
  public readonly absolutePath: string;
  /** The original Uri as returned by the git API — used for diff commands */
  public readonly changeUri: vscode.Uri;
  public readonly stashRef: string;
  public readonly fileStatus: Status;

  constructor(
    changeUri: vscode.Uri,
    status: Status,
    stashRef: string,
    repoRoot: string
  ) {
    const absPath = changeUri.fsPath;
    const relativePath = path.relative(repoRoot, absPath);

    super(relativePath, vscode.TreeItemCollapsibleState.None);

    this.absolutePath = absPath;
    this.changeUri = changeUri;
    this.stashRef = stashRef;
    this.fileStatus = status;

    this.description = statusLabel(status);
    this.tooltip = `${relativePath} [${statusLabel(status)}]`;
    this.iconPath = statusThemeIcon(status);
    this.contextValue = 'stashFile';
    this.id = `stashfile-${stashRef}-${relativePath}`;

    // Open diff when user clicks the file row
    this.command = {
      title: 'Show File Diff',
      command: 'stasher.showFileDiff',
      arguments: [this],
    };
  }
}

export class StashLoadingItem extends vscode.TreeItem {
  constructor() {
    super('Loading files…', vscode.TreeItemCollapsibleState.None);
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
  | StashTreeItem
  | StashFileTreeItem
  | StashLoadingItem
  | StashErrorItem;

export class StashTreeDataProvider
  implements vscode.TreeDataProvider<AnyTreeItem>
{
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<AnyTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _stashes: StashEntry[] = [];

  constructor(context: vscode.ExtensionContext) {
    // Refresh the tree whenever git state changes
    context.subscriptions.push(
      onDidChangeStashes(() => this.refresh())
    );
  }

  /** Force a full refresh of the stash list. */
  refresh(): void {
    this._stashes = listStashes();
    this._onDidChangeTreeData.fire();
  }

  // ── TreeDataProvider implementation ─────────────────────────────────────────

  getTreeItem(element: AnyTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: AnyTreeItem): Promise<AnyTreeItem[]> {
    // Root level → list all stashes
    if (!element) {
      return this._stashes.map((s) => new StashTreeItem(s));
    }

    // Stash entry → list files in that stash
    if (element instanceof StashTreeItem) {
      return this._getStashChildren(element.stashEntry);
    }

    return [];
  }

  private async _getStashChildren(
    entry: StashEntry
  ): Promise<AnyTreeItem[]> {
    const repo = getRepository();
    if (!repo) {
      return [new StashErrorItem('Repository not available')];
    }

    const repoRoot = repo.rootUri.fsPath;

    let files: StashFileTreeItem[];
    try {
      const { tracked, untracked } = await getStashFiles(entry.ref);
      const allChanges = [...tracked, ...untracked];

      if (allChanges.length === 0) {
        return [new StashErrorItem('No file changes found in this stash')];
      }

      files = allChanges.map(
        (change) =>
          new StashFileTreeItem(
            change.uri,
            change.status,
            entry.ref,
            repoRoot
          )
      );
    } catch (err) {
      return [
        new StashErrorItem(
          `Could not load files: ${err instanceof Error ? err.message : String(err)}`
        ),
      ];
    }

    return files;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
