import { describe, expect, it } from "vitest";
import { generateDeterministicId, looksLikeUuid } from "../src/utils/space-ids";

describe("generateDeterministicId", () => {
  it("is stable for the same space and path", () => {
    const a = generateDeterministicId("space-1", "Notes/Hello.md");
    const b = generateDeterministicId("space-1", "Notes/Hello.md");
    expect(a).toBe(b);
    expect(looksLikeUuid(a)).toBe(true);
  });

  it("changes when the space or path changes", () => {
    const base = generateDeterministicId("space-1", "Notes/Hello.md");
    expect(generateDeterministicId("space-2", "Notes/Hello.md")).not.toBe(base);
    expect(generateDeterministicId("space-1", "Notes/Other.md")).not.toBe(base);
  });

  it("documents that similar paths can theoretically collide", () => {
    const ids = new Set<string>();
    const paths = [
      "Note.md",
      "Note2.md",
      "a/Note.md",
      "ab/Note.md",
      "Notes/Hello.md",
      "Notes/Hello 2.md",
      "00 - Inbox/Quick Notes.md",
    ];
    for (const path of paths) {
      ids.add(generateDeterministicId("space-1", path));
    }
    expect(ids.size).toBe(paths.length);
  });
});
