import * as vscode from 'vscode';

const STORAGE_KEY = 'stasher.expandedTreeIds';

export class TreeExpansionState {
  private _expanded = new Set<string>();

  constructor(private readonly _context: vscode.ExtensionContext) {
    const saved = _context.workspaceState.get<string[]>(STORAGE_KEY, []);
    this._expanded = new Set(saved);
  }

  isExpanded(id: string | undefined): boolean {
    return id ? this._expanded.has(id) : false;
  }

  expand(id: string | undefined): void {
    if (!id) { return; }
    this._expanded.add(id);
    void this._persist();
  }

  collapse(id: string | undefined): void {
    if (!id) { return; }
    this._expanded.delete(id);
    void this._persist();
  }

  prune(validIds: Set<string>): void {
    let changed = false;
    for (const id of this._expanded) {
      if (!validIds.has(id)) {
        this._expanded.delete(id);
        changed = true;
      }
    }
    if (changed) {
      void this._persist();
    }
  }

  private async _persist(): Promise<void> {
    await this._context.workspaceState.update(STORAGE_KEY, [...this._expanded]);
  }
}

export function collapsibleState(
  id: string | undefined,
  expansion: TreeExpansionState,
  defaultState: vscode.TreeItemCollapsibleState,
): vscode.TreeItemCollapsibleState {
  if (expansion.isExpanded(id)) {
    return vscode.TreeItemCollapsibleState.Expanded;
  }
  return defaultState;
}
