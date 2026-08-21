export interface FilterableCommand {
  label: string;
  category?: string;
}

/** Substring filter used by the command palette. */
export function filterCommands<T extends FilterableCommand>(commands: T[], query: string): T[] {
  if (!query.trim()) return commands;
  const q = query.toLowerCase();
  return commands.filter(
    (cmd) =>
      cmd.label.toLowerCase().includes(q) ||
      (cmd.category && cmd.category.toLowerCase().includes(q)),
  );
}

/** Word-aware filter: every word must appear in the label or category. */
export function filterCommandsByWords<T extends FilterableCommand>(commands: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return commands;
  return commands.filter((cmd) => {
    const haystack = `${cmd.label} ${cmd.category || ""}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
