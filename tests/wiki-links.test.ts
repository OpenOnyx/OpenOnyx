import { describe, expect, it } from "vitest";
import { filterWikiLinkNotes, rewriteWikiLinks } from "../src/utils/wikiLinks";

describe("wiki links", () => {
  it("rewrites simple links, headings, and aliases", () => {
    const source = "See [[Old]] and [[Old#Intro]] and [[Old|alias]]. Leave [[Oldest]] alone.";
    const next = rewriteWikiLinks(source, "Old", "New");
    expect(next).toContain("[[New]]");
    expect(next).toContain("[[New#Intro]]");
    expect(next).toContain("[[New|alias]]");
    expect(next).toContain("[[Oldest]]");
  });

  it("is a no-op when the names match or the old name is empty", () => {
    expect(rewriteWikiLinks("[[A]]", "A", "A")).toBe("[[A]]");
    expect(rewriteWikiLinks("[[A]]", "", "B")).toBe("[[A]]");
  });

  it("ranks exact and prefix note matches first", () => {
    const notes = [
      { name: "Project Plan", path: "Projects/Project Plan.md" },
      { name: "Plan", path: "Plan.md" },
      { name: "Other", path: "Inbox/Other.md" },
    ];
    expect(filterWikiLinkNotes(notes, "plan").map((n) => n.name)).toEqual([
      "Plan",
      "Project Plan",
    ]);
  });
});
