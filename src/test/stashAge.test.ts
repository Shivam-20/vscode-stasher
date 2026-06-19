/**
 * Tests for stashAge utilities (pure, no VS Code dependency).
 */
import assert from 'assert';
import { relativeTime, isStale, getStaleStashes } from '../stashAge';

function iso(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

describe('relativeTime()', () => {
  it('returns "just now" for < 60 seconds', () => {
    assert.strictEqual(relativeTime(iso(10_000)), 'just now');
  });

  it('returns minutes for < 1 hour', () => {
    const result = relativeTime(iso(90_000)); // 1.5 min
    assert.match(result, /^\dm ago$/);
  });

  it('returns hours for < 1 day', () => {
    const result = relativeTime(iso(3 * 60 * 60 * 1000)); // 3h
    assert.strictEqual(result, '3h ago');
  });

  it('returns days for < 1 week', () => {
    const result = relativeTime(iso(3 * 24 * 60 * 60 * 1000)); // 3d
    assert.strictEqual(result, '3d ago');
  });

  it('returns weeks for < 1 month', () => {
    const result = relativeTime(iso(14 * 24 * 60 * 60 * 1000)); // 14d = 2w
    assert.strictEqual(result, '2w ago');
  });

  it('returns months for < 1 year', () => {
    const result = relativeTime(iso(60 * 24 * 60 * 60 * 1000)); // 60d = 2mo
    assert.strictEqual(result, '2mo ago');
  });

  it('returns years for >= 1 year', () => {
    const result = relativeTime(iso(400 * 24 * 60 * 60 * 1000)); // ~400d = 1y
    assert.match(result, /^\dy ago$/);
  });

  it('returns empty string for invalid date', () => {
    assert.strictEqual(relativeTime('not-a-date'), '');
  });
});

describe('isStale()', () => {
  it('returns false for a fresh stash', () => {
    assert.strictEqual(isStale(iso(60_000)), false); // 1 min ago
  });

  it('returns true when older than default 7 days', () => {
    assert.strictEqual(isStale(iso(8 * 24 * 60 * 60 * 1000)), true);
  });

  it('respects custom threshold', () => {
    const twoHoursAgo = iso(2 * 60 * 60 * 1000);
    // 2 hours = ~0.083 days. threshold 0.05 days (1.2h) < 2h → stale
    assert.strictEqual(isStale(twoHoursAgo, 0.05), true);
    // threshold 2 days > 2h → not stale
    assert.strictEqual(isStale(twoHoursAgo, 2), false);
    // threshold 0.1 days (2.4h) > 2h → not stale
    assert.strictEqual(isStale(twoHoursAgo, 0.1), false);
  });

  it('returns false for invalid date', () => {
    assert.strictEqual(isStale('garbage'), false);
  });
});

describe('getStaleStashes()', () => {
  const entries = [
    { index: 0, ref: 'stash@{0}', hash: 'a', branch: 'main', message: 'fresh', date: iso(60_000) },
    { index: 1, ref: 'stash@{1}', hash: 'b', branch: 'main', message: 'old', date: iso(10 * 24 * 60 * 60 * 1000) },
  ];

  it('returns only entries older than threshold', () => {
    const stale = getStaleStashes(entries, 7);
    assert.strictEqual(stale.length, 1);
    assert.strictEqual(stale[0].hash, 'b');
  });
});
