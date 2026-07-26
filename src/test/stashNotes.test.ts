/**
 * Tests for stashNotes — uses a mock ExtensionContext backed by a plain Map.
 */
import assert from 'assert';
import type * as vscode from 'vscode';
import {
  getStashNote, setStashNote,
  isStashPinned, pinStash, unpinStash,
  isStashArchived, archiveStash, unarchiveStash, getArchivedHashes,
  isAutoRestore, setAutoRestore, getAutoRestoreHashes,
} from '../stashNotes';

// ─── Minimal mock ExtensionContext ────────────────────────────────────────────

function mockContext(): vscode.ExtensionContext {
  const store = new Map<string, unknown>();
  return {
    workspaceState: {
      get<T>(key: string, defaultVal?: T): T {
        return (store.has(key) ? store.get(key) : defaultVal) as T;
      },
      async update(key: string, value: unknown): Promise<void> {
        store.set(key, value);
      },
      keys(): readonly string[] { return [...store.keys()]; },
    },
  } as unknown as vscode.ExtensionContext;
}

// ─── Note tests ───────────────────────────────────────────────────────────────

describe('stashNotes — notes', () => {
  it('returns undefined for unknown hash', () => {
    const ctx = mockContext();
    assert.strictEqual(getStashNote(ctx, 'abc123'), undefined);
  });

  it('sets and retrieves a note', async () => {
    const ctx = mockContext();
    await setStashNote(ctx, 'abc123', 'blocked by JIRA-42');
    assert.strictEqual(getStashNote(ctx, 'abc123'), 'blocked by JIRA-42');
  });

  it('clears a note when empty string is provided', async () => {
    const ctx = mockContext();
    await setStashNote(ctx, 'abc123', 'some note');
    await setStashNote(ctx, 'abc123', '');
    assert.strictEqual(getStashNote(ctx, 'abc123'), undefined);
  });

  it('clears a note when undefined is provided', async () => {
    const ctx = mockContext();
    await setStashNote(ctx, 'abc123', 'note');
    await setStashNote(ctx, 'abc123', undefined);
    assert.strictEqual(getStashNote(ctx, 'abc123'), undefined);
  });

  it('isolates notes per hash', async () => {
    const ctx = mockContext();
    await setStashNote(ctx, 'aaa', 'note A');
    await setStashNote(ctx, 'bbb', 'note B');
    assert.strictEqual(getStashNote(ctx, 'aaa'), 'note A');
    assert.strictEqual(getStashNote(ctx, 'bbb'), 'note B');
  });
});

// ─── Pin tests ────────────────────────────────────────────────────────────────

describe('stashNotes — pins', () => {
  it('unpinned by default', () => {
    const ctx = mockContext();
    assert.strictEqual(isStashPinned(ctx, 'xyz'), false);
  });

  it('pin adds hash', async () => {
    const ctx = mockContext();
    await pinStash(ctx, 'abc');
    assert.strictEqual(isStashPinned(ctx, 'abc'), true);
  });

  it('unpin removes hash', async () => {
    const ctx = mockContext();
    await pinStash(ctx, 'abc');
    await unpinStash(ctx, 'abc');
    assert.strictEqual(isStashPinned(ctx, 'abc'), false);
  });

  it('pinning multiple hashes independently', async () => {
    const ctx = mockContext();
    await pinStash(ctx, 'a1');
    await pinStash(ctx, 'b2');
    assert.strictEqual(isStashPinned(ctx, 'a1'), true);
    assert.strictEqual(isStashPinned(ctx, 'b2'), true);
    await unpinStash(ctx, 'a1');
    assert.strictEqual(isStashPinned(ctx, 'a1'), false);
    assert.strictEqual(isStashPinned(ctx, 'b2'), true);
  });
});

// ─── Auto-restore tests ───────────────────────────────────────────────────────

describe('stashNotes — autoRestore', () => {
  it('not set by default', () => {
    const ctx = mockContext();
    assert.strictEqual(isAutoRestore(ctx, 'h1'), false);
  });

  it('enable auto-restore', async () => {
    const ctx = mockContext();
    await setAutoRestore(ctx, 'h1', true);
    assert.strictEqual(isAutoRestore(ctx, 'h1'), true);
    const all = getAutoRestoreHashes(ctx);
    assert.ok(all.has('h1'));
  });

  it('disable auto-restore', async () => {
    const ctx = mockContext();
    await setAutoRestore(ctx, 'h1', true);
    await setAutoRestore(ctx, 'h1', false);
    assert.strictEqual(isAutoRestore(ctx, 'h1'), false);
  });
});

// ─── Archive tests ────────────────────────────────────────────────────────────

describe('stashNotes — archive', () => {
  it('not archived by default', () => {
    const ctx = mockContext();
    assert.strictEqual(isStashArchived(ctx, 'hash1'), false);
  });

  it('archive adds hash and returns true for newly archived', async () => {
    const ctx = mockContext();
    const changed = await archiveStash(ctx, 'hash1');
    assert.strictEqual(changed, true);
    assert.strictEqual(isStashArchived(ctx, 'hash1'), true);
  });

  it('archive returns false if already archived', async () => {
    const ctx = mockContext();
    await archiveStash(ctx, 'hash1');
    const changed = await archiveStash(ctx, 'hash1');
    assert.strictEqual(changed, false);
  });

  it('unarchive removes hash', async () => {
    const ctx = mockContext();
    await archiveStash(ctx, 'hash1');
    await unarchiveStash(ctx, 'hash1');
    assert.strictEqual(isStashArchived(ctx, 'hash1'), false);
  });

  it('archiving multiple hashes independently', async () => {
    const ctx = mockContext();
    await archiveStash(ctx, 'a1');
    await archiveStash(ctx, 'b2');
    assert.strictEqual(isStashArchived(ctx, 'a1'), true);
    assert.strictEqual(isStashArchived(ctx, 'b2'), true);
    await unarchiveStash(ctx, 'a1');
    assert.strictEqual(isStashArchived(ctx, 'a1'), false);
    assert.strictEqual(isStashArchived(ctx, 'b2'), true);
  });

  it('getArchivedHashes returns all archived hashes', async () => {
    const ctx = mockContext();
    await archiveStash(ctx, 'x');
    await archiveStash(ctx, 'y');
    const archived = getArchivedHashes(ctx);
    assert.strictEqual(archived.size, 2);
    assert.ok(archived.has('x'));
    assert.ok(archived.has('y'));
  });
});
