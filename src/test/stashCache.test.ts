import assert from 'assert';
import { StashCache } from '../stashCache';

describe('StashCache', () => {
  const entry = {
    index: 0,
    ref: 'stash@{0}',
    hash: 'abc123',
    branch: 'main',
    message: 'wip',
    date: '2024-01-01',
  };

  it('stores and retrieves children by ref and groupByDir flag', () => {
    const cache = new StashCache();
    cache.setChildren('stash@{0}', false, [{ id: 'a' }]);
    assert.deepStrictEqual(cache.getChildren('stash@{0}', false), [{ id: 'a' }]);
    assert.strictEqual(cache.getChildren('stash@{0}', true), undefined);
  });

  it('stores file counts and paths per entry', () => {
    const cache = new StashCache();
    cache.setFilePathsForEntry(entry, ['a.ts', 'b.ts']);
    assert.strictEqual(cache.getFileCount('abc123'), 2);
    assert.deepStrictEqual(cache.getFilePathsForEntry(entry), ['a.ts', 'b.ts']);
  });

  it('clear removes all cached data', () => {
    const cache = new StashCache();
    cache.setChildren('stash@{0}', false, []);
    cache.setFilePathsForEntry(entry, ['a.ts']);
    cache.clear();
    assert.strictEqual(cache.getChildren('stash@{0}', false), undefined);
    assert.strictEqual(cache.getFileCount('abc123'), undefined);
  });

  it('clearChildren keeps file counts', () => {
    const cache = new StashCache();
    cache.setChildren('stash@{0}', false, ['child']);
    cache.setFilePathsForEntry(entry, ['a.ts', 'b.ts']);
    cache.clearChildren();
    assert.strictEqual(cache.getChildren('stash@{0}', false), undefined);
    assert.strictEqual(cache.getFileCount('abc123'), 2);
  });

  it('pruneCounts removes stale hashes only', () => {
    const cache = new StashCache();
    cache.setFilePathsForEntry(entry, ['a.ts']);
    cache.pruneCounts(new Set(['other']));
    assert.strictEqual(cache.getFileCount('abc123'), undefined);
  });

  it('stores and retrieves aggregated diff stats', () => {
    const cache = new StashCache();
    cache.setDiffStat('abc123', [
      { file: 'a.ts', added: 5, removed: 2 },
      { file: 'b.ts', added: 3, removed: 1 },
    ]);
    const stat = cache.getDiffStat('abc123');
    assert.ok(stat);
    assert.strictEqual(stat!.added, 8);
    assert.strictEqual(stat!.removed, 3);
  });

  it('pruneDiffStats removes stale hashes only', () => {
    const cache = new StashCache();
    cache.setDiffStat('abc123', [{ file: 'a.ts', added: 1, removed: 0 }]);
    cache.setDiffStat('def456', [{ file: 'b.ts', added: 2, removed: 0 }]);
    cache.pruneDiffStats(new Set(['abc123']));
    assert.ok(cache.getDiffStat('abc123'));
    assert.strictEqual(cache.getDiffStat('def456'), undefined);
  });
});
