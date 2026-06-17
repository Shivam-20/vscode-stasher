import assert from 'assert';
import Module = require('module');

type SpawnResult = {
  status: number;
  stdout?: string;
  stderr?: string;
};

describe('bugfix regressions', () => {
  const moduleLoader = Module as typeof Module & {
    _load: (request: string, parent?: NodeModule, isMain?: boolean) => unknown;
  };
  const originalLoad = moduleLoader._load;
  const originalCache = { ...require.cache };

  const commandHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const infoMessages: string[] = [];
  const errorMessages: string[] = [];
  const warningMessages: string[] = [];
  const spawnCalls: Array<{ cmd: string; args: string[]; cwd?: string }> = [];

  let showQuickPickResult: unknown;
  let showInputBoxResult: string | undefined = '';
  let showWarningResult: string | undefined = 'Dismiss';
  let spawnImpl: ((cmd: string, args: string[], options?: { cwd?: string }) => SpawnResult) | undefined;

  const repo = {
    rootUri: { fsPath: '/repo' },
    state: {
      workingTreeChanges: [] as Array<{ uri: { fsPath: string }; status: number }>,
      indexChanges: [] as Array<{ uri: { fsPath: string }; status: number }>,
      refs: [] as Array<{ type: number; name?: string; commit?: string }>,
      onDidChange: () => ({ dispose() {} }),
    },
    diffBetween: async () => [],
    createStash: async () => {},
    applyStash: async () => {},
    popStash: async () => {},
    dropStash: async () => {},
    checkout: async () => {},
  };

  const gitApi = {
    git: { path: 'git' },
    repositories: [repo],
    toGitUri: (uri: { fsPath: string }, ref: string) => ({ fsPath: `${uri.fsPath}@${ref}` }),
    onDidOpenRepository: () => ({ dispose() {} }),
    onDidCloseRepository: () => ({ dispose() {} }),
  };

  const vscodeStub = {
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
      showQuickPick: async (items: unknown) => showQuickPickResult ?? items,
      showInputBox: async () => showInputBoxResult,
      showErrorMessage: async (msg: string) => {
        errorMessages.push(msg);
        return undefined;
      },
      showInformationMessage: async (msg: string) => {
        infoMessages.push(msg);
        return undefined;
      },
      showWarningMessage: async (msg: string) => {
        warningMessages.push(msg);
        return showWarningResult;
      },
      createOutputChannel: () => ({ appendLine() {}, clear() {}, show() {}, dispose() {} }),
    },
    commands: {
      executeCommand: async () => undefined,
      registerCommand: (name: string, handler: (...args: unknown[]) => unknown) => {
        commandHandlers.set(name, handler);
        return { dispose() {} };
      },
    },
    workspace: {
      onDidCloseTextDocument: () => ({ dispose() {} }),
      registerTextDocumentContentProvider: () => ({ dispose() {} }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
      getConfiguration: () => ({ get: (_key: string, fallback: boolean) => fallback, update: async () => {} }),
      openTextDocument: async () => ({}),
    },
    env: { clipboard: { writeText: async () => {} } },
    Uri: {
      file: (fsPath: string) => ({ fsPath }),
      parse: (value: string) => ({ fsPath: value, path: value, authority: value }),
    },
    EventEmitter: class<T> {
      event = () => ({ dispose() {} });
      fire(_value?: T) {}
      dispose() {}
    },
    TreeItemCheckboxState: { Checked: 1, Unchecked: 0 },
    ThemeIcon: class { constructor(public id: string) {} },
    ThemeColor: class { constructor(public id: string) {} },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ViewColumn: { Beside: 2, One: 1 },
    MarkdownString: class { constructor(public value: string) {} },
    ConfigurationTarget: { Workspace: 1 },
  };

  function resetState(): void {
    commandHandlers.clear();
    infoMessages.length = 0;
    errorMessages.length = 0;
    warningMessages.length = 0;
    spawnCalls.length = 0;
    showQuickPickResult = undefined;
    showInputBoxResult = '';
    showWarningResult = 'Dismiss';
    spawnImpl = undefined;
    repo.state.workingTreeChanges = [];
    repo.state.indexChanges = [];
    repo.state.refs = [];
    repo.createStash = async () => {};
    repo.applyStash = async () => {};
    repo.popStash = async () => {};
    repo.dropStash = async () => {};
    repo.checkout = async () => {};
  }

  function installMocks(): void {
    moduleLoader._load = function (request: string, parent?: NodeModule, isMain?: boolean) {
      if (request === 'vscode') {
        return vscodeStub;
      }
      if (request === 'child_process') {
        return {
          spawnSync: (cmd: string, args: string[], options?: { cwd?: string }) => {
            spawnCalls.push({ cmd, args, cwd: options?.cwd });
            return spawnImpl ? spawnImpl(cmd, args, options) : { status: 0, stdout: '', stderr: '' };
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
    resetState();
    installMocks();
  });

  afterEach(() => {
    restoreModules();
  });

  it('partialStashCommand includes untracked files in git stash push', async () => {
    const gitHelper = require('../gitHelper') as typeof import('../gitHelper');
    const { partialStashCommand } = require('../partialStash') as typeof import('../partialStash');

    repo.state.workingTreeChanges = [{ uri: { fsPath: '/repo/new-file.ts' }, status: 7 }];
    showQuickPickResult = [{ label: 'new-file.ts', description: 'Added / Untracked', fsPath: '/repo/new-file.ts' }];

    await gitHelper.initGitApi({ subscriptions: [] } as any);
    await partialStashCommand();

    const stashPush = spawnCalls.find((call) => call.args[0] === 'stash' && call.args[1] === 'push');
    assert.ok(stashPush, 'expected git stash push to be invoked');
    assert.ok(stashPush?.args.includes('--include-untracked'));
  });

  it('withConflictHandling reports that a conflict interrupted the workflow', async () => {
    const { withConflictHandling } = require('../conflictHelper') as typeof import('../conflictHelper');
    const gitHelper = require('../gitHelper') as typeof import('../gitHelper');

    repo.state.workingTreeChanges = [{ uri: { fsPath: '/repo/conflict.ts' }, status: 8 }];
    await gitHelper.initGitApi({ subscriptions: [] } as any);

    const result = await withConflictHandling(async () => {
      throw { gitErrorCode: 'StashConflict' };
    });

    assert.strictEqual(result, false);
    assert.strictEqual(warningMessages.length, 1);
  });

  it('deleteFilesFromStash skips re-stashing when no changes remain after deletion', async () => {
    const gitHelper = require('../gitHelper') as typeof import('../gitHelper');

    let createStashCalls = 0;
    repo.popStash = async () => {};
    repo.createStash = async () => {
      createStashCalls++;
    };
    repo.state.workingTreeChanges = [];
    repo.state.indexChanges = [];

    spawnImpl = (_cmd, args) => {
      if (args[0] === 'restore' || args[0] === 'checkout') {
        return { status: 0, stdout: '', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    };

    await gitHelper.initGitApi({ subscriptions: [] } as any);
    await gitHelper.deleteFilesFromStash(
      {
        index: 0,
        ref: 'stash@{0}',
        hash: 'abc123',
        branch: 'main',
        message: 'WIP on main: test',
        date: '2024-01-01 00:00:00 +0000',
      },
      ['/repo/only-file.ts']
    );

    assert.strictEqual(createStashCalls, 0);
  });
});
