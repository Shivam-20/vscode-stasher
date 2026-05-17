import * as vscode from 'vscode';
import * as path from 'path';
import { getStashFileContent } from './gitHelper';
import type { StashFileTreeItem } from './stashProvider';

/**
 * URI scheme for the Stasher peek provider.
 * URIs look like: stasher-peek://stash@{0}/path/to/file.ts
 */
export const PEEK_SCHEME = 'stasher-peek';

/**
 * A read-only TextDocumentContentProvider that serves the raw content of a
 * file inside a stash — without touching the working tree.
 */
export class StashPeekProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = PEEK_SCHEME;

  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    // Authority = stash ref (encoded), path = relative file path
    const stashRef = decodeURIComponent(uri.authority);
    const relPath = uri.path.startsWith('/') ? uri.path.slice(1) : uri.path;

    if (stashRef === 'empty') {
      return '';
    }

    try {
      return getStashFileContent(stashRef, relPath);
    } catch {
      return `// Stasher: Could not load content for ${stashRef}:${relPath}`;
    }
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

/**
 * Builds a stasher-peek:// URI for a given stash file item.
 */
export function buildPeekUri(item: StashFileTreeItem, repoRoot: string): vscode.Uri {
  const relPath = path.relative(repoRoot, item.absolutePath).replace(/\\/g, '/');
  const encodedRef = encodeURIComponent(item.stashRef);
  return vscode.Uri.parse(`${PEEK_SCHEME}://${encodedRef}/${relPath}`);
}
/**
 * Builds a stasher-peek:// URI for an empty file version.
 */
export function buildEmptyUri(item: StashFileTreeItem, repoRoot: string): vscode.Uri {
  const relPath = path.relative(repoRoot, item.absolutePath).replace(/\\/g, '/');
  return vscode.Uri.parse(`${PEEK_SCHEME}://empty/${relPath}`);
}
/**
 * Opens the stash version of a file in a read-only editor (no working tree changes).
 */
export async function peekStashFile(
  item: StashFileTreeItem,
  repoRoot: string
): Promise<void> {
  const uri = buildPeekUri(item, repoRoot);
  const fileName = path.basename(item.absolutePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, {
    preview: true,
    viewColumn: vscode.ViewColumn.Beside,
  });
  // Set a meaningful title via rename — not possible directly, but
  // the URI path shows the file name automatically in the tab.
  void vscode.window.showInformationMessage(
    `Stasher: Peeking at ${item.stashRef} → ${fileName} (read-only)`
  );
}
