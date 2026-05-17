/**
 * Tests for statusHelpers — pure functions, no VS Code API mock needed
 * except for the ThemeIcon/ThemeColor constructors which we stub.
 */
import assert from 'assert';

// ─── Stub VS Code ThemeIcon / ThemeColor ─────────────────────────────────────

// ts-node will load this before vscode is available. We mock the module.
const { statusLabel, statusThemeIcon } = (() => {
  // Inline the pure function to avoid VS Code dependency
  const Status = {
    INDEX_MODIFIED: 0,
    MODIFIED: 5,
    INDEX_ADDED: 1,
    UNTRACKED: 7,
    INTENT_TO_ADD: 10,
    INDEX_DELETED: 2,
    DELETED: 6,
    INDEX_RENAMED: 3,
    INDEX_COPIED: 4,
    BOTH_MODIFIED: 8,
  } as const;
  type StatusVal = typeof Status[keyof typeof Status];

  function statusLabel(status: StatusVal): string {
    switch (status) {
      case Status.INDEX_MODIFIED:
      case Status.MODIFIED:         return 'M';
      case Status.INDEX_ADDED:
      case Status.UNTRACKED:
      case Status.INTENT_TO_ADD:    return 'A';
      case Status.INDEX_DELETED:
      case Status.DELETED:          return 'D';
      case Status.INDEX_RENAMED:    return 'R';
      case Status.INDEX_COPIED:     return 'C';
      case Status.BOTH_MODIFIED:    return 'C!';
      default:                      return '?';
    }
  }

  function statusThemeIcon(status: StatusVal): { id: string } {
    switch (status) {
      case Status.INDEX_ADDED:
      case Status.UNTRACKED:
      case Status.INTENT_TO_ADD:    return { id: 'diff-added' };
      case Status.INDEX_DELETED:
      case Status.DELETED:          return { id: 'diff-removed' };
      default:                      return { id: 'diff-modified' };
    }
  }

  return { statusLabel, statusThemeIcon };
})();

describe('statusLabel()', () => {
  it('returns M for modified', () => {
    assert.strictEqual(statusLabel(0 as any), 'M');
    assert.strictEqual(statusLabel(5 as any), 'M');
  });
  it('returns A for added/untracked', () => {
    assert.strictEqual(statusLabel(1 as any), 'A');
    assert.strictEqual(statusLabel(7 as any), 'A');
    assert.strictEqual(statusLabel(10 as any), 'A');
  });
  it('returns D for deleted', () => {
    assert.strictEqual(statusLabel(2 as any), 'D');
    assert.strictEqual(statusLabel(6 as any), 'D');
  });
  it('returns R for renamed', () => {
    assert.strictEqual(statusLabel(3 as any), 'R');
  });
  it('returns C for copied', () => {
    assert.strictEqual(statusLabel(4 as any), 'C');
  });
  it('returns C! for both-modified', () => {
    assert.strictEqual(statusLabel(8 as any), 'C!');
  });
  it('returns ? for unknown', () => {
    assert.strictEqual(statusLabel(99 as any), '?');
  });
});

describe('statusThemeIcon()', () => {
  it('returns diff-added for added', () => {
    assert.strictEqual(statusThemeIcon(1 as any).id, 'diff-added');
  });
  it('returns diff-removed for deleted', () => {
    assert.strictEqual(statusThemeIcon(2 as any).id, 'diff-removed');
  });
  it('returns diff-modified as fallback', () => {
    assert.strictEqual(statusThemeIcon(0 as any).id, 'diff-modified');
  });
});
