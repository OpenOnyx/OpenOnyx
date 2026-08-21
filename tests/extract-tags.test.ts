import { describe, expect, it } from "vitest";
import { FileSystemManager } from "../electron/fileSystem";

describe("tag extraction", () => {
  const fsManager = new FileSystemManager();

  it("collects unique tags and ignores the hash", () => {
    expect(fsManager.extractTags("hello #project and #project and #note-taking")).toEqual([
      "project",
      "note-taking",
    ]);
  });

  it("does not treat multi-hash headings as tags", () => {
    expect(fsManager.extractTags("## Title\n\nbody")).toEqual([]);
  });
});
