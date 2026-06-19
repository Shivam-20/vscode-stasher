/** Strip git's default "WIP on branch:" / "On branch:" prefix from a stash subject. */
export function stripStashBranchPrefix(message: string): string {
  const match = message.match(/^(?:WIP on|On) ([^:]+):\s*(.*)$/);
  if (!match) { return message; }
  const rest = match[2];
  if (rest.length > 0) { return rest; }
  return message.startsWith('WIP') ? 'WIP' : message;
}
