/** Rewrite [[OldName]], [[OldName#heading]], and [[OldName|alias]] after a rename. */
export function rewriteWikiLinks(text: string, oldName: string, newName: string): string {
  if (!oldName || oldName === newName) return text;
  const escapedOldName = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wikiLinkPattern = new RegExp(`\\[\\[${escapedOldName}([|#\\]])`, "g");
  return text.replace(wikiLinkPattern, `[[${newName}$1`);
}

export interface WikiNoteInfo {
  name: string;
  path: string;
}

export function filterWikiLinkNotes(notes: WikiNoteInfo[], query: string): WikiNoteInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return notes.slice(0, 30);
  return notes
    .filter((note) => note.name.toLowerCase().includes(q) || note.path.toLowerCase().includes(q))
    .sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      const aScore = aName === q ? 0 : aName.startsWith(q) ? 1 : aName.includes(q) ? 2 : 3;
      const bScore = bName === q ? 0 : bName.startsWith(q) ? 1 : bName.includes(q) ? 2 : 3;
      return aScore - bScore || a.name.localeCompare(b.name);
    })
    .slice(0, 30);
}
