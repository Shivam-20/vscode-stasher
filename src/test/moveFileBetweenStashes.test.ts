import assert from 'assert';
import Module = require('module');

describe('copyFileFromStashToStash', () => {
  const moduleLoader = Module as typeof Module & {
    _load: (request: string, parent?: NodeModule, isMain?: boolean) => unknown;
  };
  const originalLoad = moduleLoader._load;
  const originalCache = { ...require.cache };

  const spawnCalls: Array<{ args: string[] }> = [];
  const popCalls: number[] = [];
  const createStashCalls: Array<{ message?: string; includeUntracked?: boolean }> = [];

  const repo = {
    rootUri: { fsPath: '/repo' },
    state: {
      onDidChange: () => ({ dispose() {} }),
    },
    popStash: async (index: number) => {
      popCalls.push(index);
    },
    createStash: async (options: { message?: string; includeUntracked?: boolean }) => {
      createStashCalls.push(options);
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
    popCalls.length = 0;
    createStashCalls.length = 0;
    installMocks();
  });

  afterEach(() => {
    restoreModules();
  });

  it('creates a temporary stash for the source file before popping the target stash', async () => {
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
      '/repo/src/auth.ts'
    );

    assert.strictEqual(createStashCalls.length, 1);
    assert.deepStrictEqual(createStashCalls[0], {
      message: 'target',
      includeUntracked: true,
    });
    assert.deepStrictEqual(popCalls, [2]);

    const checkoutCalls = spawnCalls.filter((call) => call.args[0] === 'checkout');
    assert.strictEqual(checkoutCalls.length, 2);
    assert.strictEqual(checkoutCalls[0].args[1], 'stash@{0}');
    assert.strictEqual(checkoutCalls[1].args[1], 'stash@{0}');

    const stashPush = spawnCalls.find((call) => call.args[0] === 'stash' && call.args[1] === 'push');
    assert.ok(stashPush);
    assert.ok(stashPush?.args.includes('/repo/src/auth.ts'));

    const dropCall = spawnCalls.find((call) => call.args[0] === 'stash' && call.args[1] === 'drop');
    assert.ok(dropCall);
    assert.strictEqual(dropCall?.args[2], 'stash@{1}');
  });
});
