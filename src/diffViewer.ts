import * as vscode from 'vscode';
import * as path from 'path';
import { Status } from './gitEnums';
import { getAPI, getRepository } from './gitHelper';
import { buildEmptyUri } from './peekProvider';
import type { StashFileTreeItem } from './stashProvider';

/**
 * Opens a side-by-side diff for a single file from a stash.
 */
export async function showFileDiff(item: StashFileTreeItem): Promise<void> {
  const api = getAPI();
  const repo = getRepository();
  if (!api || !repo) {
    void vscode.window.showErrorMessage('Stasher: Git API is not available.');
    return;
  }

  const { stashRef, changeUri, fileStatus } = item;
  const fileName = path.basename(changeUri.fsPath);
  const repoRoot = repo.rootUri.fsPath;

  let baseUri: vscode.Uri;
  let stashUri: vscode.Uri;

  if (
    fileStatus === Status.INDEX_ADDED ||
    fileStatus === Status.UNTRACKED ||
    fileStatus === Status.INTENT_TO_ADD
  ) {
    // File was added in the stash — no base version exists.
    baseUri = buildEmptyUri(item, repoRoot);
    // If untracked, it's stored in ^3, otherwise it's tracked in the main stash commit
    const rightRef = fileStatus === Status.UNTRACKED ? `${stashRef}^3` : stashRef;
    stashUri = api.toGitUri(changeUri, rightRef);
  } else if (
    fileStatus === Status.INDEX_DELETED ||
    fileStatus === Status.DELETED
  ) {
    // File was deleted in the stash — right side is empty.
    baseUri = api.toGitUri(changeUri, `${stashRef}^1`);
    stashUri = buildEmptyUri(item, repoRoot);
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

/**
 * Opens a side-by-side diff for a single file in the working tree or index.
 */
export async function showWorkingDiff(item: import('./workingChangesProvider').WorkingFileItem): Promise<void> {
  const api = getAPI();
  const repo = getRepository();
  if (!api || !repo) return;

  const { change, groupType } = item;
  const fileName = path.basename(change.uri.fsPath);
  const repoRoot = repo.rootUri.fsPath;

  let leftUri: vscode.Uri;
  let rightUri: vscode.Uri;

  if (groupType === 'staged') {
    leftUri = api.toGitUri(change.uri, 'HEAD');
    rightUri = api.toGitUri(change.uri, '');
  } else {
    leftUri = api.toGitUri(change.uri, '~');
    rightUri = change.uri;
  }

  // Handle added files (no left side)
  if (change.status === Status.INDEX_ADDED || change.status === Status.UNTRACKED || change.status === Status.INTENT_TO_ADD) {
    leftUri = buildEmptyUri({ absolutePath: change.uri.fsPath, stashRef: 'empty' } as any, repoRoot);
  }

  // Handle deleted files (no right side)
  if (change.status === Status.INDEX_DELETED || change.status === Status.DELETED) {
    rightUri = buildEmptyUri({ absolutePath: change.uri.fsPath, stashRef: 'empty' } as any, repoRoot);
  }

  const title = `${fileName} (${groupType === 'staged' ? 'Index' : 'Working Tree'})`;

  await vscode.commands.executeCommand(
    'vscode.diff',
    leftUri,
    rightUri,
    title,
    { preview: true } satisfies vscode.TextDocumentShowOptions
  );
}


