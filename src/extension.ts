import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  initGitApi,
  createStash,
  applyStash,
  popStash,
  dropStash,
  stashBranch,
  renameStash,
  addToExistingStash,
  listStashes,
  getAPI,
  getRepository,
  getStashFiles,
  quickStash,
  unstashFiles,
  deleteFilesFromStash,
  mergeStashes,
  exportStashAsPatch,
  dispose as disposeGit,
} from './gitHelper';
import { StashTreeDataProvider, StashTreeItem, StashFileTreeItem } from './stashProvider';
import { WorkingChangesProvider, WorkingFileItem } from './workingChangesProvider';
import { showFileDiff } from './diffViewer';
import { withConflictHandling } from './conflictHelper';
import { partialStashCommand } from './partialStash';
import { openHunkPicker, disposeHunkPicker } from './hunkPicker';

// ─── Activation ───────────────────────────────────────────────────────────────

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // 1. Boot the git integration layer
  await initGitApi(context);

  // 2. Create the stash list tree data provider
  const provider = new StashTreeDataProvider(context);
  context.subscriptions.push(provider);

  // 3. Register the stash list sidebar tree view
  const treeView = vscode.window.createTreeView('stasher.stashList', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // 3b. Working Changes panel
  const workingProvider = new WorkingChangesProvider(context);
  context.subscriptions.push(workingProvider);
  const workingTreeView = vscode.window.createTreeView('stasher.workingChanges', {
    treeDataProvider: workingProvider,
    showCollapseAll: false,
    manageCheckboxStateManually: false,
  });
  // Keep checked state in sync when user clicks a checkbox
  context.subscriptions.push(
    workingTreeView.onDidChangeCheckboxState((e) => {
      workingProvider.handleCheckboxChange(e.items as Array<[WorkingFileItem, vscode.TreeItemCheckboxState]>);
    })
  );
  context.subscriptions.push(workingTreeView);

  // 4. Register all commands
  context.subscriptions.push(

    // ── Create Stash ──────────────────────────────────────────────────────────
    vscode.commands.registerCommand('stasher.createStash', async () => {
      const message = await vscode.window.showInputBox({
        title: 'Create Stash',
        placeHolder: 'e.g. "WIP: auth feature" — leave empty for default',
        prompt: 'Optional: enter a name for this stash',
      });

      if (message === undefined) {
        return; // user cancelled
      }

      try {
        await createStash(message.trim() || undefined, true);
        provider.refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('No local changes')) {
          void vscode.window.showInformationMessage(
            'Stasher: Nothing to stash — working tree is clean.'
          );
        } else {
          void vscode.window.showErrorMessage(`Stasher: Create stash failed — ${msg}`);
        }
      }
    }),

    // ── Partial Stash ─────────────────────────────────────────────────────────
    vscode.commands.registerCommand('stasher.partialStash', async () => {
      await partialStashCommand();
      provider.refresh();
    }),

    // ── Refresh ───────────────────────────────────────────────────────────────
    vscode.commands.registerCommand('stasher.refresh', () => {
      provider.refresh();
    }),

    // ── Pop Stash ─────────────────────────────────────────────────────────────
    vscode.commands.registerCommand(
      'stasher.popStash',
      async (item: StashTreeItem) => {
        if (!item?.stashEntry) {
          return;
        }
        try {
          await withConflictHandling(() => popStash(item.stashEntry.index));
          provider.refresh();
        } catch (err) {
          void vscode.window.showErrorMessage(
            `Stasher: Pop failed — ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    ),

    // ── Apply Stash ───────────────────────────────────────────────────────────
    vscode.commands.registerCommand(
      'stasher.applyStash',
      async (item: StashTreeItem) => {
        if (!item?.stashEntry) {
          return;
        }
        try {
          await withConflictHandling(() => applyStash(item.stashEntry.index));
          provider.refresh();
        } catch (err) {
          void vscode.window.showErrorMessage(
            `Stasher: Apply failed — ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    ),

    // ── Drop Stash ────────────────────────────────────────────────────────────
    vscode.commands.registerCommand(
      'stasher.dropStash',
      async (item: StashTreeItem) => {
        if (!item?.stashEntry) {
          return;
        }
        const label =
          item.stashEntry.message.length > 40
            ? item.stashEntry.message.substring(0, 37) + '…'
            : item.stashEntry.message;

        const answer = await vscode.window.showWarningMessage(
          `Delete stash "${label}"? This cannot be undone.`,
          { modal: true },
          'Delete'
        );

        if (answer !== 'Delete') {
          return;
        }

        try {
          await dropStash(item.stashEntry.index);
          provider.refresh();
        } catch (err) {
          void vscode.window.showErrorMessage(
            `Stasher: Delete failed — ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    ),

    // ── Rename Stash ──────────────────────────────────────────────────────────
    vscode.commands.registerCommand(
      'stasher.renameStash',
      async (item: StashTreeItem) => {
        if (!item?.stashEntry) {
          return;
        }
        const newMessage = await vscode.window.showInputBox({
          title: 'Rename Stash',
          value: item.stashEntry.message,
          prompt: 'Enter a new message for this stash',
          validateInput: (v) =>
            v.trim().length === 0 ? 'Message cannot be empty' : undefined,
        });

        if (!newMessage) {
          return;
        }

        try {
          await renameStash(item.stashEntry, newMessage.trim());
          provider.refresh();
        } catch (err) {
          void vscode.window.showErrorMessage(
            `Stasher: Rename failed — ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    ),

    // ── Create Branch from Stash ──────────────────────────────────────────────
    vscode.commands.registerCommand(
      'stasher.createBranch',
      async (item: StashTreeItem) => {
        if (!item?.stashEntry) {
          return;
        }
        const branchName = await vscode.window.showInputBox({
          title: 'Create Branch from Stash',
          placeHolder: 'e.g. feature/my-feature',
          prompt: 'Enter the new branch name',
          validateInput: (v) => {
            if (!v.trim()) {
              return 'Branch name cannot be empty';
            }
            if (/\s/.test(v)) {
              return 'Branch name cannot contain spaces';
            }
            return undefined;
          },
        });

        if (!branchName) {
          return;
        }

        const success = stashBranch(branchName.trim(), item.stashEntry.ref);
        if (success) {
          provider.refresh();
          void vscode.window.showInformationMessage(
            `Stasher: Switched to new branch '${branchName}' with stash applied.`
          );
        }
      }
    ),

    // ── Show File Diff ────────────────────────────────────────────────────────
    vscode.commands.registerCommand(
      'stasher.showFileDiff',
      async (item: StashFileTreeItem) => {
        if (!item) {
          return;
        }
        await showFileDiff(item);
      }
    ),

    // ── Stash All (from Working Changes panel) ────────────────────────────────
    vscode.commands.registerCommand('stasher.stashAll', async () => {
      const message = await vscode.window.showInputBox({
        title: 'Stash All Changes',
        placeHolder: 'e.g. "WIP: feature work" — leave empty for default',
        prompt: 'Optional: enter a name for this stash',
      });
      if (message === undefined) {
        return;
      }
      try {
        await createStash(message.trim() || undefined, true);
        provider.refresh();
        workingProvider.refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('No local changes')) {
          void vscode.window.showInformationMessage('Stasher: Nothing to stash — working tree is clean.');
        } else {
          void vscode.window.showErrorMessage(`Stasher: Stash all failed — ${msg}`);
        }
      }
    }),

    // ── Stash Checked (from Working Changes panel) ────────────────────────────
    vscode.commands.registerCommand('stasher.stashChecked', async () => {
      const paths = workingProvider.getCheckedPaths();
      if (paths.length === 0) {
        void vscode.window.showInformationMessage('Stasher: No files checked — check files in the Working Changes panel first.');
        return;
      }
      await partialStashCommand(paths);
      provider.refresh();
      workingProvider.refresh();
    }),

    // ── Add Checked Files to an Existing Stash ────────────────────────────────
    vscode.commands.registerCommand('stasher.addToStash', async () => {
      const stashes = listStashes();
      if (stashes.length === 0) {
        void vscode.window.showInformationMessage('Stasher: No existing stashes to add to.');
        return;
      }

      const picked = await vscode.window.showQuickPick(
        stashes.map((s) => ({ label: s.ref, description: s.message, stash: s })),
        { title: 'Add to Existing Stash', placeHolder: 'Select a stash to merge current changes into' }
      );
      if (!picked) {
        return;
      }

      const paths = workingProvider.getCheckedPaths();
      const usingPaths = paths.length > 0;

      const confirmMsg = usingPaths
        ? `Merge ${paths.length} checked file(s) into "${picked.description}"?\n\nThe stash will be popped first, then re-stashed with the new files included.`
        : `Merge ALL current changes into "${picked.description}"?\n\nThe stash will be popped first, then re-stashed with all changes included.`;

      const answer = await vscode.window.showWarningMessage(
        confirmMsg,
        { modal: true },
        'Merge'
      );
      if (answer !== 'Merge') {
        return;
      }

      try {
        await withConflictHandling(() =>
          addToExistingStash(picked.stash, usingPaths ? paths : undefined)
        );
        provider.refresh();
        workingProvider.refresh();
        void vscode.window.showInformationMessage(`Stasher: Changes merged into "${picked.description}".`);
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Stasher: Add to stash failed — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }),

    // ── Add Single File to Stash (inline button on Working Changes rows) ─────
    vscode.commands.registerCommand(
      'stasher.addFileToStash',
      async (item: WorkingFileItem) => {
        if (!item?.change) {
          return;
        }
        const filePath = item.change.uri.fsPath;
        const stashes = listStashes();

        if (stashes.length > 0) {
          // ── Pick an existing stash ──────────────────────────────────────────
          const picked = await vscode.window.showQuickPick(
            stashes.map((s) => ({ label: s.ref, description: s.message, stash: s })),
            {
              title: 'Add File to Stash — Pick a stash',
              placeHolder: 'Select the stash to merge this file into',
            }
          );
          if (!picked) {
            return;
          }

          const answer = await vscode.window.showWarningMessage(
            `Merge this file into "${picked.description}"?\n\nThe stash will be popped, combined with this file, then re-stashed.`,
            { modal: true },
            'Merge'
          );
          if (answer !== 'Merge') {
            return;
          }

          try {
            await withConflictHandling(() =>
              addToExistingStash(picked.stash, [filePath])
            );
            provider.refresh();
            workingProvider.refresh();
            void vscode.window.showInformationMessage(
              `Stasher: File added to "${picked.description}".`
            );
          } catch (err) {
            void vscode.window.showErrorMessage(
              `Stasher: Add file to stash failed — ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }
        } else {
          // ── No stashes — create a new one with just this file ───────────────
          const message = await vscode.window.showInputBox({
            title: 'Add File to Stash — Create New Stash',
            placeHolder: 'e.g. "WIP: auth changes" — leave empty for default',
            prompt: 'No stashes exist yet. Enter a name for the new stash.',
          });
          if (message === undefined) {
            return; // cancelled
          }

          const api = getAPI();
          const repo = getRepository();
          if (!api || !repo) {
            void vscode.window.showErrorMessage('Stasher: No git repository found.');
            return;
          }

          const { spawnSync } = await import('child_process');
          const args: string[] = ['stash', 'push', '--include-untracked'];
          if (message.trim()) {
            args.push('-m', message.trim());
          }
          args.push('--', filePath);

          const result = spawnSync(api.git.path, args, {
            cwd: repo.rootUri.fsPath,
            encoding: 'utf8',
          });

          if (result.status !== 0) {
            void vscode.window.showErrorMessage(
              `Stasher: Failed to create stash — ${
                result.stderr?.trim() || 'Unknown error'
              }`
            );
            return;
          }

          provider.refresh();
          workingProvider.refresh();
          void vscode.window.showInformationMessage('Stasher: New stash created with this file.');
        }
      }
    )
  );

  // ─── Advanced commands ────────────────────────────────────────────────────

  // Quick Stash (title-bar button in Working Changes view)
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.quickStash', async () => {
      const repo = getRepository();
      if (!repo) {
        void vscode.window.showErrorMessage('Stasher: No git repository found.');
        return;
      }
      try {
        await quickStash();
        provider.refresh();
        workingProvider.refresh();
        void vscode.window.showInformationMessage('Stasher: Quick stash created.');
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Stasher: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );

  // Copy File Path
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.copyFilePath', (item: StashFileTreeItem) => {
      if (!(item instanceof StashFileTreeItem)) { return; }
      void vscode.env.clipboard.writeText(item.absolutePath).then(() => {
        void vscode.window.showInformationMessage(`Stasher: Copied path to clipboard.`);
      });
    })
  );

  // Export as .patch
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.exportPatch', async (item: StashTreeItem) => {
      if (!(item instanceof StashTreeItem)) { return; }
      let content: string;
      try {
        content = exportStashAsPatch(item.stashEntry);
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Stasher: ${err instanceof Error ? err.message : String(err)}`
        );
        return;
      }
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`stash_${item.stashEntry.index}.patch`),
        filters: { 'Patch files': ['patch'], 'All files': ['*'] },
      });
      if (!saveUri) { return; }
      try {
        fs.writeFileSync(saveUri.fsPath, content, { encoding: 'utf8' });
        void vscode.window.showInformationMessage(`Stasher: Patch saved to ${path.basename(saveUri.fsPath)}.`);
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Stasher: Could not write patch — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );

  // Unstash This File (inline on a stash file item)
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.unstashThisFile', async (item: StashFileTreeItem) => {
      if (!(item instanceof StashFileTreeItem)) { return; }
      const stashes = await listStashes();
      const entry = stashes.find((s) => s.ref === item.stashRef);
      if (!entry) {
        void vscode.window.showErrorMessage('Stasher: Could not locate stash entry.');
        return;
      }
      try {
        unstashFiles(entry, [item.absolutePath]);
        workingProvider.refresh();
        void vscode.window.showInformationMessage(`Stasher: File restored from ${item.stashRef}.`);
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Stasher: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );

  // Unstash Files… (QuickPick from a stash entry)
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.unstashFiles', async (item: StashTreeItem) => {
      if (!(item instanceof StashTreeItem)) { return; }
      const group = await getStashFiles(item.stashEntry.ref);
      const allFiles: string[] = [];
      for (const f of [...group.tracked, ...group.untracked]) {
        allFiles.push(f.uri.fsPath);
      }
      if (allFiles.length === 0) {
        void vscode.window.showInformationMessage('Stasher: No files found in this stash.');
        return;
      }
      const picks = await vscode.window.showQuickPick(
        allFiles.map((p) => ({ label: path.basename(p), description: p, picked: false })),
        { canPickMany: true, placeHolder: 'Select files to restore from stash' }
      );
      if (!picks || picks.length === 0) { return; }
      try {
        unstashFiles(item.stashEntry, picks.map((p) => p.description!));
        workingProvider.refresh();
        void vscode.window.showInformationMessage(`Stasher: ${picks.length} file(s) restored.`);
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Stasher: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );

  // Delete File from Stash
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.deleteFileFromStash', async (item: StashFileTreeItem) => {
      if (!(item instanceof StashFileTreeItem)) { return; }
      const confirm = await vscode.window.showWarningMessage(
        `Remove "${path.basename(item.absolutePath)}" from ${item.stashRef}? This will re-create the stash without this file.`,
        { modal: true },
        'Delete'
      );
      if (confirm !== 'Delete') { return; }
      const stashes = await listStashes();
      const entry = stashes.find((s) => s.ref === item.stashRef);
      if (!entry) {
        void vscode.window.showErrorMessage('Stasher: Could not locate stash entry.');
        return;
      }
      try {
        await deleteFilesFromStash(entry, [item.absolutePath]);
        provider.refresh();
        workingProvider.refresh();
        void vscode.window.showInformationMessage('Stasher: File removed from stash.');
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Stasher: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );

  // Merge with Another Stash…
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.mergeStash', async (item: StashTreeItem) => {
      if (!(item instanceof StashTreeItem)) { return; }
      const stashes = await listStashes();
      const others = stashes.filter((s) => s.ref !== item.stashEntry.ref);
      if (others.length === 0) {
        void vscode.window.showInformationMessage('Stasher: No other stashes to merge with.');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        others.map((s) => ({ label: s.ref, description: s.message, stash: s })),
        { placeHolder: 'Select stash to merge into this one' }
      );
      if (!pick) { return; }
      try {
        await withConflictHandling(() => mergeStashes(item.stashEntry, pick.stash));
        provider.refresh();
        workingProvider.refresh();
        void vscode.window.showInformationMessage('Stasher: Stashes merged.');
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Stasher: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );

  // Compare with Another Stash…
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.compareStash', async (item: StashTreeItem) => {
      if (!(item instanceof StashTreeItem)) { return; }
      const stashes = await listStashes();
      const others = stashes.filter((s) => s.ref !== item.stashEntry.ref);
      if (others.length === 0) {
        void vscode.window.showInformationMessage('Stasher: No other stashes to compare with.');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        others.map((s) => ({ label: s.ref, description: s.message, stash: s })),
        { placeHolder: 'Select stash to compare against' }
      );
      if (!pick) { return; }

      // Gather union of files from both stashes
      const [group1, group2] = await Promise.all([
        getStashFiles(item.stashEntry.ref),
        getStashFiles(pick.stash.ref),
      ]);
      const relPaths = new Set<string>();
      const repoRoot = getRepository()?.rootUri.fsPath ?? '';
      for (const f of [...group1.tracked, ...group1.untracked, ...group2.tracked, ...group2.untracked]) {
        relPaths.add(path.relative(repoRoot, f.uri.fsPath).replace(/\\/g, '/'));
      }
      if (relPaths.size === 0) {
        void vscode.window.showInformationMessage('Stasher: No files found in these stashes.');
        return;
      }
      const filePick = await vscode.window.showQuickPick(
        [...relPaths].map((r) => ({ label: path.basename(r), description: r })),
        { placeHolder: 'Select file to compare' }
      );
      if (!filePick) { return; }

      const api = getAPI();
      if (!api) { return; }
      const absPath = path.join(repoRoot, filePick.description!);
      const uri1 = api.toGitUri(vscode.Uri.file(absPath), item.stashEntry.ref);
      const uri2 = api.toGitUri(vscode.Uri.file(absPath), pick.stash.ref);
      void vscode.commands.executeCommand(
        'vscode.diff',
        uri1,
        uri2,
        `${filePick.label}: ${item.stashEntry.ref} ↔ ${pick.stash.ref}`
      );
    })
  );

  // Apply Hunks from Stash…
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.applyHunks', (item: StashFileTreeItem) => {
      if (!(item instanceof StashFileTreeItem)) { return; }
      const repo = getRepository();
      if (!repo) {
        void vscode.window.showErrorMessage('Stasher: No git repository found.');
        return;
      }
      openHunkPicker(item, repo.rootUri.fsPath);
    })
  );

  // 5. Initial refresh once git is ready
  provider.refresh();
  workingProvider.refresh();
}

// ─── Deactivation ─────────────────────────────────────────────────────────────

export function deactivate(): void {
  disposeHunkPicker();
  disposeGit();
}
