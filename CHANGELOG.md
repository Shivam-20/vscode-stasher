# Changelog

All notable changes to this project will be documented in this file.

## 0.2.1

### Fixes
- Fix move/copy file between stashes leaving other target files in the working tree
- Re-resolve stash entries by hash after copy so remove-from-original targets the correct stash
- Read untracked stash files from `stash^3` in peek, hunk picker, and checkout flows
- Normalize paths in conflict-overlap detection so Windows separators match correctly
- Parse stash list messages that contain `|` characters without corrupting the subject or date
- Fix stash list not loading on initial extension activation
- Include untracked files in patch export and duplicate detection

### Performance
- Batch `ls-tree` lookups when classifying added vs untracked stash files
- Keep file-count cache across refreshes; only invalidate expanded children and stale hashes
- Debounce background file-count loading (400 ms)
- Avoid double refresh when the first repository attaches on activation

### UX
- Sidebar polish: stash ref in descriptions, basename labels, branch sorting, view badges, filter message line, Working Changes grouping icons, and optional directory grouping

## 0.1.1

### Fixes
- List all files in stashes created with untracked content (`--include-untracked`), including file counts, tree expansion, and stash search

## 0.1.0

### Features
- **Stash Staged** and **Stash Working (keep index)** commands for finer-grained stash workflows
- **Group checkbox controls**: check all, uncheck all, and invert selection per staged/working group
- **Live stash filter** via QuickPick (updates the tree as you type)
- **Review Stale Stashes** workflow with bulk delete, export, or pin
- **Conflict preview** before apply/pop when stash files overlap local changes
- **File counts** on collapsed stash rows (lazy-loaded)
- **Note snippets** shown inline on stash rows
- **Tree expansion state** persisted across reloads

### Performance
- Cache for expanded stash file lists
- Loading spinner while stash files load asynchronously
- Debounced Working Changes refresh (400 ms)

### UX
- Reorganized settings with display/behavior sections
- Command Palette entries for high-value commands
- View badge and filter message line improvements

## 0.0.1

- Initial release of Stasher
- Added Activity Bar views for working changes and stash management
- Added stash creation, partial stash, apply, pop, rename, delete, compare, merge, export, and selective restore workflows
