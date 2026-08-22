// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseFrontmatter, updateFrontmatter } from "../../src/utils/frontmatter";
import { countWords, getNoteName, processWikiLinks } from "../../src/utils/helpers";
import { rewriteWikiLinks } from "../../src/utils/wikiLinks";
import { SearchEngine } from "../../electron/search";
import { FileSystemManager } from "../../electron/fileSystem";
import { parseCanvasDocument } from "../../src/components/canvas/canvasDocument";

/**
 * End-to-end style workflow against the same helpers the app uses.
 * This does not launch Electron; it walks create → link → search → rename.
 */
describe("vault note workflow", () => {
  it("creates, links, finds, and renames a note", () => {
    const vault: Record<string, string> = {
      "Inbox/Idea.md": "---\ntags:\n  - inbox\n---\nCapture [[Project Plan]] later.\n",
      "Projects/Project Plan.md": "# Plan\n\nShip the first version.\n",
    };

    const idea = parseFrontmatter(vault["Inbox/Idea.md"]);
    expect(idea.properties.find((p) => p.key === "tags")?.value).toEqual(["inbox"]);
    expect(processWikiLinks(vault["Inbox/Idea.md"])).toContain("Project Plan");

    const fsManager = new FileSystemManager();
    const engine = new SearchEngine();
    engine.loadDocuments(
      Object.entries(vault).map(([path, content]) => ({
        path,
        name: getNoteName(path),
        content,
        tags: fsManager.extractTags(content),
      })),
    );
    expect(engine.search("Plan")[0]?.path).toBe("Projects/Project Plan.md");

    const renamed: Record<string, string> = {};
    for (const [path, content] of Object.entries(vault)) {
      renamed[path === "Projects/Project Plan.md" ? "Projects/Roadmap.md" : path] =
        rewriteWikiLinks(content, "Project Plan", "Roadmap");
    }
    expect(renamed["Inbox/Idea.md"]).toContain("[[Roadmap]]");
    expect(renamed["Projects/Roadmap.md"]).toContain("Ship the first version");

    expect(countWords(renamed["Projects/Roadmap.md"])).toBeGreaterThan(2);
  });

  it("indexes a new daily note and a canvas in one pass", () => {
    const daily = updateFrontmatter("# 2026-08-20\n\nWrote tests.", {
      date: "2026-08-20",
      tags: ["daily"],
    });
    expect(daily).toContain("date: 2026-08-20");

    const canvas = parseCanvasDocument(JSON.stringify({
      nodes: [{ id: "n1", type: "file", x: 0, y: 0, width: 280, height: 180, file: "Inbox/Idea.md" }],
      edges: [],
    }));
    expect(canvas.data.nodes[0]).toMatchObject({ type: "file", file: "Inbox/Idea.md" });
  });
});
