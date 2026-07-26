# Stasher New Feature Plan (Refined)

## Goals
- Add genuinely missing stash management capabilities (not duplicates of existing features).
- Improve workflow integration and automation.

## Current Feature Inventory (Avoid Duplication)
Already implemented in `src/extension.ts` + `gitHelper.ts`:
- Search: `stasher.searchInStashes` (content + filename across stashes)
- Filter: `stasher.filterStashes` / `stasher.clearFilter` (message/branch/ref)
- Branch from stash: `stasher.createBranch` (creates branch, applies, drops stash)
- Duplicate stash: `stasher.duplicateStash`
- Import/Export patches: `stasher.importPatch` / `stasher.exportPatch` (`exportPatch` already accepts `selectedItems` for multi-export, but stash list has no `canSelectMany`)
- Per-file stats: `stasher.showStashStats`
- File diff (stash vs HEAD): `stasher.showFileDiff`
- Hunk apply: `stasher.applyHunks`
- Compare stashes: `stasher.compareStash`
- Diff vs working tree: `stasher.diffVsWorkingTree`
- Stash & switch branch: `stasher.stashAndSwitch`
- Labels (5 colors), pins, notes, startup auto-restore (`stasher.toggleAutoRestore`)
- File counts in tree: `stasher.showFileCountsInTree` (default true) via `_loadFileCountsInBackground`
- Manual stale review: `stasher.reviewStaleStashes` (delete / export / pin — no archive yet)
- Merge stashes: `stasher.mergeStashes` (pop + apply + re-stash — do **not** copy for rebase)

## Selected NEW Features

### 1. Stash TTL / Auto-Cleanup
**Problem:** Stale stashes accumulate; `staleThresholdDays` config exists but no auto-enforcement (only manual `reviewStaleStashes`).
**Solution:** Auto-archive stashes older than threshold on activation + after stash list changes.
- **Decision resolved:** Auto-archive (not auto-drop). Safer, reversible via archive filter toggle.
- New config: `stasher.autoCleanupStale` (boolean)
- Command: `stasher.cleanupStaleStashes` (manual trigger)
- **Timing resolved:** Run once on activation, then on `onDidChangeStashes`. No background timer.
- **Notification:** Only show "X stale stashes archived" when `X > 0` and the archived set actually changed (avoid spam on every refresh).
- Pinned stashes are excluded from auto-archive.
- **Coexistence:** Keep `reviewStaleStashes`; add "Archive selected" as an action alongside delete/export/pin once #2 lands.
- **Depends on:** Archive feature (#2) for archive/unarchive functions.

### 2. Stash Archive / Hide
**Problem:** Some stashes are "done" but worth keeping; they clutter the list.
**Solution:** Toggle archive flag per stash; archived stashes hidden by default.
- Commands: `stasher.archiveStash`, `stasher.unarchiveStash`, `stasher.toggleArchiveFilter`
- Storage: `workspaceState` key `stasher.archivedHashes`
- **contextValue matrix (4 tiers — preserve existing pin values):**
  - `'stashEntry'` — not archived, not pinned
  - `'stashEntryPinned'` — not archived, pinned (already exists)
  - `'stashEntryArchived'` — archived, not pinned
  - `'stashEntryArchivedPinned'` — archived + pinned
- Each tier needs matching `view/item/context` menu entries in `package.json` (expect noticeable menu duplication).

### 3. Multi-Select Stash Actions
**Problem:** Can only act on one stash at a time (stash list has no `canSelectMany`; Working Changes already has checkboxes).
**Solution:** Tree view checkboxes on `StashTreeItem` + bulk apply/drop/duplicate/export.
- Adopt `manageCheckboxStateManually: false` on the stash list tree view (**same as Working Changes**, not `true`)
- Set `checkboxState` on `StashTreeItem` in provider `getTreeItem` / refresh path; persist checked IDs in provider (mirror `WorkingChangesProvider`)
- Wire `onDidChangeCheckboxState` in `extension.ts` → `provider.handleCheckboxChange(...)`
- Commands: `stasher.applySelectedStashes`, `stasher.dropSelectedStashes`, `stasher.duplicateSelectedStashes`, `stasher.exportSelectedStashes`
- Checked stashes via `getCheckedStashes()` on provider
- Reuse existing single-stash logic (`applyStash`, `dropStash`, `duplicateStash`, `exportStashAsPatch`) in loops with `withConflictHandling`
- **Note:** `exportPatch` already has multi-`selectedItems` handling — bulk export can reuse that path; checkboxes are the selection UX (chosen over enabling `canSelectMany`)
- **Decision resolved:** Tree checkboxes (consistent with Working Changes panel)

### 4. Stash Sort Options
**Problem:** Fixed sort (newest first, pinned first).
**Solution:** Configurable sort: date, branch, message, file count, label.
- Config: `stasher.sortBy` (enum), `stasher.sortOrder` (asc/desc)
- Apply in `StashProvider._getVisibleStashes()` (or immediately after, before `_buildStashItems`)
- Pinned-first remains a secondary stable key unless sort explicitly overrides

### 5. Stash Rebase onto HEAD
**Problem:** Stash created on old base may conflict when applied to current HEAD.
**Solution:** Apply stash → re-stash → drop old (updates base to current HEAD).
- Command: `stasher.rebaseStash`
- Flow: require clean working tree → `applyStash(index)` → `createStash(...)` → drop old stash by hash/ref (not by stale index)
- **Do not copy `mergeStashes`:** that uses `popStash` + apply; rebase must keep the original until re-stash succeeds, then drop
- Conflict handling via `withConflictHandling`
- Abort with a clear error if working tree / index is dirty before starting
- **Decision resolved:** Apply + Re-stash approach (simple, follows existing apply/create patterns)

### 6. Stash Restore on Branch Checkout
**Problem:** When switching to a branch that has an associated stash, no auto-prompt.
**Solution:** Detect branch switches via `repo.state.onDidChange` — track previous HEAD name in a closure variable, compare on each event. If target branch matches a stash's `branch` field, show notification "Apply stash X?"
- Config: `stasher.autoRestoreOnCheckout` (boolean)
- Commands: `stasher.enableAutoRestoreOnCheckout` / `stasher.disableAutoRestoreOnCheckout`
- **Note:** Distinct from existing `stasher.toggleAutoRestore` (which restores stashes on VS Code startup)
- **Detection mechanism:** `let prevBranch: string | undefined; repo.state.onDidChange(() => { const cur = repo.state.HEAD?.name; if (cur !== prevBranch) { prevBranch = cur; checkStashesForBranch(cur); } })`
- Skip when `cur` is `undefined` (detached HEAD)
- Debounce / guard so one branch switch does not fire multiple prompts

### 7. Inline Diff Summary in Tree
**Problem:** Line change totals (`+N/-M`) are only available via `showStashStats`; file counts already appear in the tree.
**Solution:** Optionally append aggregated `+N/-M` to the stash row description (alongside existing file counts).
- Config: `stasher.showDiffStatInTree` (boolean)
- **Do not reinvent file counts** — keep `showFileCountsInTree` / `_loadFileCountsInBackground` as-is
- **Loading strategy:** Lazy load via background debounce (parallel to file-count loading)
- Compute with existing `getStashStats`, aggregate added/removed; **extend `StashCache`** with a stats map (it currently only caches file counts/paths/children)
- Sort by file count uses existing count cache; sort by label uses `stashNotes` (sync). Diff-stat is display-only unless a future sort key needs it

### 8. Stash Conflict Preview Enhancement
**Problem:** Current conflict preview only shows overlapping filenames (`getOverlappingFiles`).
**Solution:** Show actual diff hunks that will conflict before apply/pop.
- **Tool resolved:** `git merge-tree` (three-way merge conflict detection vs HEAD)
- Extend `conflictPreview.ts` to run `git merge-tree` per overlapping file (or once for the stash tree)
- Show summary output inline in QuickPick detail for `stasher.popStash` / `stasher.applyStash`
- Fall back to simple file-name-only preview if merge-tree execution fails

## Design Decisions
- All new commands registered in `extension.ts` with proper `view/item/context` menu entries
- New `contextValue` strings must match `package.json` `when` clauses exactly
- No background timers: cleanup runs on activation + `onDidChangeStashes` (notify only when archives change)
- Archive state stored in `workspaceState` (like pins/notes/labels) — **not** in `gitHelper`
- Multi-select uses VS Code tree checkbox API with `manageCheckboxStateManually: false` (match Working Changes)
- **Archived contextValue strategy:** Four tiers (see #2). Duplicate menu entries per tier rather than complex multi-condition `when` clauses

## Files to Modify
- `src/extension.ts` — Register new commands, checkbox listener, TTL hook, checkout listener, review-stale archive action
- `src/gitHelper.ts` — Add `rebaseStash` only (clean-tree check + apply + create + drop-by-hash)
- `src/stashProvider.ts` — Archive filter, sort config, checkbox handling, `+N/-M` in description
- `src/stashNotes.ts` — `getArchivedHashes`, `archiveStash`, `unarchiveStash`, `isStashArchived`
- `src/stashAge.ts` — Optional helper that selects stale unpinned unarchived entries (no workspaceState I/O)
- `src/stashCache.ts` — Add diff-stat cache (`getDiffStat` / `setDiffStat` / prune)
- `src/conflictPreview.ts` / `conflictHelper.ts` — Enhance conflict diff preview
- `package.json` — Commands, menus (4 contextValue tiers), configuration properties

## Open Questions
1. **Auto-cleanup behavior**: When `stasher.autoCleanupStale` is enabled, should it prompt before archiving? **Decision:** No prompt (user opted in). Notify only when `X > 0` archives were newly applied.
2. **Archive visibility**: Archived stashes hidden by default, shown via `stasher.toggleArchiveFilter`. No separate section — matches existing filter pattern. **Decision:** Hide archived unless filter is active.
3. **Branch group 'Check All' for multi-select**: When grouped by branch, clicking a `StashBranchGroupItem` should NOT auto-check all child stashes. Too complex for initial implementation; users check individual rows.
4. **Sort by async data**: Sort by file count uses cached counts; missing counts sort to bottom, then re-sort when counts arrive. Labels are sync from `workspaceState`. Acceptable for v1.

## Validation
- Unit tests: `rebaseStash` helpers, `stashNotes` archive functions, stale-selection helper, `StashCache` diff-stat
- Integration: Manual test each command via F5 Extension Development Host
- Checks: `npm run typecheck`, `npm test` (no lint script in this package)

## Risk / Failure Modes
- **`git merge-tree` fails**: Fall back to existing file-name-only conflict preview. Graceful degradation.
- **Rapid `state.onDidChange` events**: Branch checkout listener must debounce / guard; skip detached HEAD (`HEAD?.name` undefined).
- **workspaceState corruption (archive hashes)**: Loss of archive flags only. No stashes are lost — they reappear in the main list. Acceptable.
- **Simultaneous archive + pin**: Pinned stashes excluded from auto-archive. Pin overrides auto-archive.
- **Race condition in multi-select loop**: Index shifts after apply/drop. Operate by hash and re-fetch the list between mutations.
- **Dirty working tree on rebase**: Abort before apply; do not leave a half-applied stash.
- **package.json menu churn**: Four contextValue tiers multiply context-menu entries; keep pin/archive actions correct per tier.

## Next Steps (Implementation Order)
1. Add archive flag + commands (foundational, used by cleanup); extend `reviewStaleStashes` with Archive
2. Stash TTL auto-cleanup (uses archive functions, no direct drop; notify only on change)
3. Multi-select tree view + bulk actions (apply/drop/duplicate/export)
4. Sort configuration
5. Inline `+N/-M` diff stat (extend `StashCache`; leave file counts alone)
6. Rebase stash (clean tree → apply → create → drop old)
7. Auto-restore on checkout (debounce, skip detached HEAD)
8. Conflict preview enhancement
