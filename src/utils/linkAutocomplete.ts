/**
 * Link Autocomplete Extension for CodeMirror 6
 *
 * Provides autocomplete suggestions when typing [[ for wiki links.
 * Shows matching note names from the vault.
 */

import {
  CompletionContext,
  CompletionResult,
  autocompletion,
  Completion,
} from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { filterWikiLinkNotes } from "./wikiLinks";

interface NoteInfo {
  name: string;
  path: string;
}

// Store for available notes - updated by the component
let availableNotes: NoteInfo[] = [];

export function setAvailableNotes(notes: NoteInfo[]) {
  availableNotes = notes;
}

// Helper to extract folder location from file path
function getNoteLocation(path: string): string {
  const parts = path.split("/");
  if (parts.length > 1) {
    parts.pop(); // Remove filename
    return parts.join("/");
  }
  return "Vault root";
}

// Completion function for wiki links
function wikiLinkCompletion(
  context: CompletionContext,
): CompletionResult | null {
  // Look for [[ pattern before cursor
  const before = context.matchBefore(/\[\[([^\]#|]*)/);

  if (!before) return null;

  // Check if closing brackets ]] exist immediately after cursor
  const afterCursor = context.state.doc.sliceString(
    context.pos,
    context.pos + 2,
  );
  const hasClosingBrackets = afterCursor.startsWith("]]");

  const query = before.text.slice(2).trim().toLowerCase(); // Remove [[
  const from = before.from + 2; // Position after [[

  let matches = filterWikiLinkNotes(availableNotes, query).map((note) => ({ note }));

  if (matches.length === 0 && query.length > 0) {
    // Offer to create a new note
    return {
      from,
      to: context.pos,
      options: [
        {
          label: query,
          detail: "(create new note)",
          type: "text",
          apply: (
            view: EditorView,
            completion: Completion,
            from: number,
            to: number,
          ) => {
            const endPos = hasClosingBrackets ? context.pos + 2 : to;
            const insert = query + "]]";
            view.dispatch({
              changes: { from, to: endPos, insert },
              selection: { anchor: from + insert.length },
            });
          },
          boost: -1,
        },
      ],
    };
  }

  // Count occurrence of names to handle duplicate note names across folders
  const nameCounts = new Map<string, number>();
  availableNotes.forEach((n) => {
    const key = n.name.toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  });

  const options: Completion[] = matches.map(({ note }) => {
    const location = getNoteLocation(note.path);
    const isDuplicate = (nameCounts.get(note.name.toLowerCase()) || 0) > 1;
    const insertText = isDuplicate
      ? note.path.replace(/\.(md|canvas)$/i, "")
      : note.name;

    return {
      label: note.name,
      detail: location,
      type: "text",
      apply: (
        view: EditorView,
        completion: Completion,
        from: number,
        to: number,
      ) => {
        // If closing ]] already exists right after cursor, replace up to after ]]
        const replaceTo = hasClosingBrackets ? context.pos + 2 : to;
        const insert = insertText + "]]";
        view.dispatch({
          changes: { from, to: replaceTo, insert },
          selection: { anchor: from + insert.length },
        });
      },
    };
  });

  return {
    from,
    to: context.pos,
    options,
    validFor: /^[^\]#|]*$/,
  };
}

// Header completion for [[note#heading]] syntax
function headerCompletion(context: CompletionContext): CompletionResult | null {
  const before = context.matchBefore(/\[\[([^\]#]+)#([^\]]*)/);

  if (!before) return null;

  // Extract note name and partial heading
  const match = before.text.match(/\[\[([^\]#]+)#([^\]]*)/);
  if (!match) return null;

  const noteName = match[1];
  const headingQuery = match[2].toLowerCase();
  const from = before.from + 2 + noteName.length + 1; // After [[notename#

  // Find the note and extract its headings
  const note = availableNotes.find(
    (n) => n.name.toLowerCase() === noteName.toLowerCase(),
  );
  if (!note) return null;

  // For now, return a placeholder - actual heading extraction would need async file reading
  return {
    from,
    options: [
      {
        label: "Loading headings...",
        type: "text",
        apply: "",
      },
    ],
  };
}

// Tag autocomplete for #tags
function tagCompletion(context: CompletionContext): CompletionResult | null {
  const before = context.matchBefore(/#[a-zA-Z0-9_/-]*/);

  if (!before || before.text.length < 2) return null;

  const query = before.text.slice(1).toLowerCase();
  const from = before.from + 1;

  // Get unique tags from all notes (would need to be populated separately)
  // For now, just return empty - this would be populated from vault scan
  return null;
}

// Create the autocomplete extension
export function linkAutocomplete() {
  return autocompletion({
    override: [wikiLinkCompletion],
    activateOnTyping: true,
    maxRenderedOptions: 30,
    defaultKeymap: true,
    icons: false,
  });
}

// CSS styles for the autocomplete dropdown
export const linkAutocompleteTheme = EditorView.theme({
  ".cm-tooltip-autocomplete": {
    backgroundColor: "var(--bg-elevated, var(--bg-secondary))",
    border: "1px solid var(--border-medium)",
    borderRadius: "var(--radius-md, 8px)",
    boxShadow: "var(--shadow-lg, 0 10px 25px -5px rgba(0, 0, 0, 0.3))",
    maxHeight: "320px",
    minWidth: "280px",
    overflow: "auto",
    padding: "4px",
  },
  ".cm-tooltip-autocomplete ul": {
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-sm, 13px)",
    padding: "0",
    margin: "0",
    listStyle: "none",
  },
  ".cm-tooltip-autocomplete li": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 10px",
    borderRadius: "var(--radius-sm, 4px)",
    cursor: "pointer",
    transition: "background-color 0.1s ease",
  },
  ".cm-tooltip-autocomplete li:last-child": {
    borderBottom: "none",
  },
  ".cm-tooltip-autocomplete li[aria-selected]": {
    backgroundColor: "var(--bg-active, var(--interactive-accent))",
  },
  ".cm-completionLabel": {
    color: "var(--text-primary)",
    fontWeight: "500",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  ".cm-completionDetail": {
    color: "var(--text-muted)",
    fontSize: "11px",
    marginLeft: "12px",
    opacity: "0.8",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "180px",
    textAlign: "right",
  },
  ".cm-tooltip-autocomplete li[aria-selected] .cm-completionDetail": {
    color: "var(--text-secondary)",
    opacity: "1",
  },
});

