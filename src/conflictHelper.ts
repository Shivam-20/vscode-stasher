import * as vscode from 'vscode';
import { Status } from './gitEnums';
import { getRepository } from './gitHelper';

const GIT_ERROR_CODE_STASH_CONFLICT = 'StashConflict';

/**
 * Returns true if the thrown error is a git StashConflict.
 */
export function isStashConflict(err: unknown): boolean {
  if (err && typeof err === 'object' && 'gitErrorCode' in err) {
    return (err as { gitErrorCode: string }).gitErrorCode ===
      GIT_ERROR_CODE_STASH_CONFLICT;
  }
  // Fallback: inspect message text (older VS Code versions)
  if (err instanceof Error) {
    return (
      err.message.includes('conflict') ||
      err.message.includes('CONFLICT')
    );
  }
  return false;
}

/**
 * Called after a stash apply / pop that produced conflicts.
 * Counts conflicted files and presents an actionable notification.
 */
export async function handleConflicts(): Promise<void> {
  const repo = getRepository();
  if (!repo) {
    return;
  }

  // Collect files that have both-modified (merge conflict) status
  const conflicted = repo.state.workingTreeChanges.filter(
    (c) => c.status === Status.BOTH_MODIFIED || c.status === Status.BOTH_ADDED
  );

  const count = conflicted.length;
  const noun = count === 1 ? 'conflict' : 'conflicts';
  const msg =
    count > 0
      ? `Stasher: ${count} merge ${noun} detected after applying stash.`
      : 'Stasher: Stash applied with conflicts. Check the Source Control panel.';

  const choice = await vscode.window.showWarningMessage(
    msg,
    'Open Merge Editor',
    'Show Changes',
    'Dismiss'
  );

  if (choice === 'Open Merge Editor' && conflicted.length > 0) {
    // Open the first conflicted file in the 3-way merge editor
    const firstUri = conflicted[0].uri;
    await vscode.commands.executeCommand(
      'git.openMergeEditor',
      firstUri
    );
  } else if (choice === 'Show Changes') {
    // Focus the Source Control view
    await vscode.commands.executeCommand('workbench.view.scm');
  }
}

/**
 * Wraps a stash apply/pop operation and automatically handles conflicts.
 * Re-throws non-conflict errors so the caller can handle them.
 */
export async function withConflictHandling(
  operation: () => Promise<void>
): Promise<boolean> {
  try {
    await operation();
    return true;
  } catch (err) {
    if (isStashConflict(err)) {
      await handleConflicts();
      return false;
    } else {
      throw err;
    }
  }
}
