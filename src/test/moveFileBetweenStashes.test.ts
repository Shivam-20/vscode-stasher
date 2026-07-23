import assert from 'assert';
import Module = require('module');

describe('copyFileFromStashToStash', () => {
  const moduleLoader = Module as typeof Module & {
    _load: (request: string, parent?: NodeModule, isMain?: boolean) => unknown;
  };
  const originalLoad = moduleLoader._load;
  const originalCache = { ...require.cache };

  const spawnCalls: Array<{ args: string[] }> = [];
  const applyCalls: number[] = [];
  const dropCalls: number[] = [];
  let stashListOutput = [
    'stash@{0}|src123|source|2024-01-01 00:00:00 +0000',
    'stash@{1}|dst456|target|2024-01-01 00:00:00 +0000',
  ].join('\n');

  const repo = {
    rootUri: { fsPath: '/repo' },
    state: {
      onDidChange: () => ({ dispose() {} }),
    },
    applyStash: async (index: number) => {
      applyCalls.push(index);
    },
    dropStash: async (index: number) => {
      dropCalls.push(index);
    },
  };

  const gitApi = {
    git: { path: 'git' },
    repositories: [repo],
    onDidOpenRepository: () => ({ dispose() {} }),
    onDidCloseRepository: () => ({ dispose() {} }),
  };

  function installMocks(): void {
    moduleLoader._load = function (request: string, parent?: NodeModule, isMain?: boolean) {
      if (request === 'vscode') {
        return {
          extensions: {
            getExtension: () => ({
              isActive: true,
              exports: {
                enabled: true,
                getAPI: () => gitApi,
                onDidChangeEnablement: () => ({ dispose() {} }),
              },
            }),
          },
          window: {
            showWarningMessage: async () => undefined,
          },
          EventEmitter: class<T> {
            event = () => ({ dispose() {} });
            fire(_value?: T) {}
            dispose() {}
          },
        };
      }
      if (request === 'child_process') {
        return {
          spawnSync: (_cmd: string, args: string[]) => {
            spawnCalls.push({ args });
            if (args[0] === 'stash' && args[1] === 'list') {
              return { status: 0, stdout: stashListOutput, stderr: '' };
            }
            if (args[0] === 'stash' && args[1] === 'show' && args.includes('--name-only')) {
              return {
                status: 0,
                stdout: 'src/other.ts\nsrc/auth.ts\n',
                stderr: '',
              };
            }
            if (args[0] === 'status') {
              return { status: 0, stdout: '', stderr: '' };
            }
            return { status: 0, stdout: '', stderr: '' };
          },
        };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
  }

  function restoreModules(): void {
    moduleLoader._load = originalLoad;
    for (const key of Object.keys(require.cache)) {
      if (!(key in originalCache)) {
        delete require.cache[key];
      }
    }
  }

  beforeEach(() => {
    spawnCalls.length = 0;
    applyCalls.length = 0;
    dropCalls.length = 0;
    stashListOutput = [
      'stash@{0}|src123|source|2024-01-01 00:00:00 +0000',
      'stash@{1}|dst456|target|2024-01-01 00:00:00 +0000',
    ].join('\n');
    installMocks();
  });

  afterEach(() => {
    restoreModules();
  });

  it('applies target stash and re-stashes all target paths plus copied file', async () => {
    const gitHelper = require('../gitHelper') as typeof import('../gitHelper');
    await gitHelper.initGitApi({ subscriptions: [] } as any);

    await gitHelper.copyFileFromStashToStash(
      {
        index: 0,
        ref: 'stash@{0}',
        hash: 'src123',
        branch: 'main',
        message: 'source',
        date: '2024-01-01 00:00:00 +0000',
      },
      {
        index: 1,
        ref: 'stash@{1}',
        hash: 'dst456',
        branch: 'main',
        message: 'target',
        date: '2024-01-01 00:00:00 +0000',
      },
      '/repo/src/auth.ts',
    );

    assert.deepStrictEqual(applyCalls, [1]);

    const checkoutCalls = spawnCalls.filter((call) => call.args[0] === 'checkout');
    assert.strictEqual(checkoutCalls.length, 1);
    assert.strictEqual(checkoutCalls[0].args[1], 'stash@{0}');
    assert.ok(checkoutCalls[0].args.includes('src/auth.ts'));

    const stashPush = spawnCalls.find((call) => call.args[0] === 'stash' && call.args[1] === 'push');
    assert.ok(stashPush);
    assert.ok(stashPush?.args.includes('src/other.ts'));
    assert.ok(stashPush?.args.includes('src/auth.ts'));
    assert.deepStrictEqual(dropCalls, [1]);
  });
});

describe('findStashByHash', () => {
  const moduleLoader = Module as typeof Module & {
    _load: (request: string, parent?: NodeModule, isMain?: boolean) => unknown;
  };
  const originalLoad = moduleLoader._load;
  const originalCache = { ...require.cache };

  const repo = {
    rootUri: { fsPath: '/repo' },
    state: {
      onDidChange: () => ({ dispose() {} }),
    },
  };

  const gitApi = {
    git: { path: 'git' },
    repositories: [repo],
    onDidOpenRepository: () => ({ dispose() {} }),
    onDidCloseRepository: () => ({ dispose() {} }),
  };

  function installMocks(stdout: string): void {
    moduleLoader._load = function (request: string, parent?: NodeModule, isMain?: boolean) {
      if (request === 'vscode') {
        return {
          extensions: {
            getExtension: () => ({
              isActive: true,
              exports: {
                enabled: true,
                getAPI: () => gitApi,
                onDidChangeEnablement: () => ({ dispose() {} }),
              },
            }),
          },
          EventEmitter: class<T> {
            event = () => ({ dispose() {} });
            fire(_value?: T) {}
            dispose() {}
          },
        };
      }
      if (request === 'child_process') {
        return {
          spawnSync: (_cmd: string, args: string[]) => {
            if (args[0] === 'stash' && args[1] === 'list') {
              return { status: 0, stdout, stderr: '' };
            }
            return { status: 0, stdout: '', stderr: '' };
          },
        };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
  }

  function restoreModules(): void {
    moduleLoader._load = originalLoad;
    for (const key of Object.keys(require.cache)) {
      if (!(key in originalCache)) {
        delete require.cache[key];
      }
    }
  }

  afterEach(() => {
    restoreModules();
  });

  it('returns the current entry after stash indices shift', () => {
    installMocks([
      'stash@{0}|new456|combined|2024-01-02 00:00:00 +0000',
      'stash@{1}|dst456|target|2024-01-01 00:00:00 +0000',
    ].join('\n'));

    const gitHelper = require('../gitHelper') as typeof import('../gitHelper');
    void gitHelper.initGitApi({ subscriptions: [] } as any);

    const found = gitHelper.findStashByHash('dst456');
    assert.ok(found);
    assert.strictEqual(found?.index, 1);
    assert.strictEqual(found?.ref, 'stash@{1}');
  });
});
