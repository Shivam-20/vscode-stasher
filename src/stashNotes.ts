import * as vscode from 'vscode';

// ─── Storage keys ─────────────────────────────────────────────────────────────

const NOTES_KEY        = 'stasher.notes';       // Record<hash, string>
const PINS_KEY         = 'stasher.pins';         // string[]
const AUTO_RESTORE_KEY = 'stasher.autoRestore';  // string[]
const LABELS_KEY       = 'stasher.labels';       // Record<hash, StashLabel>

// ─── Label types ──────────────────────────────────────────────────────────────

export type StashLabel = 'red' | 'yellow' | 'green' | 'blue' | 'purple';

export const LABEL_EMOJI: Record<StashLabel, string> = {
  red:    '🔴',
  yellow: '🟡',
  green:  '🟢',
  blue:   '🔵',
  purple: '🟣',
};

export const LABEL_OPTIONS: vscode.QuickPickItem[] = (
  Object.entries(LABEL_EMOJI) as [StashLabel, string][]
).map(([k, e]) => ({ label: `${e} ${k}`, description: k }));

export function getStashLabel(
  context: vscode.ExtensionContext,
  hash: string
): StashLabel | undefined {
  return context.workspaceState.get<Record<string, StashLabel>>(LABELS_KEY, {})[hash];
}

export async function setStashLabel(
  context: vscode.ExtensionContext,
  hash: string,
  label: StashLabel | undefined
): Promise<void> {
  const map = { ...context.workspaceState.get<Record<string, StashLabel>>(LABELS_KEY, {}) };
  if (label) {
    map[hash] = label;
  } else {
    delete map[hash];
  }
  await context.workspaceState.update(LABELS_KEY, map);
}


// ─── Stash Notes ──────────────────────────────────────────────────────────────

/**
 * Returns the note attached to a stash identified by its commit hash.
 * Returns undefined if no note exists.
 */
export function getStashNote(
  context: vscode.ExtensionContext,
  hash: string
): string | undefined {
  const notes = context.workspaceState.get<Record<string, string>>(NOTES_KEY, {});
  return notes[hash];
}

/**
 * Sets (or clears, if note is empty/undefined) the note for a stash.
 */
export async function setStashNote(
  context: vscode.ExtensionContext,
  hash: string,
  note: string | undefined
): Promise<void> {
  const notes = { ...context.workspaceState.get<Record<string, string>>(NOTES_KEY, {}) };
  if (note?.trim()) {
    notes[hash] = note.trim();
  } else {
    delete notes[hash];
  }
  await context.workspaceState.update(NOTES_KEY, notes);
}

// ─── Stash Pins ───────────────────────────────────────────────────────────────

export function getPinnedHashes(context: vscode.ExtensionContext): Set<string> {
  return new Set(context.workspaceState.get<string[]>(PINS_KEY, []));
}

export function isStashPinned(context: vscode.ExtensionContext, hash: string): boolean {
  return getPinnedHashes(context).has(hash);
}

export async function pinStash(
  context: vscode.ExtensionContext,
  hash: string
): Promise<void> {
  const pins = getPinnedHashes(context);
  pins.add(hash);
  await context.workspaceState.update(PINS_KEY, [...pins]);
}

export async function unpinStash(
  context: vscode.ExtensionContext,
  hash: string
): Promise<void> {
  const pins = getPinnedHashes(context);
  pins.delete(hash);
  await context.workspaceState.update(PINS_KEY, [...pins]);
}

// ─── Auto-restore ─────────────────────────────────────────────────────────────

export function getAutoRestoreHashes(context: vscode.ExtensionContext): Set<string> {
  return new Set(context.workspaceState.get<string[]>(AUTO_RESTORE_KEY, []));
}

export function isAutoRestore(context: vscode.ExtensionContext, hash: string): boolean {
  return getAutoRestoreHashes(context).has(hash);
}

export async function setAutoRestore(
  context: vscode.ExtensionContext,
  hash: string,
  enabled: boolean
): Promise<void> {
  const set = getAutoRestoreHashes(context);
  if (enabled) {
    set.add(hash);
  } else {
    set.delete(hash);
  }
  await context.workspaceState.update(AUTO_RESTORE_KEY, [...set]);
}
