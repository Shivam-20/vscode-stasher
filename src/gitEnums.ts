/**
 * Runtime Status enum values that mirror the VS Code built-in git extension.
 * These numeric values are stable across VS Code versions.
 * Kept in a separate .ts (not .d.ts) file so esbuild can bundle them.
 */
export enum Status {
  INDEX_MODIFIED = 0,
  INDEX_ADDED = 1,
  INDEX_DELETED = 2,
  INDEX_RENAMED = 3,
  INDEX_COPIED = 4,
  MODIFIED = 5,
  DELETED = 6,
  UNTRACKED = 7,
  IGNORED = 8,
  INTENT_TO_ADD = 9,
  INTENT_TO_RENAME = 10,
  ADDED_BY_US = 11,
  ADDED_BY_THEM = 12,
  DELETED_BY_US = 13,
  DELETED_BY_THEM = 14,
  BOTH_ADDED = 15,
  BOTH_DELETED = 16,
  BOTH_MODIFIED = 17,
}
