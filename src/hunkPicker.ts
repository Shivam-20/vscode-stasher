/**
 * Hunk-level picker for a stash file.
 *
 * Opens a VS Code diff editor with:
 *   LEFT  = stash version of the file (temporary file on disk, read-only)
 *   RIGHT = current working-tree version of the file (real URI, editable)
 *
 * The user can click the inline "Accept" / "→" arrows in the diff gutter to
 * copy individual hunks from the stash version into their working file.
 *
 * The temporary file is cleaned up when it's no longer open in any editor.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { getStashFileContent } from './gitHelper';
import type { StashFileTreeItem } from './stashProvider';

/** Tracks temp file paths so we can clean them up. */
const _tempFiles = new Set<string>();

function _cleanupTemp(fsPath: string): void {
  if (_tempFiles.has(fsPath)) {
    try {
      fs.unlinkSync(fsPath);
    } catch {
      // Already deleted or locked — ignore
    }
    _tempFiles.delete(fsPath);
  }
}

export function openHunkPicker(
  item: StashFileTreeItem,
  repoRoot: string
): void {
  // Compute path relative to repo root (forward slashes for git)
  const relPath = path
    .relative(repoRoot, item.absolutePath)
    .replace(/\\/g, '/');

  // Read the stash version of the file
  let stashContent: string;
  try {
    stashContent = getStashFileContent(item.stashRef, relPath);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Stasher: Could not read stash file — ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return;
  }

  // Write to a uniquely-named temp file (random suffix prevents collisions
  // when the same stash+file is opened in the hunk picker more than once).
  const basename = path.basename(item.absolutePath);
  const safeRef = item.stashRef.replace(/[^a-z0-9]/gi, '_');
  const uid = Math.random().toString(16).slice(2, 8);
  const tempPath = path.join(
    os.tmpdir(),
    `stasher_${safeRef}_${uid}_${basename}`
  );

  try {
    fs.writeFileSync(tempPath, stashContent, { encoding: 'utf8' });
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Stasher: Could not write temp file — ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return;
  }

  _tempFiles.add(tempPath);

  const tempUri = vscode.Uri.file(tempPath);
  const workingUri = vscode.Uri.file(item.absolutePath);
  const title = `Stash ↔ Working: ${basename} (${item.stashRef})`;

  // Open diff: left = stash (temp), right = current file (editable)
  void vscode.commands.executeCommand(
    'vscode.diff',
    tempUri,
    workingUri,
    title,
    { preview: true }
  );

  // Clean up temp file when it's closed in the editor
  const disposable = vscode.workspace.onDidCloseTextDocument((doc) => {
    if (doc.uri.fsPath === tempPath) {
      _cleanupTemp(tempPath);
      disposable.dispose();
    }
  });
}

/** Call on extension deactivation to clean up any lingering temp files. */
export function disposeHunkPicker(): void {
  for (const f of _tempFiles) {
    _cleanupTemp(f);
  }
}
