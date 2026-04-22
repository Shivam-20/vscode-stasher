import * as vscode from 'vscode';
import * as path from 'path';
import { Status } from './gitEnums';
import { getAPI } from './gitHelper';
import type { StashFileTreeItem } from './stashProvider';

/**
 * Opens a side-by-side diff for a single file from a stash.
 *
 * Left  = file content at HEAD when the stash was created  (stashRef^1)
 * Right = file content stored inside the stash             (stashRef)
 *
 * We reuse the built-in `git:` content provider via `api.toGitUri()`,
 * so no custom TextDocumentContentProvider is needed.
 */
export async function showFileDiff(item: StashFileTreeItem): Promise<void> {
  const api = getAPI();
  if (!api) {
    void vscode.window.showErrorMessage('Stasher: Git API is not available.');
    return;
  }

  const { stashRef, changeUri, fileStatus } = item;
  const fileName = path.basename(changeUri.fsPath);

  let baseUri: vscode.Uri;
  let stashUri: vscode.Uri;

  if (
    fileStatus === Status.INDEX_ADDED ||
    fileStatus === Status.UNTRACKED ||
    fileStatus === Status.INTENT_TO_ADD
  ) {
    // File was added in the stash — no base version exists.
    baseUri = api.toGitUri(changeUri, '~');
    stashUri = api.toGitUri(changeUri, stashRef);
  } else if (
    fileStatus === Status.INDEX_DELETED ||
    fileStatus === Status.DELETED
  ) {
    // File was deleted in the stash — right side is empty.
    baseUri = api.toGitUri(changeUri, `${stashRef}^1`);
    stashUri = api.toGitUri(changeUri, '~');
  } else {
    // Modified (most common) — show before → after
    baseUri = api.toGitUri(changeUri, `${stashRef}^1`);
    stashUri = api.toGitUri(changeUri, stashRef);
  }

  const title = `${stashRef}: ${fileName}`;

  await vscode.commands.executeCommand(
    'vscode.diff',
    baseUri,
    stashUri,
    title,
    { preview: true } satisfies vscode.TextDocumentShowOptions
  );
}
