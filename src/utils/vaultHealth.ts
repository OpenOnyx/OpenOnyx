import type { FileEntry } from "../types";

export type VaultHealthIssueSeverity = "info" | "warning" | "danger";

export interface VaultHealthIssue {
  id: string;
  severity: VaultHealthIssueSeverity;
  title: string;
  detail: string;
  path?: string;
}

export interface VaultHealthReport {
  noteCount: number;
  attachmentCount: number;
  brokenLinkCount: number;
  duplicateTitleCount: number;
  emptyNoteCount: number;
  largeNoteCount: number;
  orphanAttachmentCount: number;
  issues: VaultHealthIssue[];
}

type VaultHealthFile = {
  path: string;
  name: string;
  extension: string;
  size: number;
  isDirectory: boolean;
};

const ATTACHMENT_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".jpeg",
  ".jpg",
  ".m4a",
  ".mov",
  ".mp3",
  ".mp4",
  ".ogg",
  ".pdf",
  ".png",
  ".svg",
  ".wav",
  ".webm",
  ".webp",
]);

function flattenFiles(fileTree: FileEntry[]): VaultHealthFile[] {
  const files: VaultHealthFile[] = [];
  const walk = (entries: FileEntry[]) => {
    for (const entry of entries) {
      if (entry.isDirectory) {
        walk(entry.children || []);
      } else {
        files.push({
          path: entry.path,
          name: entry.name,
          extension: (entry.extension || "").toLowerCase(),
          size: entry.size || 0,
          isDirectory: false,
        });
      }
    }
  };
  walk(fileTree);
  return files;
}

function titleFromPath(path: string): string {
  return path.split("/").pop()?.replace(/\.[^.]+$/, "") || path;
}

function normalizeWikiTarget(target: string): string {
  return target
    .split("#")[0]
    .split("|")[0]
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

function extractWikiTargets(markdown: string): string[] {
  const targets: string[] = [];
  const re = /!?\[\[([^\]]+)]]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    const target = normalizeWikiTarget(match[1]);
    if (target) targets.push(target);
  }
  return [...new Set(targets)];
}

function extractAttachmentReferences(markdown: string): string[] {
  const refs = new Set<string>();
  for (const target of extractWikiTargets(markdown)) refs.add(target.toLowerCase());
  const mdLinkRe = /!?\[[^\]]*]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = mdLinkRe.exec(markdown)) !== null) {
    const raw = decodeURIComponent(match[1].split("#")[0].trim()).replace(/^<|>$/g, "");
    if (raw && !/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
      refs.add(raw.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase());
      refs.add((raw.split("/").pop() || raw).toLowerCase());
    }
  }
  return [...refs];
}

export async function buildVaultHealthReport(
  fileTree: FileEntry[],
  readFile: (path: string) => Promise<string | null>,
): Promise<VaultHealthReport> {
  const files = flattenFiles(fileTree);
  const notes = files.filter((file) => file.extension === ".md");
  const attachments = files.filter((file) => ATTACHMENT_EXTENSIONS.has(file.extension));
  const noteByPath = new Set(notes.map((note) => note.path.toLowerCase()));
  const noteByTitle = new Map<string, VaultHealthFile[]>();
  const attachmentRefs = new Set<string>();
  const issues: VaultHealthIssue[] = [];

  for (const note of notes) {
    const title = titleFromPath(note.path).toLowerCase();
    const group = noteByTitle.get(title) || [];
    group.push(note);
    noteByTitle.set(title, group);
  }

  for (const [title, group] of noteByTitle.entries()) {
    if (group.length <= 1) continue;
    issues.push({
      id: `duplicate-title:${title}`,
      severity: "warning",
      title: "Duplicate note title",
      detail: group.map((note) => note.path).join(", "),
      path: group[0].path,
    });
  }

  for (const note of notes) {
    const content = await readFile(note.path).catch(() => null);
    if (content === null) continue;

    if (content.trim().length === 0) {
      issues.push({
        id: `empty:${note.path}`,
        severity: "info",
        title: "Empty note",
        detail: "This note has no searchable content yet.",
        path: note.path,
      });
    }

    if (note.size > 500_000) {
      issues.push({
        id: `large:${note.path}`,
        severity: "warning",
        title: "Large note",
        detail: `${Math.round(note.size / 1024)} KB may be slow to preview, index, or sync.`,
        path: note.path,
      });
    }

    for (const ref of extractAttachmentReferences(content)) {
      attachmentRefs.add(ref);
    }

    for (const target of extractWikiTargets(content)) {
      const hasExtension = /\.[a-z0-9]+$/i.test(target);
      const candidatePath = hasExtension ? target : `${target}.md`;
      const targetTitle = titleFromPath(target).toLowerCase();
      const existsByPath = noteByPath.has(candidatePath.toLowerCase());
      const existsByTitle = noteByTitle.has(targetTitle);
      const attachmentExists = attachments.some((file) =>
        file.path.toLowerCase() === target.toLowerCase() ||
        file.name.toLowerCase() === target.toLowerCase(),
      );
      if (!existsByPath && !existsByTitle && !attachmentExists) {
        issues.push({
          id: `broken-link:${note.path}:${target}`,
          severity: "danger",
          title: "Broken wiki link",
          detail: `[[${target}]] does not match a note or attachment.`,
          path: note.path,
        });
      }
    }
  }

  for (const attachment of attachments) {
    const lowerPath = attachment.path.toLowerCase();
    const lowerName = attachment.name.toLowerCase();
    if (!attachmentRefs.has(lowerPath) && !attachmentRefs.has(lowerName)) {
      issues.push({
        id: `orphan-attachment:${attachment.path}`,
        severity: "info",
        title: "Unreferenced attachment",
        detail: "No Markdown note appears to link to this file.",
        path: attachment.path,
      });
    }
  }

  return {
    noteCount: notes.length,
    attachmentCount: attachments.length,
    brokenLinkCount: issues.filter((issue) => issue.id.startsWith("broken-link:")).length,
    duplicateTitleCount: issues.filter((issue) => issue.id.startsWith("duplicate-title:")).length,
    emptyNoteCount: issues.filter((issue) => issue.id.startsWith("empty:")).length,
    largeNoteCount: issues.filter((issue) => issue.id.startsWith("large:")).length,
    orphanAttachmentCount: issues.filter((issue) => issue.id.startsWith("orphan-attachment:")).length,
    issues,
  };
}
