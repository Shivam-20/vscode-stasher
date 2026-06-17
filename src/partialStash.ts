import * as vscode from 'vscode';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { Status } from './gitEnums';
import { getAPI, getRepository } from './gitHelper';

interface PickableFile {
  label: string;
  description: string;
  fsPath: string;
}

function changeStatusLabel(status: Status): string {
  switch (status) {
    case Status.INDEX_MODIFIED:
    case Status.MODIFIED:
      return 'Modified';
    case Status.INDEX_ADDED:
    case Status.UNTRACKED:
    case Status.INTENT_TO_ADD:
      return 'Added / Untracked';
    case Status.INDEX_DELETED:
    case Status.DELETED:
      return 'Deleted';
    default:
      return 'Changed';
  }
}

/**
 * Presents a multi-file picker of all currently dirty files,
 * then stashes only the selected files using `git stash push -- <paths>`.
 *
 * @param preSelectedPaths - If provided, these paths start pre-checked in the picker.
 */
export async function partialStashCommand(preSelectedPaths?: string[]): Promise<void> {
  const api = getAPI();
  const repo = getRepository();

  if (!api || !repo) {
    void vscode.window.showErrorMessage(
      'Stasher: No git repository found. Open a folder that contains a git repo.'
    );
    return;
  }

  const repoRoot = repo.rootUri.fsPath;

  // Combine working tree and index changes, deduplicate by path
  const allChanges = [
    ...repo.state.workingTreeChanges,
    ...repo.state.indexChanges,
  ];

  const seen = new Set<string>();
  const pickableFiles: PickableFile[] = [];

  for (const change of allChanges) {
    const fsPath = change.uri.fsPath;
    if (seen.has(fsPath)) {
      continue;
    }
    seen.add(fsPath);
    pickableFiles.push({
      label: path.relative(repoRoot, fsPath),
      description: changeStatusLabel(change.status),
      fsPath,
    });
  }

  if (pickableFiles.length === 0) {
    void vscode.window.showInformationMessage(
      'Stasher: No changed files to stash.'
    );
    return;
  }

  // Step 1: File picker
  const preSelectedSet = new Set(preSelectedPaths ?? []);
  const selected = await vscode.window.showQuickPick(
    pickableFiles.map((f) => ({
      ...f,
      picked: preSelectedSet.size > 0 ? preSelectedSet.has(f.fsPath) : false,
    })),
    {
      canPickMany: true,
      title: 'Partial Stash — Select files to stash',
      placeHolder: 'Pick one or more files, then press Enter',
    }
  );

  if (!selected || selected.length === 0) {
    return; // cancelled
  }

  // Step 2: Optional stash message
  const message = await vscode.window.showInputBox({
    title: 'Partial Stash — Name (optional)',
    placeHolder: 'e.g. "WIP: auth refactor" — leave empty for default',
    prompt: 'Enter a name for this partial stash',
  });

  if (message === undefined) {
    return; // cancelled
  }

  // Step 3: Run git stash push -- <selected paths>
  const args: string[] = ['stash', 'push', '--include-untracked'];
  if (message.trim()) {
    args.push('-m', message.trim());
  }
  args.push('--'); // separator before paths
  for (const f of selected) {
    args.push(f.fsPath);
  }

  const result = spawnSync(api.git.path, args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    const errMsg = result.stderr?.trim() || 'Unknown error';
    void vscode.window.showErrorMessage(
      `Stasher: Partial stash failed — ${errMsg}`
    );
    return;
  }

  void vscode.window.showInformationMessage(
    `Stasher: Stashed ${selected.length} file${selected.length === 1 ? '' : 's'}.`
  );
}
