import * as vscode from 'vscode';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { Status } from './gitEnums';
import {
  mapStashStatusChar,
  parseStashShowNameStatus,
} from './stashFileListing';
import { normalizeRepoPath } from './pathUtils';
import { parseListStashesOutput } from './stashListParser';
import type { API, GitExtension, Repository, Change } from './git';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface StashEntry {
  /** Numeric index (0 = newest) */
  index: number;
  /** e.g. "stash@{0}" */
  ref: string;
  /** Short commit hash of the stash commit */
  hash: string;
  /** Branch name at the time the stash was created */
  branch: string;
  /** Full git stash subject line, e.g. "WIP on main: add feature" */
  message: string;
  /** ISO-8601 date string when this stash was created */
  date: string;
}

export interface StashStat {
  /** Relative file path */
  file: string;
  /** Lines added in this stash */
  added: number;
  /** Lines removed in this stash */
  removed: number;
}

export interface SearchMatch {
  kind: 'content' | 'file';
  stashRef: string;
  stashMessage: string;
  file: string;
  line: number;
  text: string;
}

export interface StashFileGroup {
  tracked: Change[];
  untracked: Change[];
}

// ─── Internal state ───────────────────────────────────────────────────────────

let _api: API | undefined;
let _repo: Repository | undefined;

const _onDidChangeStashes = new vscode.EventEmitter<void>();

/** Fires whenever the stash list may have changed (debounced). */
export const onDidChangeStashes: vscode.Event<void> = _onDidChangeStashes.event;

let _debounceTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleRefresh(): void {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
  }
  _debounceTimer = setTimeout(() => {
    _onDidChangeStashes.fire();
  }, 400);
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

/**
 * Initialise the Git API and wire up change listeners.
 * Returns the API if git is enabled, undefined otherwise.
 */
export async function initGitApi(
  context: vscode.ExtensionContext
): Promise<API | undefined> {
  const gitExt = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!gitExt) {
    void vscode.window.showWarningMessage(
      'Stasher: VS Code built-in git extension not found.'
    );
    return undefined;
  }

  const gitExtension = gitExt.isActive
    ? gitExt.exports
    : await gitExt.activate();

  if (!gitExtension.enabled) {
    gitExtension.onDidChangeEnablement(
      (enabled) => {
        if (enabled) {
          _api = gitExtension.getAPI(1);
          _wireRepoListeners(context);
        }
      },
      null,
      context.subscriptions
    );
    return undefined;
  }

  _api = gitExtension.getAPI(1);
  _wireRepoListeners(context);
  return _api;
}

function _wireRepoListeners(context: vscode.ExtensionContext): void {
  if (!_api) {
    return;
  }

  // Pick up already-open repositories
  for (const repo of _api.repositories) {
    _attachRepo(repo, context);
  }

  // Watch for new repos being opened
  _api.onDidOpenRepository(
    (repo) => _attachRepo(repo, context),
    null,
    context.subscriptions
  );

  // Watch for repos being closed
  _api.onDidCloseRepository(
    (repo) => {
      if (_repo?.rootUri.fsPath === repo.rootUri.fsPath) {
        _repo = undefined;
        scheduleRefresh();
      }
    },
    null,
    context.subscriptions
  );
}

function _attachRepo(repo: Repository, context: vscode.ExtensionContext): void {
  const isFirstRepo = !_repo;
  if (isFirstRepo) {
    _repo = repo;
  }
  repo.state.onDidChange(scheduleRefresh, null, context.subscriptions);
  // Fire immediately on first repo attach so the tree populates
  // (the initial provider.refresh() may have run before any repo was available)
  if (isFirstRepo) {
    _onDidChangeStashes.fire();
  } else {
    scheduleRefresh();
  }
}

// ─── Public accessors ─────────────────────────────────────────────────────────

export function getAPI(): API | undefined {
  return _api;
}

export function getRepository(): Repository | undefined {
  return _repo;
}

// ─── Stash list ───────────────────────────────────────────────────────────────

/**
 * Returns the list of stashes for the current repository, newest first.
 * Runs `git stash list` via spawnSync because the VS Code git API
 * does not expose a listStashes() method.
 */
export function listStashes(): StashEntry[] {
  if (!_api || !_repo) {
    return [];
  }

  const result = spawnSync(
    _api.git.path,
    ['stash', 'list', '--format=%gd|%H|%gs|%ai'],
    { cwd: _repo.rootUri.fsPath, encoding: 'utf8' },
  );

  if (result.status !== 0 || !result.stdout) {
    return [];
  }

  return parseListStashesOutput(result.stdout);
}

/** Re-resolve a stash entry by commit hash after list mutations. */
export function findStashByHash(hash: string): StashEntry | undefined {
  return listStashes().find((e) => e.hash === hash);
}

// ─── Stash file listing ───────────────────────────────────────────────────────

function listStashTreePaths(
  gitPath: string,
  cwd: string,
  treeRef: string,
): Set<string> {
  const result = spawnSync(
    gitPath,
    ['ls-tree', '-r', '--name-only', treeRef],
    { cwd, encoding: 'utf8' },
  );
  if (result.status !== 0 || !result.stdout) {
    return new Set();
  }
  return new Set(
    result.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(normalizeRepoPath),
  );
}

function listStashFilesSync(stashRef: string): StashFileGroup {
  if (!_api || !_repo) {
    return { tracked: [], untracked: [] };
  }

  const gitPath = _api.git.path;
  const cwd = _repo.rootUri.fsPath;
  const result = spawnSync(
    gitPath,
    ['stash', 'show', '--name-status', '--include-untracked', stashRef],
    { cwd, encoding: 'utf8' },
  );
  if (result.status !== 0 || !result.stdout?.trim()) {
    return { tracked: [], untracked: [] };
  }

  const tracked: Change[] = [];
  const untracked: Change[] = [];
  const trackedTreePaths = listStashTreePaths(gitPath, cwd, stashRef);

  for (const entry of parseStashShowNameStatus(result.stdout)) {
    const relPath = normalizeRepoPath(entry.path);
    const oldPath = entry.oldPath ? normalizeRepoPath(entry.oldPath) : undefined;
    let status = mapStashStatusChar(entry.statusChar);

    if (entry.statusChar === 'A') {
      const inStash = trackedTreePaths.has(relPath);
      status = inStash ? Status.INDEX_ADDED : Status.UNTRACKED;
    }

    const uri = vscode.Uri.file(path.join(cwd, relPath));
    const originalUri = oldPath
      ? vscode.Uri.file(path.join(cwd, oldPath))
      : uri;
    const renameUri =
      entry.statusChar === 'R' || entry.statusChar === 'C' ? uri : undefined;
    const change: Change = { uri, originalUri, renameUri, status };

    if (status === Status.UNTRACKED) {
      untracked.push(change);
    } else {
      tracked.push(change);
    }
  }

  return { tracked, untracked };
}

/**
 * Returns the tracked and untracked file changes contained in a stash.
 */
export async function getStashFiles(stashRef: string): Promise<StashFileGroup> {
  if (!_repo) {
    return { tracked: [], untracked: [] };
  }

  const fromGit = listStashFilesSync(stashRef);
  if (fromGit.tracked.length > 0 || fromGit.untracked.length > 0) {
    return fromGit;
  }

  // Fallback when `git stash show` returns nothing (e.g. empty stash)
  let tracked: Change[] = [];
  try {
    tracked = await _repo.diffBetween(`${stashRef}^1`, stashRef);
  } catch {
    // repo too old or stash has no parent — fall back to empty
  }

  let untracked: Change[] = [];
  try {
    untracked = await _repo.diffBetween(`${stashRef}^1`, `${stashRef}^3`);
  } catch {
    // No untracked commit — normal for stashes without --include-untracked
  }

  return { tracked, untracked };
}

/**
 * Returns relative file paths in a stash via `git stash show --name-only --include-untracked`.
 */
export function getStashFilePaths(entry: StashEntry): string[] {
  if (!_api || !_repo) {
    return [];
  }
  const result = spawnSync(
    _api.git.path,
    ['stash', 'show', '--name-only', '--include-untracked', entry.ref],
    { cwd: _repo.rootUri.fsPath, encoding: 'utf8' },
  );
  if (result.status !== 0 || !result.stdout) {
    return [];
  }
  return result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(normalizeRepoPath);
}

/** Lightweight file count for a stash entry. */
export function getStashFileCount(entry: StashEntry): number {
  return getStashFilePaths(entry).length;
}

// ─── Stash operations ─────────────────────────────────────────────────────────

export async function createStash(
  message?: string,
  includeUntracked = true
): Promise<void> {
  if (!_repo) {
    throw new Error('No repository open');
  }
  await _repo.createStash({ message: message || undefined, includeUntracked });
}

/** Stash only staged (indexed) changes. */
export async function createStashStaged(message?: string): Promise<void> {
  if (!_repo) {
    throw new Error('No repository open');
  }
  await _repo.createStash({
    message: message || undefined,
    staged: true,
    includeUntracked: false,
  });
}

/** Stash working-tree changes but keep the index intact (`git stash push --keep-index`). */
export function createStashKeepIndex(message?: string): void {
  if (!_api || !_repo) {
    throw new Error('No repository open');
  }
  const args = ['stash', 'push', '--keep-index'];
  if (message) {
    args.push('-m', message);
  }
  const result = spawnSync(_api.git.path, args, {
    cwd: _repo.rootUri.fsPath,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || 'git stash push --keep-index failed');
  }
}

export async function applyStash(index: number): Promise<void> {
  if (!_repo) {
    throw new Error('No repository open');
  }
  await _repo.applyStash(index);
}

export async function popStash(index: number): Promise<void> {
  if (!_repo) {
    throw new Error('No repository open');
  }
  await _repo.popStash(index);
}

export async function dropStash(index: number): Promise<void> {
  if (!_repo) {
    throw new Error('No repository open');
  }
  await _repo.dropStash(index);
}

/**
 * Creates a new branch from a stash and checks it out.
 * Uses `git stash branch` which atomically creates the branch,
 * checks it out, and applies+drops the stash.
 */
export function stashBranch(branchName: string, stashRef: string): void {
  if (!_api || !_repo) {
    throw new Error('No repository open');
  }
  const result = spawnSync(
    _api.git.path,
    ['stash', 'branch', branchName, stashRef],
    { cwd: _repo.rootUri.fsPath, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || 'Unknown error');
  }
}

/**
 * Renames a stash by: creating a new stash entry with the new message
 * from the diff of the stash, then dropping the old one.
 * NOTE: Git has no native rename command for stashes.
 * This is implemented as: apply (keep stash) → create new stash with message → drop old.
 */
export async function renameStash(
  entry: StashEntry,
  newMessage: string
): Promise<void> {
  if (!_api || !_repo) {
    throw new Error('No repository open');
  }

  const gitPath = _api.git.path;
  const cwd = _repo.rootUri.fsPath;

  // 1. Apply the stash (keep it) to restore working tree changes
  await _repo.applyStash(entry.index);

  // 2. Re-stash with the new message
  try {
    await _repo.createStash({
      message: newMessage,
      includeUntracked: true,
    });
  } catch (err) {
    throw new Error(
      `Re-stash failed — your changes are now in the working tree. ` +
      `Stash them manually to recover. Original error: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  // 3. Drop the OLD stash. After step 2, all indices shifted by 1
  //    because the new stash is now at {0}.
  //    The old stash is now at index + 1.
  const dropResult = spawnSync(
    gitPath,
    ['stash', 'drop', `stash@{${entry.index + 1}}`],
    { cwd, encoding: 'utf8' }
  );
  if (dropResult.status !== 0) {
    // Non-fatal — stash was renamed (new one exists), old may just not be dropped
    void vscode.window.showWarningMessage(
      `Stasher: Renamed stash created, but could not drop the old one (stash@{${
        entry.index + 1
      }}). You may need to remove it manually.`
    );
  }
}

// ─── Add files to an existing stash ──────────────────────────────────────────

/**
 * "Merges" the current working changes into an existing stash entry.
 *
 * Git has no native append/merge command for stashes, so we emulate it:
 *   1. Pop the target stash (restores its changes to the working tree).
 *   2. Re-stash everything (the former stash contents + the new changes)
 *      under the same message.
 *
 * If `filePaths` is provided, only those files are included in the new stash
 * (via `git stash push -- <paths>`). Otherwise all current changes are stashed.
 *
 * Throws on git errors so callers can wrap with withConflictHandling().
 */
export async function addToExistingStash(
  targetEntry: StashEntry,
  filePaths?: string[]
): Promise<void> {
  if (!_api || !_repo) {
    throw new Error('No repository open');
  }

  const gitPath = _api.git.path;
  const cwd = _repo.rootUri.fsPath;

  // 1. Pop the target stash — this restores its changes to the working tree.
  //    If there are conflicts we let the error bubble up.
  await _repo.popStash(targetEntry.index);

  // 2. Re-stash everything with the original message.
  if (filePaths && filePaths.length > 0) {
    const result = spawnSync(
      gitPath,
      ['stash', 'push', '--include-untracked', '-m', targetEntry.message, '--', ...filePaths],
      { cwd, encoding: 'utf8' }
    );
    if (result.status !== 0) {
      throw new Error(
        `git stash push failed — your changes are now in the working tree. ` +
        `Stash them manually to recover. Details: ${result.stderr?.trim() || 'unknown error'}`
      );
    }
  } else {
    try {
      await _repo.createStash({
        message: targetEntry.message,
        includeUntracked: true,
      });
    } catch (err) {
      throw new Error(
        `Re-stash failed — your changes are now in the working tree. ` +
        `Stash them manually to recover. Original error: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
}

// ─── Quick stash (no prompt) ──────────────────────────────────────────────────

/** Creates a stash immediately with an auto-generated message, no user prompt. */
export async function quickStash(): Promise<void> {
  return createStash(undefined, true);
}

// ─── Unstash specific files (stash stays intact) ─────────────────────────────

function toRelativePath(cwd: string, absolutePath: string): string {
  const rel = absolutePath.startsWith(cwd)
    ? absolutePath.slice(cwd.length).replace(/^[\\/]/, '')
    : absolutePath;
  return normalizeRepoPath(rel);
}

function parseStatusPath(line: string): string {
  const raw = line.slice(3).trim();
  const arrow = raw.indexOf(' -> ');
  return normalizeRepoPath(arrow >= 0 ? raw.slice(arrow + 4) : raw);
}

function assertCleanWorkingTreeOutside(
  gitPath: string,
  cwd: string,
  allowedPaths: Set<string>,
): void {
  const result = spawnSync(
    gitPath,
    ['status', '--porcelain', '--untracked-files=all'],
    { cwd, encoding: 'utf8' },
  );
  if (result.status !== 0 || !result.stdout.trim()) {
    return;
  }
  const dirtyOutside = result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(parseStatusPath)
    .filter((p) => !allowedPaths.has(p));
  if (dirtyOutside.length > 0) {
    const preview = dirtyOutside.slice(0, 3).join(', ');
    const suffix = dirtyOutside.length > 3 ? ` (+${dirtyOutside.length - 3} more)` : '';
    throw new Error(
      `Working tree has unrelated changes (${preview}${suffix}). Commit or stash them first.`,
    );
  }
}

function checkoutStashFile(
  gitPath: string,
  cwd: string,
  stashRef: string,
  relPath: string,
  fileStatus?: Status,
): void {
  const refs =
    fileStatus === Status.UNTRACKED
      ? [`${stashRef}^3`, stashRef]
      : [stashRef, `${stashRef}^3`];
  let lastError = '';
  for (const ref of refs) {
    const result = spawnSync(
      gitPath,
      ['checkout', ref, '--', relPath],
      { cwd, encoding: 'utf8' },
    );
    if (result.status === 0) {
      return;
    }
    lastError = result.stderr?.trim() || `git checkout ${ref} -- ${relPath} failed`;
  }
  throw new Error(lastError || 'git checkout from stash failed');
}

/**
 * Restores specific files from a stash into the working tree WITHOUT removing
 * them from the stash. Uses `git checkout stash@{N} -- <relPath>` for each file.
 */
export function unstashFiles(
  entry: StashEntry,
  absolutePaths: string[],
  fileStatus?: Status,
): void {
  if (!_api || !_repo) {
    throw new Error('No repository open');
  }
  const gitPath = _api.git.path;
  const cwd = _repo.rootUri.fsPath;

  for (const absPath of absolutePaths) {
    checkoutStashFile(
      gitPath,
      cwd,
      entry.ref,
      toRelativePath(cwd, absPath),
      fileStatus,
    );
  }
}

/**
 * Safely copies a single file from one stash into another stash.
 * The source stash is left unchanged; callers can optionally remove it later.
 */
export async function copyFileFromStashToStash(
  sourceEntry: StashEntry,
  targetEntry: StashEntry,
  absolutePath: string,
  fileStatus?: Status,
): Promise<void> {
  if (!_api || !_repo) {
    throw new Error('No repository open');
  }
  if (sourceEntry.ref === targetEntry.ref) {
    throw new Error('Source and target stashes must be different');
  }

  const gitPath = _api.git.path;
  const cwd = _repo.rootUri.fsPath;
  const relPath = toRelativePath(cwd, absolutePath);
  const targetPaths = getStashFilePaths(targetEntry);
  const pushPaths = [...new Set([...targetPaths, relPath])];
  const involvedPaths = new Set(pushPaths);

  assertCleanWorkingTreeOutside(gitPath, cwd, involvedPaths);

  const targetHash = targetEntry.hash;
  const freshTarget = findStashByHash(targetHash);
  if (!freshTarget) {
    throw new Error('Target stash no longer exists');
  }

  checkoutStashFile(gitPath, cwd, sourceEntry.ref, relPath, fileStatus);
  await _repo.applyStash(freshTarget.index);

  const pushResult = spawnSync(
    gitPath,
    ['stash', 'push', '--include-untracked', '-m', targetEntry.message, '--', ...pushPaths],
    { cwd, encoding: 'utf8' },
  );
  if (pushResult.status !== 0) {
    throw new Error(
      `git stash push failed — your changes are now in the working tree. ` +
      `Stash them manually to recover. Details: ${pushResult.stderr?.trim() || 'unknown error'}`,
    );
  }

  const oldTarget = findStashByHash(targetHash);
  if (oldTarget) {
    await _repo.dropStash(oldTarget.index);
  }
}

// ─── Delete files from a stash (permanently discards those file changes) ──────

/**
 * Permanently removes specific files' changes from a stash.
 * Strategy: pop the stash → restore those files to HEAD state → re-stash the rest.
 */
export async function deleteFilesFromStash(
  entry: StashEntry,
  absolutePaths: string[]
): Promise<void> {
  if (!_api || !_repo) {
    throw new Error('No repository open');
  }

  const gitPath = _api.git.path;
  const cwd = _repo.rootUri.fsPath;

  // 1. Pop the stash so all its changes are in the working tree
  await _repo.popStash(entry.index);

  // 2. Restore the target files to their HEAD state (discard their changes)
  const relPaths = absolutePaths.map((p) =>
    p.startsWith(cwd) ? p.slice(cwd.length).replace(/^[\\/]/, '') : p
  );

  const restoreResult = spawnSync(
    gitPath,
    ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...relPaths],
    { cwd, encoding: 'utf8' }
  );
  if (restoreResult.status !== 0) {
    // Fallback: try git checkout HEAD for older git versions
    const checkoutResult = spawnSync(
      gitPath,
      ['checkout', 'HEAD', '--', ...relPaths],
      { cwd, encoding: 'utf8' }
    );
    if (checkoutResult.status !== 0) {
      throw new Error(checkoutResult.stderr?.trim() || 'Failed to restore files to HEAD');
    }
  }

  const statusResult = spawnSync(
    gitPath,
    ['status', '--porcelain', '--untracked-files=all'],
    { cwd, encoding: 'utf8' }
  );
  if (statusResult.status === 0 && !statusResult.stdout.trim()) {
    return;
  }

  // 3. Re-stash remaining changes under the original message
  await _repo.createStash({ message: entry.message, includeUntracked: true });
}

// ─── Merge two stashes ────────────────────────────────────────────────────────

/**
 * Merges entry2 into entry1 by:
 *   1. Pop entry2 (restore its changes to working tree)
 *   2. Apply entry1 (keep entry1 in stash list while applying)
 *   3. Re-stash everything → new combined stash
 *   4. Drop old entry1 (now shifted by 1)
 *
 * On conflict the error bubbles up for withConflictHandling() to catch.
 */
export async function mergeStashes(
  entry1: StashEntry,
  entry2: StashEntry
): Promise<void> {
  if (!_api || !_repo) {
    throw new Error('No repository open');
  }

  const gitPath = _api.git.path;
  const cwd = _repo.rootUri.fsPath;

  // Pop entry2 first (has higher index = older, to keep index arithmetic simple)
  // Always pop the one with the higher index first to avoid shifting issues
  const [first, second] =
    entry1.index > entry2.index ? [entry1, entry2] : [entry2, entry1];

  await _repo.popStash(first.index);
  await _repo.applyStash(second.index); // apply (keep), may conflict

  // Re-stash combined changes
  const combinedMsg = `${second.message} + ${first.message}`;
  await _repo.createStash({ message: combinedMsg, includeUntracked: true });

  // Drop old second stash (now shifted +1 because new stash is at 0)
  const dropResult = spawnSync(
    gitPath,
    ['stash', 'drop', `stash@{${second.index + 1}}`],
    { cwd, encoding: 'utf8' }
  );
  if (dropResult.status !== 0) {
    void vscode.window.showWarningMessage(
      `Stasher: Merge complete but could not drop old stash@{${second.index + 1}}. Remove it manually.`
    );
  }
}

// ─── Export stash as patch ────────────────────────────────────────────────────

/**
 * Returns the full unified diff of a stash entry as a string (git stash show -p).
 */
export function exportStashAsPatch(entry: StashEntry): string {
  if (!_api || !_repo) {
    throw new Error('No repository open');
  }
  const result = spawnSync(
    _api.git.path,
    ['stash', 'show', '-p', '--include-untracked', entry.ref],
    { cwd: _repo.rootUri.fsPath, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || 'git stash show failed');
  }
  return result.stdout;
}

// ─── Get stash file content ───────────────────────────────────────────────────

/**
 * Returns the raw content of a file as it exists inside a stash commit.
 * relPath must be relative to the repo root (forward slashes).
 */
export function getStashFileContent(
  stashRef: string,
  relPath: string,
  fileStatus?: Status,
): string {
  if (!_api || !_repo) {
    throw new Error('No repository open');
  }
  const refs =
    fileStatus === Status.UNTRACKED
      ? [`${stashRef}^3`, stashRef]
      : [stashRef, `${stashRef}^3`];
  let lastError = '';
  for (const ref of refs) {
    const result = spawnSync(
      _api.git.path,
      ['show', `${ref}:${relPath}`],
      { cwd: _repo.rootUri.fsPath, encoding: 'utf8' },
    );
    if (result.status === 0) {
      return result.stdout;
    }
    lastError = result.stderr?.trim() || `git show ${ref}:${relPath} failed`;
  }
  throw new Error(lastError);
}

// ─── Create stash for a single file ──────────────────────────────────────────

/**
 * Creates a new stash containing only the specified file.
 * Equivalent to `git stash push --include-untracked [-m <message>] -- <filePath>`.
 */
export function stashFile(filePath: string, message?: string): void {
  if (!_api || !_repo) {
    throw new Error('No repository open');
  }
  const args: string[] = ['stash', 'push', '--include-untracked'];
  if (message?.trim()) {
    args.push('-m', message.trim());
  }
  args.push('--', filePath);
  const result = spawnSync(_api.git.path, args, {
    cwd: _repo.rootUri.fsPath,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || 'git stash push failed');
  }
}

// ─── Stash stats (diff --stat) ────────────────────────────────────────────────

/**
 * Returns per-file line change stats for a stash entry.
 * Uses `git diff --numstat stash@{N}^1 stash@{N}`.
 */
export function getStashStats(entry: StashEntry): StashStat[] {
  if (!_api || !_repo) {
    throw new Error('No repository open');
  }
  const result = spawnSync(
    _api.git.path,
    ['diff', '--numstat', `${entry.ref}^1`, entry.ref],
    { cwd: _repo.rootUri.fsPath, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || 'git diff --numstat failed');
  }
  return result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      return {
        added: parseInt(parts[0] ?? '0', 10) || 0,
        removed: parseInt(parts[1] ?? '0', 10) || 0,
        file: parts[2] ?? '',
      };
    });
}

// ─── Search inside stashes ────────────────────────────────────────────────────

/**
 * Searches for `query` across all stash entries using `git grep`.
 * Returns an array of matches with stash ref, file, line number, and content.
 */
export function searchInStashes(query: string): SearchMatch[] {
  if (!_api || !_repo) {
    return [];
  }
  const stashes = listStashes();
  const matches: SearchMatch[] = [];
  const needle = query.toLowerCase();

  for (const stash of stashes) {
    const result = spawnSync(
      _api.git.path,
      ['grep', '-n', '-i', '--', query, stash.ref],
      { cwd: _repo.rootUri.fsPath, encoding: 'utf8' }
    );
    // exit 1 means no matches (not an error), exit > 1 means error
    if (result.status !== null && result.status > 1) {
      continue;
    }
    if (!result.stdout) {
      continue;
    }
    for (const line of result.stdout.trim().split('\n').filter(Boolean)) {
      // format: stash@{N}:file.ts:42:matched text
      const firstColon = line.indexOf(':');
      const rest = line.slice(firstColon + 1);
      const secondColon = rest.indexOf(':');
      const thirdColon = rest.indexOf(':', secondColon + 1);
      const file = rest.substring(0, secondColon);
      const lineNum = parseInt(rest.substring(secondColon + 1, thirdColon), 10) || 0;
      const text = rest.substring(thirdColon + 1);
      matches.push({
        kind: 'content',
        stashRef: stash.ref,
        stashMessage: stash.message,
        file,
        line: lineNum,
        text,
      });
    }

    const fileListResult = spawnSync(
      _api.git.path,
      ['stash', 'show', '--name-only', '--include-untracked', '--format=', stash.ref],
      { cwd: _repo.rootUri.fsPath, encoding: 'utf8' }
    );
    if (fileListResult.status !== 0 || !fileListResult.stdout) {
      continue;
    }
    for (const file of fileListResult.stdout.trim().split('\n').filter(Boolean)) {
      if (!file.toLowerCase().includes(needle)) {
        continue;
      }
      matches.push({
        kind: 'file',
        stashRef: stash.ref,
        stashMessage: stash.message,
        file,
        line: 0,
        text: 'File name match',
      });
    }
  }
  return matches;
}

// ─── Duplicate a stash ────────────────────────────────────────────────────────

/**
 * Duplicates a stash entry: applies it (keep stash), then re-stashes,
 * resulting in two stash entries with the same changes.
 */
export async function duplicateStash(entry: StashEntry): Promise<void> {
  if (!_api || !_repo) {
    throw new Error('No repository open');
  }
  // Apply without removing from stash list
  await _repo.applyStash(entry.index);
  // Re-stash with same message — now original is at entry.index+1, copy at 0
  try {
    await _repo.createStash({ message: `${entry.message} (copy)`, includeUntracked: true });
  } catch (err) {
    throw new Error(
      `Duplicate failed — your changes are now in the working tree. ` +
      `Stash them manually to recover. Original error: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

// ─── Import patch file as stash ───────────────────────────────────────────────

/**
 * Checks if a patch file's content matches any existing stash.
 * Returns the matching StashEntry if a duplicate is found, or undefined.
 */
export function findDuplicateStashForPatch(patchContent: string): StashEntry | undefined {
  if (!_api || !_repo) {
    return undefined;
  }
  const stashes = listStashes();
  const normalised = patchContent.trim();

  for (const entry of stashes) {
    try {
      const existing = exportStashAsPatch(entry);
      if (existing.trim() === normalised) {
        return entry;
      }
    } catch {
      // skip stashes that can't be exported (e.g. empty)
    }
  }
  return undefined;
}

/**
 * Applies a .patch file to the index then immediately stashes the result.
 * Uses `git apply --index <patchPath>` followed by `git stash`.
 */
export async function importPatchAsStash(
  patchPath: string,
  message?: string
): Promise<void> {
  if (!_api || !_repo) {
    throw new Error('No repository open');
  }
  const gitPath = _api.git.path;
  const cwd = _repo.rootUri.fsPath;

  const applyResult = spawnSync(gitPath, ['apply', '--index', patchPath], {
    cwd,
    encoding: 'utf8',
  });
  if (applyResult.status !== 0) {
    throw new Error(applyResult.stderr?.trim() || 'git apply failed');
  }

  await _repo.createStash({ message: message || undefined, includeUntracked: true });
}

// ─── Stash vs working tree diff info ─────────────────────────────────────────

/**
 * Returns the list of relative file paths that differ between a stash
 * and the current working tree. Uses `git diff --name-only stash@{N}`.
 */
export function getStashDiffVsWorkingTree(entry: StashEntry): string[] {
  if (!_api || !_repo) {
    throw new Error('No repository open');
  }
  const result = spawnSync(
    _api.git.path,
    ['diff', '--name-only', entry.ref],
    { cwd: _repo.rootUri.fsPath, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || 'git diff failed');
  }
  return result.stdout.trim().split('\n').filter(Boolean);
}

// ─── Dispose ──────────────────────────────────────────────────────────────────

export function dispose(): void {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = undefined;
  }
  _onDidChangeStashes.dispose();
  _api = undefined;
  _repo = undefined;
}
