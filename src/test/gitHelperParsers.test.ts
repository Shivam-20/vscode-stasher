/**
 * Unit tests for gitHelper pure parsing logic (no git process required).
 * Covers the stash list parser, StashStat parsing, and SearchMatch parsing.
 */
import assert from 'assert';
import { stripStashBranchPrefix } from '../stashMessage';
import { parseStashNameStatusLine, parseStashShowNameStatus } from '../stashFileListing';

// ─── Test: listStashes format parser ─────────────────────────────────────────

// We inline the parser logic to test it without spawning git
function parseListStashesOutput(stdout: string) {
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line, i) => {
      const pipeIndex1 = line.indexOf('|');
      const pipeIndex2 = line.indexOf('|', pipeIndex1 + 1);
      const pipeIndex3 = line.indexOf('|', pipeIndex2 + 1);
      const ref     = line.substring(0, pipeIndex1);
      const hash    = line.substring(pipeIndex1 + 1, pipeIndex2);
      const subject = line.substring(pipeIndex2 + 1, pipeIndex3);
      const date    = line.substring(pipeIndex3 + 1).trim();
      const branchMatch = subject.match(/^(?:WIP on|On) ([^:]+):/);
      const branch = branchMatch?.[1] ?? 'unknown';
      return { index: i, ref, hash, branch, message: subject, date };
    });
}

describe('listStashes — parser', () => {
  const SAMPLE = [
    'stash@{0}|abc123|WIP on main: feature work|2024-05-01 10:00:00 +0530',
    'stash@{1}|def456|On dev: bug fix|2024-04-20 09:00:00 +0530',
    'stash@{2}|ghi789|WIP on feature/auth: oauth|2024-01-01 00:00:00 +0000',
  ].join('\n');

  let result: ReturnType<typeof parseListStashesOutput>;

  before(() => {
    result = parseListStashesOutput(SAMPLE);
  });

  it('parses correct number of entries', () => {
    assert.strictEqual(result.length, 3);
  });

  it('parses ref correctly', () => {
    assert.strictEqual(result[0].ref, 'stash@{0}');
    assert.strictEqual(result[1].ref, 'stash@{1}');
  });

  it('parses hash correctly', () => {
    assert.strictEqual(result[0].hash, 'abc123');
    assert.strictEqual(result[1].hash, 'def456');
  });

  it('parses message correctly', () => {
    assert.strictEqual(result[0].message, 'WIP on main: feature work');
    assert.strictEqual(result[1].message, 'On dev: bug fix');
  });

  it('parses branch from WIP on prefix', () => {
    assert.strictEqual(result[0].branch, 'main');
  });

  it('parses branch from On prefix', () => {
    assert.strictEqual(result[1].branch, 'dev');
  });

  it('parses branch with slash', () => {
    assert.strictEqual(result[2].branch, 'feature/auth');
  });

  it('parses date correctly', () => {
    assert.match(result[0].date, /2024-05-01/);
  });

  it('assigns sequential indices', () => {
    assert.deepStrictEqual(result.map((r) => r.index), [0, 1, 2]);
  });

  it('returns unknown branch for unparseable subject', () => {
    const r = parseListStashesOutput('stash@{0}|abc|just some message|2024-01-01 00:00:00 +0000');
    assert.strictEqual(r[0].branch, 'unknown');
  });
});

// ─── Test: stripStashBranchPrefix ─────────────────────────────────────────────

describe('stripStashBranchPrefix', () => {
  it('strips WIP on prefix and keeps user message', () => {
    assert.strictEqual(stripStashBranchPrefix('WIP on main: feature work'), 'feature work');
  });

  it('strips On prefix and keeps user message', () => {
    assert.strictEqual(stripStashBranchPrefix('On dev: bug fix'), 'bug fix');
  });

  it('returns WIP when only the default prefix remains', () => {
    assert.strictEqual(stripStashBranchPrefix('WIP on main:'), 'WIP');
  });

  it('leaves custom messages unchanged', () => {
    assert.strictEqual(stripStashBranchPrefix('my custom stash note'), 'my custom stash note');
  });

  it('handles branch names with slashes', () => {
    assert.strictEqual(stripStashBranchPrefix('WIP on feature/auth: oauth'), 'oauth');
  });
});

// ─── Test: StashStat numstat parser ──────────────────────────────────────────

function parseNumstat(stdout: string) {
  return stdout.trim().split('\n').filter(Boolean).map((line) => {
    const parts = line.split('\t');
    return {
      added:   parseInt(parts[0] ?? '0', 10) || 0,
      removed: parseInt(parts[1] ?? '0', 10) || 0,
      file:    parts[2] ?? '',
    };
  });
}

describe('getStashStats — numstat parser', () => {
  const NUMSTAT = '10\t3\tsrc/foo.ts\n0\t5\tsrc/bar.ts\n42\t0\tnew_file.ts';

  it('parses all rows', () => {
    assert.strictEqual(parseNumstat(NUMSTAT).length, 3);
  });

  it('parses added lines', () => {
    assert.strictEqual(parseNumstat(NUMSTAT)[0].added, 10);
  });

  it('parses removed lines', () => {
    assert.strictEqual(parseNumstat(NUMSTAT)[0].removed, 3);
  });

  it('parses file path', () => {
    assert.strictEqual(parseNumstat(NUMSTAT)[0].file, 'src/foo.ts');
  });

  it('handles binary files (- -) gracefully', () => {
    const binary = '-\t-\timage.png';
    const r = parseNumstat(binary);
    assert.strictEqual(r[0].added, 0);
    assert.strictEqual(r[0].removed, 0);
    assert.strictEqual(r[0].file, 'image.png');
  });
});

// ─── Test: searchInStashes grep output parser ─────────────────────────────────

function parseGrepLine(stashRef: string, stashMessage: string, line: string) {
  const firstColon  = line.indexOf(':');
  const rest        = line.slice(firstColon + 1);
  const secondColon = rest.indexOf(':');
  const thirdColon  = rest.indexOf(':', secondColon + 1);
  const file    = rest.substring(0, secondColon);
  const lineNum = parseInt(rest.substring(secondColon + 1, thirdColon), 10) || 0;
  const text    = rest.substring(thirdColon + 1);
  return { stashRef, stashMessage, file, line: lineNum, text };
}

describe('searchInStashes — grep line parser', () => {
  it('parses a standard grep output line', () => {
    const line = 'stash@{0}:src/auth.ts:42:  const token = getToken();';
    const r = parseGrepLine('stash@{0}', 'WIP on main', line);
    assert.strictEqual(r.file, 'src/auth.ts');
    assert.strictEqual(r.line, 42);
    assert.ok(r.text.includes('getToken'));
  });

  it('handles file in repo root', () => {
    const line = 'stash@{1}:index.ts:1:export default {};';
    const r = parseGrepLine('stash@{1}', 'msg', line);
    assert.strictEqual(r.file, 'index.ts');
    assert.strictEqual(r.line, 1);
  });
});

// ─── Test: stash show --name-status parser ────────────────────────────────────

describe('parseStashShowNameStatus', () => {
  const SAMPLE = [
    'M\tsrc/foo.ts',
    'A\tdocs/index.md',
    'D\tdocs/cron-semaphore.md',
    'R100\tdocs/cron-semaphore.md\tdocs/cron-semaphore/guide.md',
  ].join('\n');

  it('parses modified, added, deleted, and renamed rows', () => {
    const rows = parseStashShowNameStatus(SAMPLE);
    assert.strictEqual(rows.length, 4);
    assert.strictEqual(rows[0].statusChar, 'M');
    assert.strictEqual(rows[0].path, 'src/foo.ts');
    assert.strictEqual(rows[1].statusChar, 'A');
    assert.strictEqual(rows[3].statusChar, 'R');
    assert.strictEqual(rows[3].oldPath, 'docs/cron-semaphore.md');
    assert.strictEqual(rows[3].path, 'docs/cron-semaphore/guide.md');
  });

  it('parseStashNameStatusLine returns undefined for blank lines', () => {
    assert.strictEqual(parseStashNameStatusLine(''), undefined);
    assert.strictEqual(parseStashNameStatusLine('invalid'), undefined);
  });
});
