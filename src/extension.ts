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
  findDuplicateStashForPatch,
  stashFile,
  getStashStats,
  searchInStashes,
  duplicateStash,
  importPatchAsStash,
  getStashDiffVsWorkingTree,
  dispose as disposeGit,
} from './gitHelper';
import { StashTreeDataProvider, StashTreeItem, StashFileTreeItem } from './stashProvider';
import { WorkingChangesProvider, WorkingFileItem } from './workingChangesProvider';
import { showFileDiff, showWorkingDiff } from './diffViewer';
import { withConflictHandling } from './conflictHelper';
import { partialStashCommand } from './partialStash';
import { openHunkPicker, disposeHunkPicker } from './hunkPicker';
import { StashPeekProvider, peekStashFile } from './peekProvider';
import {
  getStashNote, setStashNote,
  isStashPinned, pinStash, unpinStash,
  isAutoRestore, setAutoRestore, getAutoRestoreHashes,
  getStashLabel, setStashLabel, LABEL_OPTIONS,
  type StashLabel,
} from './stashNotes';
import { logger } from './logger';
import { openTimeline, refreshTimeline } from './timelineView';
import { StashBranchGroupItem } from './stashProvider';
import { statusLabel } from './statusHelpers';

// ─── Activation ───────────────────────────────────────────────────────────────

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  logger.init();
  logger.info('Stasher activating');
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
      workingProvider.refresh();
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

        try {
          stashBranch(branchName.trim(), item.stashEntry.ref);
          provider.refresh();
          void vscode.window.showInformationMessage(
            `Stasher: Switched to new branch '${branchName}' with stash applied.`
          );
        } catch (err) {
          void vscode.window.showErrorMessage(
            `Stasher: Create branch failed — ${err instanceof Error ? err.message : String(err)}`
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

          try {
            stashFile(filePath, message || undefined);
            provider.refresh();
            workingProvider.refresh();
            void vscode.window.showInformationMessage('Stasher: New stash created with this file.');
          } catch (err) {
            void vscode.window.showErrorMessage(
              `Stasher: Failed to create stash — ${err instanceof Error ? err.message : String(err)}`
            );
          }
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
    vscode.commands.registerCommand('stasher.exportPatch', async (item: StashTreeItem, selectedItems?: any[]) => {
      const items = (selectedItems && selectedItems.length > 1)
        ? (selectedItems.filter((i) => i instanceof StashTreeItem) as StashTreeItem[])
        : (item instanceof StashTreeItem ? [item] : []);
      if (items.length === 0) { return; }

      if (items.length === 1) {
        // Single export
        const singleItem = items[0];
        let content: string;
        try {
          content = exportStashAsPatch(singleItem.stashEntry);
        } catch (err) {
          void vscode.window.showErrorMessage(`Stasher: ${err instanceof Error ? err.message : String(err)}`);
          return;
        }
        const saveUri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(`stash_${singleItem.stashEntry.index}.patch`),
          filters: { 'Patch files': ['patch'], 'All files': ['*'] },
        });
        if (!saveUri) { return; }
        try {
          fs.writeFileSync(saveUri.fsPath, content, { encoding: 'utf8' });
          void vscode.window.showInformationMessage(`Stasher: Patch saved to ${path.basename(saveUri.fsPath)}.`);
        } catch (err) {
          void vscode.window.showErrorMessage(`Stasher: Could not write patch — ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        // Multiple export
        const folderUris = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          title: 'Select Folder to Export Patches',
        });
        if (!folderUris || folderUris.length === 0) { return; }
        const outDir = folderUris[0].fsPath;

        let exported = 0;
        for (const i of items) {
          const defaultName = `stash_${i.stashEntry.index}.patch`;
          const filePath = path.join(outDir, defaultName);
          let content: string;
          try {
            content = exportStashAsPatch(i.stashEntry);
          } catch { continue; }

          if (fs.existsSync(filePath)) {
            const answer = await vscode.window.showWarningMessage(
              `Stasher: ${defaultName} already exists.`,
              { modal: true },
              'Overwrite', 'Skip'
            );
            if (answer === 'Skip') { continue; }
            if (answer !== 'Overwrite') { break; } // Cancelled
          }
          try {
            fs.writeFileSync(filePath, content, { encoding: 'utf8' });
            exported++;
          } catch { /* ignore */ }
        }
        void vscode.window.showInformationMessage(`Stasher: Exported ${exported} patch(es).`);
      }
    })
  );

  // Export Stashes as Patches (multi-select via QuickPick)
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.exportPatches', async () => {
      const stashes = listStashes();
      if (stashes.length === 0) {
        void vscode.window.showInformationMessage('Stasher: No stashes to export.');
        return;
      }

      const picks = await vscode.window.showQuickPick(
        stashes.map((s) => ({
          label: s.ref,
          description: s.message,
          picked: false,
          stash: s,
        })),
        {
          canPickMany: true,
          title: 'Export Stashes as Patches',
          placeHolder: 'Select stashes to export',
        }
      );
      if (!picks || picks.length === 0) { return; }

      if (picks.length === 1) {
        // Single — use save dialog
        const entry = picks[0].stash;
        let content: string;
        try {
          content = exportStashAsPatch(entry);
        } catch (err) {
          void vscode.window.showErrorMessage(`Stasher: ${err instanceof Error ? err.message : String(err)}`);
          return;
        }
        const saveUri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(`stash_${entry.index}.patch`),
          filters: { 'Patch files': ['patch'], 'All files': ['*'] },
        });
        if (!saveUri) { return; }
        try {
          fs.writeFileSync(saveUri.fsPath, content, { encoding: 'utf8' });
          void vscode.window.showInformationMessage(`Stasher: Patch saved to ${path.basename(saveUri.fsPath)}.`);
        } catch (err) {
          void vscode.window.showErrorMessage(`Stasher: Could not write patch — ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        // Multiple — pick a folder
        const folderUris = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          title: 'Select Folder to Export Patches',
        });
        if (!folderUris || folderUris.length === 0) { return; }
        const outDir = folderUris[0].fsPath;

        let exported = 0;
        for (const pick of picks) {
          const entry = pick.stash;
          const defaultName = `stash_${entry.index}.patch`;
          const filePath = path.join(outDir, defaultName);
          let content: string;
          try {
            content = exportStashAsPatch(entry);
          } catch { continue; }

          if (fs.existsSync(filePath)) {
            const answer = await vscode.window.showWarningMessage(
              `Stasher: ${defaultName} already exists.`,
              { modal: true },
              'Overwrite', 'Skip'
            );
            if (answer === 'Skip') { continue; }
            if (answer !== 'Overwrite') { break; }
          }
          try {
            fs.writeFileSync(filePath, content, { encoding: 'utf8' });
            exported++;
          } catch { /* ignore */ }
        }
        void vscode.window.showInformationMessage(`Stasher: Exported ${exported} patch(es).`);
      }
    })
  );

  // Unstash This File (inline on a stash file item)
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.unstashThisFile', async (item: StashFileTreeItem) => {
      if (!(item instanceof StashFileTreeItem)) { return; }
      const entry = listStashes().find((s) => s.ref === item.stashRef);
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
      const repoRoot = getRepository()?.rootUri.fsPath ?? '';
      const picks = await vscode.window.showQuickPick(
        allFiles.map((p) => ({
          label: path.relative(repoRoot, p) || path.basename(p),
          description: p,
          picked: false,
        })),
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
      const entry = listStashes().find((s) => s.ref === item.stashRef);
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

  // Delete Files from Stash… (multi-select with preview)
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.deleteFilesFromStash', async (item: StashTreeItem) => {
      if (!(item instanceof StashTreeItem)) { return; }
      const entry = item.stashEntry;
      const group = await getStashFiles(entry.ref);
      const allChanges = [...group.tracked, ...group.untracked];
      if (allChanges.length === 0) {
        void vscode.window.showInformationMessage('Stasher: No files found in this stash.');
        return;
      }

      const repoRoot = getRepository()?.rootUri.fsPath ?? '';
      const api = getAPI();

      // Build QuickPick items with status labels and detail
      interface FilePickItem extends vscode.QuickPickItem {
        filePath: string;
        changeUri: vscode.Uri;
        status: number;
      }

      const fileItems: FilePickItem[] = allChanges.map((change) => {
        const relPath = path.relative(repoRoot, change.uri.fsPath) || path.basename(change.uri.fsPath);
        const badge = statusLabel(change.status);
        return {
          label: `$(file) ${path.basename(change.uri.fsPath)}`,
          description: `[${badge}] ${relPath}`,
          filePath: change.uri.fsPath,
          changeUri: change.uri,
          status: change.status,
          picked: false,
        };
      });

      // Use a QuickPick with buttons for preview
      const qp = vscode.window.createQuickPick<FilePickItem>();
      qp.title = `Delete Files from "${entry.message}"`;
      qp.placeholder = 'Select files to remove from this stash (use the eye button to preview)';
      qp.items = fileItems;
      qp.canSelectMany = true;
      qp.buttons = [
        { iconPath: new vscode.ThemeIcon('eye'), tooltip: 'Preview selected file diff' },
      ];

      const result = await new Promise<FilePickItem[] | undefined>((resolve) => {
        qp.onDidTriggerButton(async () => {
          // Preview: show diff for the first selected item (or first item if none selected)
          const selected = qp.selectedItems.length > 0 ? qp.selectedItems : [fileItems[0]];
          const previewItem = selected[0];
          if (api && previewItem) {
            const tempItem = new StashFileTreeItem(previewItem.changeUri, previewItem.status, entry.ref, repoRoot);
            void showFileDiff(tempItem);
          }
        });
        qp.onDidAccept(() => {
          const picked = [...qp.selectedItems];
          qp.dispose();
          resolve(picked.length > 0 ? picked : undefined);
        });
        qp.onDidHide(() => {
          qp.dispose();
          resolve(undefined);
        });
        qp.show();
      });

      if (!result || result.length === 0) { return; }

      const confirm = await vscode.window.showWarningMessage(
        `Remove ${result.length} file(s) from "${entry.message}"? The stash will be re-created without these files.`,
        { modal: true },
        'Delete'
      );
      if (confirm !== 'Delete') { return; }

      try {
        await deleteFilesFromStash(entry, result.map((r) => r.filePath));
        provider.refresh();
        workingProvider.refresh();
        void vscode.window.showInformationMessage(`Stasher: ${result.length} file(s) removed from stash.`);
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
      const others = listStashes().filter((s) => s.ref !== item.stashEntry.ref);
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
      const others = listStashes().filter((s) => s.ref !== item.stashEntry.ref);
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
      let group1: Awaited<ReturnType<typeof getStashFiles>>;
      let group2: Awaited<ReturnType<typeof getStashFiles>>;
      try {
        [group1, group2] = await Promise.all([
          getStashFiles(item.stashEntry.ref),
          getStashFiles(pick.stash.ref),
        ]);
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Stasher: Could not read stash files — ${err instanceof Error ? err.message : String(err)}`
        );
        return;
      }
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

  // Show Stash Contents (file list QuickPick; click a file to open its diff)
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.showStashDetails', async (item: StashTreeItem) => {
      if (!(item instanceof StashTreeItem)) { return; }
      const api = getAPI();
      const repoRoot = getRepository()?.rootUri.fsPath ?? '';
      let tracked: Awaited<ReturnType<typeof getStashFiles>>['tracked'];
      let untracked: Awaited<ReturnType<typeof getStashFiles>>['untracked'];
      try {
        ({ tracked, untracked } = await getStashFiles(item.stashEntry.ref));
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Stasher: Could not read stash — ${err instanceof Error ? err.message : String(err)}`
        );
        return;
      }
      const allChanges = [...tracked, ...untracked];
      if (allChanges.length === 0) {
        void vscode.window.showInformationMessage(`Stasher: No files in ${item.stashEntry.ref}.`);
        return;
      }
      const picks = allChanges.map((f) => ({
        label: path.basename(f.uri.fsPath),
        description: path.relative(repoRoot, f.uri.fsPath),
        uri: f.uri,
      }));
      const selected = await vscode.window.showQuickPick(picks, {
        title: `${item.stashEntry.ref}: ${item.stashEntry.message} (${allChanges.length} file${allChanges.length === 1 ? '' : 's'})`,
        placeHolder: 'Select a file to view its diff — Escape to close',
      });
      if (!selected || !api) { return; }
      const stashUri = api.toGitUri(selected.uri, item.stashEntry.ref);
      const baseUri = api.toGitUri(selected.uri, `${item.stashEntry.ref}^1`);
      void vscode.commands.executeCommand(
        'vscode.diff',
        baseUri,
        stashUri,
        `${item.stashEntry.ref}: ${selected.label}`,
        { preview: true } satisfies vscode.TextDocumentShowOptions
      );
    })
  );

  // ── Filter Stashes (search bar for the Stashes panel) ────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.filterStashes', async () => {
      const q = await vscode.window.showInputBox({
        title: 'Filter Stashes',
        placeHolder: 'Search by message, branch, or ref… (leave empty to clear)',
        value: provider.filterQuery,
      });
      if (q === undefined) { return; } // cancelled
      provider.setFilter(q);
      void vscode.commands.executeCommand('setContext', 'stasher.hasFilter', provider.hasFilter);
    })
  );

  // ── Clear Filter ──────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.clearFilter', () => {
      provider.clearFilter();
      void vscode.commands.executeCommand('setContext', 'stasher.hasFilter', false);
    })
  );

  // ── Stash This File (always creates a NEW stash with just this file) ─────
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.stashThisFile', async (item: WorkingFileItem) => {
      if (!item?.change) { return; }
      const filePath = item.change.uri.fsPath;
      const message = await vscode.window.showInputBox({
        title: 'Stash This File',
        placeHolder: 'e.g. "WIP: auth changes" — leave empty for default',
        prompt: 'Optional: name for the new stash',
      });
      if (message === undefined) { return; } // cancelled
      try {
        stashFile(filePath, message || undefined);
        provider.refresh();
        workingProvider.refresh();
        void vscode.window.showInformationMessage('Stasher: File stashed.');
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Stasher: Stash file failed — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );

  // ── NEW: Stash Stats (show line change summary) ──────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.showStashStats', async (item: StashTreeItem) => {
      if (!(item instanceof StashTreeItem)) { return; }
      let stats;
      try {
        stats = getStashStats(item.stashEntry);
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Stasher: Stats failed — ${err instanceof Error ? err.message : String(err)}`
        );
        return;
      }
      if (stats.length === 0) {
        void vscode.window.showInformationMessage('Stasher: No file stats found.');
        return;
      }
      const totalAdded = stats.reduce((a, s) => a + s.added, 0);
      const totalRemoved = stats.reduce((a, s) => a + s.removed, 0);
      const lines = stats.map((s) => `$(diff-modified) ${s.file}  +${s.added} −${s.removed}`);
      lines.unshift(`**${item.stashEntry.ref}** — ${stats.length} file(s)  total +${totalAdded} −${totalRemoved}`, '');
      const panel = vscode.window.createOutputChannel('Stasher Stats');
      panel.clear();
      panel.appendLine(lines.join('\n'));
      panel.show(true);
      logger.info('showStashStats', { ref: item.stashEntry.ref, files: stats.length });
    })
  );

  // ── NEW: Search Inside Stashes ───────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.searchInStashes', async () => {
      const query = await vscode.window.showInputBox({
        title: 'Search Inside Stashes',
        placeHolder: 'e.g. "authService" or "TODO"',
        prompt: 'Search text across all stash contents (case-insensitive)',
      });
      if (!query?.trim()) { return; }
      logger.info('searchInStashes', { query });
      const matches = searchInStashes(query.trim());
      if (matches.length === 0) {
        void vscode.window.showInformationMessage(`Stasher: No matches found for "${query}".`);
        return;
      }
      const picks = matches.map((m) => ({
        label: `$(search) ${m.file}:${m.line}`,
        description: `${m.stashRef} — ${m.stashMessage}`,
        detail: m.text.trim(),
        match: m,
      }));
      const selected = await vscode.window.showQuickPick(picks, {
        title: `Search: "${query}" — ${matches.length} match(es)`,
        matchOnDescription: true,
        matchOnDetail: true,
      });
      if (!selected) { return; }
      const repoRoot = getRepository()?.rootUri.fsPath ?? '';
      const absPath = path.join(repoRoot, selected.match.file);
      const api = getAPI();
      if (!api) { return; }
      const stashUri = api.toGitUri(vscode.Uri.file(absPath), selected.match.stashRef);
      const baseUri  = api.toGitUri(vscode.Uri.file(absPath), `${selected.match.stashRef}^1`);
      void vscode.commands.executeCommand(
        'vscode.diff', baseUri, stashUri,
        `${selected.match.stashRef}: ${selected.match.file}`,
        { preview: true }
      );
    })
  );

  // ── NEW: Duplicate Stash ─────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.duplicateStash', async (item: StashTreeItem) => {
      if (!(item instanceof StashTreeItem)) { return; }
      try {
        await withConflictHandling(() => duplicateStash(item.stashEntry));
        provider.refresh();
        void vscode.window.showInformationMessage(
          `Stasher: Duplicated “${item.stashEntry.ref}”.`
        );
        logger.info('duplicateStash', { ref: item.stashEntry.ref });
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Stasher: Duplicate failed — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );

  // ── NEW: Import .patch as Stash ──────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.importPatch', async () => {
      const uris = await vscode.window.showOpenDialog({
        title: 'Import Patch(es) as Stash',
        filters: { 'Patch files': ['patch', 'diff'], 'All files': ['*'] },
        canSelectMany: true,
      });
      if (!uris || uris.length === 0) { return; }

      let imported = 0;
      let skipped = 0;

      try {
        for (const uri of uris) {
          const patchPath = uri.fsPath;
          const patchContent = fs.readFileSync(patchPath, 'utf8');

          // ── Duplicate detection ──────────────────────────────────────────
          const duplicate = findDuplicateStashForPatch(patchContent);
          if (duplicate) {
            const choice = await vscode.window.showWarningMessage(
              `"${path.basename(patchPath)}" matches existing stash "${duplicate.message}" (${duplicate.ref}).`,
              { modal: true },
              'Overwrite', 'Import as New', 'Skip'
            );
            if (!choice || choice === 'Skip') {
              skipped++;
              continue;
            }
            if (choice === 'Overwrite') {
              // Drop the existing stash, then import
              await dropStash(duplicate.index);
            }
            // 'Import as New' — just proceed normally
          }

          // ── Prompt for name (single file only) ───────────────────────────
          let message: string | undefined;
          if (uris.length === 1) {
            const input = await vscode.window.showInputBox({
              title: 'Import Patch — Stash Name',
              placeHolder: 'e.g. "imported: auth patch" — leave empty for default',
              prompt: 'Optional: name for the new stash',
            });
            if (input === undefined) { return; }
            message = input || undefined;
          } else {
            message = `imported: ${path.basename(patchPath)}`;
          }

          await importPatchAsStash(patchPath, message);
          logger.info('importPatch', { patchPath });
          imported++;
        }

        provider.refresh();
        workingProvider.refresh();

        const parts: string[] = [];
        if (imported > 0) { parts.push(`${imported} imported`); }
        if (skipped > 0) { parts.push(`${skipped} skipped`); }
        void vscode.window.showInformationMessage(`Stasher: ${parts.join(', ')}.`);
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Stasher: Import patch failed — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );

  // ── NEW: Peek File Content ───────────────────────────────────────────────
  const peekProvider = new StashPeekProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(StashPeekProvider.scheme, peekProvider)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.peekFile', async (item: StashFileTreeItem) => {
      if (!(item instanceof StashFileTreeItem)) { return; }
      const repo = getRepository();
      if (!repo) { return; }
      await peekStashFile(item, repo.rootUri.fsPath);
      logger.info('peekFile', { stashRef: item.stashRef, file: item.absolutePath });
    })
  );

  // ── NEW: Pin / Unpin Stash ───────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.pinStash', async (item: StashTreeItem) => {
      if (!(item instanceof StashTreeItem)) { return; }
      await pinStash(context, item.stashEntry.hash);
      provider.refresh();
      logger.info('pinStash', { ref: item.stashEntry.ref });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.unpinStash', async (item: StashTreeItem) => {
      if (!(item instanceof StashTreeItem)) { return; }
      await unpinStash(context, item.stashEntry.hash);
      provider.refresh();
      logger.info('unpinStash', { ref: item.stashEntry.ref });
    })
  );

  // ── NEW: Edit Stash Note ─────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.editStashNote', async (item: StashTreeItem) => {
      if (!(item instanceof StashTreeItem)) { return; }
      const current = getStashNote(context, item.stashEntry.hash);
      const note = await vscode.window.showInputBox({
        title: 'Edit Stash Note',
        value: current ?? '',
        placeHolder: 'e.g. "blocked on ticket #123" — leave empty to clear',
        prompt: 'Enter a note for this stash (stored locally, not in git)',
      });
      if (note === undefined) { return; }
      await setStashNote(context, item.stashEntry.hash, note);
      provider.refresh();
      logger.info('editStashNote', { ref: item.stashEntry.ref });
    })
  );

  // ── NEW: Toggle Auto-Restore at Startup ──────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.toggleAutoRestore', async (item: StashTreeItem) => {
      if (!(item instanceof StashTreeItem)) { return; }
      const current = isAutoRestore(context, item.stashEntry.hash);
      await setAutoRestore(context, item.stashEntry.hash, !current);
      void vscode.window.showInformationMessage(
        current
          ? `Stasher: Auto-restore disabled for “${item.stashEntry.ref}”.`
          : `Stasher: “${item.stashEntry.ref}” will be applied on next startup.`
      );
      logger.info('toggleAutoRestore', { ref: item.stashEntry.ref, enabled: !current });
    })
  );

  // ── NEW: Diff Stash vs Working Tree ──────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.diffVsWorkingTree', async (item: StashTreeItem) => {
      if (!(item instanceof StashTreeItem)) { return; }
      let changedFiles: string[];
      try {
        changedFiles = getStashDiffVsWorkingTree(item.stashEntry);
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Stasher: Diff failed — ${err instanceof Error ? err.message : String(err)}`
        );
        return;
      }
      if (changedFiles.length === 0) {
        void vscode.window.showInformationMessage(
          'Stasher: No differences between this stash and your working tree.'
        );
        return;
      }
      const repoRoot = getRepository()?.rootUri.fsPath ?? '';
      const api = getAPI();
      if (!api) { return; }
      const pick = await vscode.window.showQuickPick(
        changedFiles.map((f) => ({ label: path.basename(f), description: f, relPath: f })),
        { title: `Diff vs Working Tree — ${changedFiles.length} file(s) differ`, placeHolder: 'Select file to diff' }
      );
      if (!pick) { return; }
      const absPath = path.join(repoRoot, pick.relPath);
      const stashUri   = api.toGitUri(vscode.Uri.file(absPath), item.stashEntry.ref);
      const workingUri = vscode.Uri.file(absPath);
      void vscode.commands.executeCommand(
        'vscode.diff', stashUri, workingUri,
        `${item.stashEntry.ref} ↔ Working: ${pick.label}`,
        { preview: true }
      );
      logger.info('diffVsWorkingTree', { ref: item.stashEntry.ref, file: pick.relPath });
    })
  );

  // ── NEW: Stash & Switch Branch ───────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.showWorkingDiff', async (item: unknown) => {
      if (item instanceof WorkingFileItem) {
        await showWorkingDiff(item);
      }
    }),
    vscode.commands.registerCommand('stasher.stashAndSwitch', async () => {
      const repo = getRepository();
      if (!repo) {
        void vscode.window.showErrorMessage('Stasher: No git repository found.');
        return;
      }
      const branches = repo.state.refs
        .filter((r) => r.type === 0 /* Branch */ && r.name)
        .map((r) => ({ label: r.name!, description: r.commit?.substring(0, 7) }));
      if (branches.length === 0) {
        void vscode.window.showInformationMessage('Stasher: No branches found.');
        return;
      }
      const picked = await vscode.window.showQuickPick(branches, {
        title: 'Stash & Switch Branch',
        placeHolder: 'Select branch to switch to (changes will be stashed first)',
      });
      if (!picked) { return; }
      const message = await vscode.window.showInputBox({
        title: 'Stash & Switch — Stash Name',
        placeHolder: 'e.g. "WIP before switching" — leave empty for default',
      });
      if (message === undefined) { return; }
      try {
        await createStash(message || undefined, true);
        await repo.checkout(picked.label);
        provider.refresh();
        workingProvider.refresh();
        void vscode.window.showInformationMessage(
          `Stasher: Stashed changes and switched to “${picked.label}”.`
        );
        logger.info('stashAndSwitch', { branch: picked.label });
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Stasher: Stash & switch failed — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );

  // ── Auto-restore: apply pinned auto-restore stashes on activation ────────
  const autoRestoreHashes = getAutoRestoreHashes(context);
  if (autoRestoreHashes.size > 0) {
    const stashes = listStashes();
    const toRestore = stashes.filter((s) => autoRestoreHashes.has(s.hash));
    for (const stash of toRestore) {
      const answer = await vscode.window.showInformationMessage(
        `Stasher: Auto-restore — apply stash “${stash.message}”?`,
        'Apply', 'Skip'
      );
      if (answer === 'Apply') {
        try {
          await withConflictHandling(() => applyStash(stash.index));
          provider.refresh();
          workingProvider.refresh();
          logger.info('autoRestore applied', { ref: stash.ref });
        } catch (err) {
          void vscode.window.showErrorMessage(
            `Stasher: Auto-restore failed — ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }
  }

  // ── NEW: Set Stash Label ────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.setStashLabel', async (item: StashTreeItem) => {
      if (!(item instanceof StashTreeItem)) { return; }
      const current = getStashLabel(context, item.stashEntry.hash);
      const picks: vscode.QuickPickItem[] = [
        { label: '$(close) Clear label', description: 'none' },
        ...LABEL_OPTIONS,
      ];
      const pick = await vscode.window.showQuickPick(picks, {
        title: `Label stash: ${item.stashEntry.ref}`,
        placeHolder: current ? `Current: ${current}` : 'Choose a colour label',
      });
      if (!pick) { return; }
      const newLabel = pick.description === 'none' ? undefined : pick.description as StashLabel;
      await setStashLabel(context, item.stashEntry.hash, newLabel);
      provider.refresh();
      refreshTimeline(context);
      logger.info('setStashLabel', { ref: item.stashEntry.ref, label: newLabel });
    })
  );

  // ── NEW: Open Stash Timeline ────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.openTimeline', () => {
      openTimeline(context);
    })
  );

  // ── NEW: Toggle Group By Branch ─────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.toggleGroupByBranch', async () => {
      const cfg = vscode.workspace.getConfiguration('stasher');
      const current = cfg.get<boolean>('groupByBranch', false);
      await cfg.update('groupByBranch', !current, vscode.ConfigurationTarget.Workspace);
      provider.refresh();
    })
  );

  // ── NEW: Toggle Group Files by Directory ────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('stasher.toggleGroupByDir', async () => {
      const cfg = vscode.workspace.getConfiguration('stasher');
      const current = cfg.get<boolean>('groupFilesByDirectory', false);
      await cfg.update('groupFilesByDirectory', !current, vscode.ConfigurationTarget.Workspace);
      provider.refresh();
    })
  );

  // Hook timeline refresh into every stash refresh
  const _origRefresh = provider.refresh.bind(provider);
  provider.refresh = () => { _origRefresh(); refreshTimeline(context); };

  // 5. Initial refresh once git is ready
  provider.refresh();
  workingProvider.refresh();
}

// ─── Deactivation ─────────────────────────────────────────────────────────────

export function deactivate(): void {
  disposeHunkPicker();
  disposeGit();
  logger.dispose();
}
