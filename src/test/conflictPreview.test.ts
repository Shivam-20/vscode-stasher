import assert from 'assert';
import { getOverlappingFiles } from '../conflictPreview';

describe('getOverlappingFiles', () => {
  it('returns paths present in both stash and local changes', () => {
    assert.deepStrictEqual(
      getOverlappingFiles(['src/a.ts', 'src/b.ts'], ['src/b.ts', 'README.md']),
      ['src/b.ts'],
    );
  });

  it('returns empty when no overlap', () => {
    assert.deepStrictEqual(
      getOverlappingFiles(['src/a.ts'], ['lib/b.ts']),
      [],
    );
  });

  it('matches paths across Windows and POSIX separators', () => {
    assert.deepStrictEqual(
      getOverlappingFiles(['src/a.ts'], ['src\\a.ts']),
      ['src/a.ts'],
    );
  });
});
