import { describe, expect, it } from "vitest";
import { buildVaultHealthReport } from "../src/utils/vaultHealth";
import type { FileEntry } from "../src/types";

function file(path: string, size: number): FileEntry {
  const name = path.split("/").pop() || path;
  return {
    name,
    path,
    absolutePath: `/vault/${path}`,
    isDirectory: false,
    extension: name.includes(".") ? `.${name.split(".").pop()}` : "",
    modifiedAt: Date.now(),
    size,
  };
}

describe("vault health report", () => {
  it("detects broken links, duplicate titles, empty notes, and orphan attachments", async () => {
    const tree: FileEntry[] = [
      file("A.md", 36),
      file("Folder/A.md", 12),
      file("Empty.md", 0),
      file("media/unused.png", 100),
      file("media/used.png", 100),
    ];
    const content: Record<string, string> = {
      "A.md": "Link to [[Missing]] and ![[used.png]]",
      "Folder/A.md": "duplicate title",
      "Empty.md": "   ",
    };

    const report = await buildVaultHealthReport(tree, async (path) => content[path] || "");

    expect(report.noteCount).toBe(3);
    expect(report.attachmentCount).toBe(2);
    expect(report.brokenLinkCount).toBe(1);
    expect(report.duplicateTitleCount).toBe(1);
    expect(report.emptyNoteCount).toBe(1);
    expect(report.orphanAttachmentCount).toBe(1);
    expect(report.issues.map((issue) => issue.title)).toContain("Broken wiki link");
  });
});
