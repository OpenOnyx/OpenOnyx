import { describe, expect, it } from "vitest";
import { SearchEngine } from "../electron/search";

describe("SearchEngine", () => {
  it("returns nothing before an index exists", () => {
    expect(new SearchEngine().search("hello")).toEqual([]);
  });

  it("ranks note names above body text", () => {
    const engine = new SearchEngine();
    engine.loadDocuments([
      { path: "Inbox.md", name: "Inbox", content: "random words", tags: [] },
      { path: "Systems/Locks.md", name: "Locks", content: "deadlock and mutex", tags: ["systems"] },
    ]);

    const hits = engine.search("Locks");
    expect(hits[0]?.path).toBe("Systems/Locks.md");
  });

  it("finds notes by tag and content", () => {
    const engine = new SearchEngine();
    engine.loadDocuments([
      { path: "A.md", name: "A", content: "nothing", tags: ["project"] },
      { path: "B.md", name: "B", content: "deadlock prevention", tags: [] },
    ]);
    expect(engine.search("project").some((hit) => hit.path === "A.md")).toBe(true);
    expect(engine.search("deadlock").some((hit) => hit.path === "B.md")).toBe(true);
  });

  it("updates and removes a single document without a full vault scan", () => {
    const engine = new SearchEngine();
    engine.loadDocuments([
      { path: "A.md", name: "A", content: "alpha", tags: [] },
    ]);
    engine.upsertDocument({ path: "A.md", name: "A", content: "beta unique-token", tags: [] });
    expect(engine.search("unique-token")).toHaveLength(1);
    expect(engine.search("alpha")).toHaveLength(0);

    engine.removeDocument("A.md");
    expect(engine.search("unique-token")).toHaveLength(0);
  });

  it("ignores blank queries", () => {
    const engine = new SearchEngine();
    engine.loadDocuments([{ path: "A.md", name: "A", content: "hello", tags: [] }]);
    expect(engine.search("   ")).toEqual([]);
  });
});
