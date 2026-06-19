import assert from 'assert';
import { fileTreeLabel, sortBranchNames } from '../treeLabels';

describe('fileTreeLabel', () => {
  it('uses basename as label for nested paths', () => {
    const r = fileTreeLabel('src/stashProvider.ts', 'M');
    assert.strictEqual(r.label, 'stashProvider.ts');
    assert.strictEqual(r.description, 'src · M');
  });

  it('uses status only for root-level files', () => {
    const r = fileTreeLabel('README.md', 'A');
    assert.strictEqual(r.label, 'README.md');
    assert.strictEqual(r.description, 'A');
  });

  it('handles deeply nested paths', () => {
    const r = fileTreeLabel('src/test/foo.test.ts', 'M');
    assert.strictEqual(r.label, 'foo.test.ts');
    assert.strictEqual(r.description, 'src/test · M');
  });
});

describe('sortBranchNames', () => {
  it('puts current branch first', () => {
    assert.deepStrictEqual(
      sortBranchNames(['dev', 'main', 'feature/x'], 'main'),
      ['main', 'dev', 'feature/x'],
    );
  });

  it('sorts alphabetically when no current branch', () => {
    assert.deepStrictEqual(
      sortBranchNames(['dev', 'main', 'feature/x']),
      ['dev', 'feature/x', 'main'],
    );
  });

  it('sorts alphabetically among non-current branches', () => {
    assert.deepStrictEqual(
      sortBranchNames(['z-branch', 'a-branch', 'main'], 'main'),
      ['main', 'a-branch', 'z-branch'],
    );
  });
});
