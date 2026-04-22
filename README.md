# Stasher

Stasher is a Visual Studio Code extension for managing Git stashes from the Activity Bar without dropping to the terminal. It gives you a visual workflow for creating, browsing, updating, comparing, and restoring stashes directly inside VS Code.

## Features

- Create named or unnamed stashes from the sidebar
- Partially stash selected files from your working tree
- Browse existing stashes and inspect the files inside them
- Apply, pop, rename, or delete stashes
- Create a branch from a stash
- Add more files into an existing stash
- Compare stashes and view per-file diffs
- Export a stash as a `.patch` file
- Unstash specific files or apply selected hunks

## Views

Stasher adds an Activity Bar container with two views:

- `Working Changes`: shows the current repository changes and supports checkbox-based partial stashing
- `Stashes`: lists available stashes and the files contained in each stash

## Requirements

- VS Code `1.85.0` or newer
- Git available on your system
- A workspace folder opened in VS Code that is backed by Git

## Common Actions

Use the Stasher sidebar to:

- `Create Stash`
- `Partial Stash...`
- `Quick Stash`
- `Apply Stash`
- `Pop Stash`
- `Create Branch from Stash...`
- `Unstash Files...`
- `Merge with Another Stash...`
- `Compare with Another Stash...`

Most actions are available from the view toolbar or from item context menus in the tree.

## Development

```bash
npm install
npm run build
```

Helpful scripts:

- `npm run build` builds the extension with esbuild
- `npm run watch` rebuilds on file changes
- `npm run typecheck` runs TypeScript type-checking without emitting files

To package for publishing, run the normal VS Code extension publishing flow after building.

## License

MIT
