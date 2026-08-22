export interface FilterableCommand {
  id?: string;
  label: string;
  category?: string;
}

/** Word-aware filter used by the command palette. */
export function filterCommands<T extends FilterableCommand>(commands: T[], query: string): T[] {
  return filterCommandsByWords(commands, query);
}

/** Word-aware filter: every word must appear in the label or category. */
export function filterCommandsByWords<T extends FilterableCommand>(commands: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return commands;
  return commands.filter((cmd) => {
    const haystack = `${cmd.id || ""} ${cmd.label} ${cmd.category || ""}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** Primary keyboard modifier label for the current platform. */
export function getPrimaryModifierLabel(platform: string): "⌘" | "Ctrl" {
  return platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl";
}
