import { Status } from './gitEnums';

export interface ParsedStashFile {
  statusChar: string;
  path: string;
  oldPath?: string;
}

/** Parses one line from `git stash show --name-status`. */
export function parseStashNameStatusLine(line: string): ParsedStashFile | undefined {
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }
  const tab = trimmed.indexOf('\t');
  if (tab < 0) {
    return undefined;
  }
  const statusPart = trimmed.slice(0, tab);
  const pathsPart = trimmed.slice(tab + 1);
  const statusChar = statusPart.charAt(0);
  if (statusChar === 'R' || statusChar === 'C') {
    const paths = pathsPart.split('\t');
    if (paths.length < 2) {
      return undefined;
    }
    return { statusChar, path: paths[1], oldPath: paths[0] };
  }
  return { statusChar, path: pathsPart };
}

/** Parses stdout from `git stash show --name-status [--include-untracked]`. */
export function parseStashShowNameStatus(stdout: string): ParsedStashFile[] {
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(parseStashNameStatusLine)
    .filter((entry): entry is ParsedStashFile => entry !== undefined);
}

export function mapStashStatusChar(statusChar: string): Status {
  switch (statusChar) {
    case 'A':
      return Status.INDEX_ADDED;
    case 'M':
      return Status.MODIFIED;
    case 'D':
      return Status.DELETED;
    case 'R':
      return Status.INDEX_RENAMED;
    case 'C':
      return Status.INDEX_COPIED;
    default:
      return Status.MODIFIED;
  }
}
