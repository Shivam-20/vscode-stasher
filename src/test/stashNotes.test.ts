/**
 * Tests for stashNotes — uses a mock ExtensionContext backed by a plain Map.
 */
import assert from 'assert';
import type * as vscode from 'vscode';
import {
  getStashNote, setStashNote,
  isStashPinned, pinStash, unpinStash,
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
