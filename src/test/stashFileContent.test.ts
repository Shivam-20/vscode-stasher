import assert from 'assert';
import Module = require('module');
import { Status } from '../gitEnums';

describe('getStashFileContent', () => {
  const moduleLoader = Module as typeof Module & {
    _load: (request: string, parent?: NodeModule, isMain?: boolean) => unknown;
  };
  const originalLoad = moduleLoader._load;
  const originalCache = { ...require.cache };

  const showCalls: string[] = [];

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
            if (args[0] === 'show') {
              showCalls.push(args[1]);
            }
            if (args[1] === 'stash@{0}^3:src/new.ts') {
              return { status: 0, stdout: 'untracked content\n', stderr: '' };
            }
            if (args[1] === 'stash@{0}:src/mod.ts') {
              return { status: 0, stdout: 'tracked content\n', stderr: '' };
            }
            return { status: 1, stdout: '', stderr: 'not found' };
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
    showCalls.length = 0;
    installMocks();
  });

  afterEach(() => {
    restoreModules();
  });

  it('reads untracked files from stash^3 first', () => {
    const gitHelper = require('../gitHelper') as typeof import('../gitHelper');
    void gitHelper.initGitApi({ subscriptions: [] } as any);

    const content = gitHelper.getStashFileContent(
      'stash@{0}',
      'src/new.ts',
      Status.UNTRACKED,
    );

    assert.strictEqual(content, 'untracked content\n');
    assert.deepStrictEqual(showCalls, ['stash@{0}^3:src/new.ts']);
  });

  it('reads tracked files from the main stash ref', () => {
    const gitHelper = require('../gitHelper') as typeof import('../gitHelper');
    void gitHelper.initGitApi({ subscriptions: [] } as any);

    const content = gitHelper.getStashFileContent('stash@{0}', 'src/mod.ts');

    assert.strictEqual(content, 'tracked content\n');
    assert.deepStrictEqual(showCalls, ['stash@{0}:src/mod.ts']);
  });
});
