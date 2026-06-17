import assert from 'assert';
import Module = require('module');

describe('searchInStashes', () => {
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

  let spawnImpl: ((args: string[]) => { status: number; stdout: string; stderr?: string }) | undefined;

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
            if (!spawnImpl) {
              return { status: 0, stdout: '', stderr: '' };
            }
            return spawnImpl(args);
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
    spawnImpl = undefined;
    installMocks();
  });

  afterEach(() => {
    restoreModules();
  });

  it('returns both file-name matches and content matches across stashes', async () => {
    spawnImpl = (args) => {
      if (args[0] === 'stash' && args[1] === 'list') {
        return {
          status: 0,
          stdout: 'stash@{0}|abc123|WIP on main: auth work|2024-05-01 10:00:00 +0530\n',
        };
      }
      if (args[0] === 'grep') {
        return {
          status: 0,
          stdout: 'stash@{0}:src/authService.ts:42:const authToken = getToken();\n',
        };
      }
      if (args[0] === 'stash' && args[1] === 'show' && args[2] === '--name-only') {
        return {
          status: 0,
          stdout: 'src/authService.ts\nsrc/unrelated.ts\n',
        };
      }
      return { status: 1, stdout: '', stderr: '' };
    };

    const gitHelper = require('../gitHelper') as typeof import('../gitHelper');
    await gitHelper.initGitApi({ subscriptions: [] } as any);

    const results = gitHelper.searchInStashes('auth');

    assert.strictEqual(results.length, 2);
    assert.ok(results.some((result: any) => result.kind === 'content' && result.file === 'src/authService.ts' && result.line === 42));
    assert.ok(results.some((result: any) => result.kind === 'file' && result.file === 'src/authService.ts'));
  });
});
