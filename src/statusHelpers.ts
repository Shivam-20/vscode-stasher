import * as vscode from 'vscode';
import { Status } from './gitEnums';

/** Returns the single-letter badge label for a git change status. */
export function statusLabel(status: Status): string {
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

/** Returns a themed icon for a git change status. */
export function statusThemeIcon(status: Status): vscode.ThemeIcon {
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
