import { describe, expect, it } from "vitest";
import { computeLineDiff, computeTokenDiff, generateDiffMarkdown } from "../src/utils/diff";

describe("diff", () => {
  it("marks changed tokens", () => {
    const words = computeTokenDiff("hello world", "hello there");
    expect(words.some((w) => w.type === "removed" && w.content === "world")).toBe(true);
    expect(words.some((w) => w.type === "added" && w.content === "there")).toBe(true);
  });

  it("groups a similar line as modified", () => {
    const lines = computeLineDiff("alpha beta", "alpha gamma");
    expect(lines.some((line) => line.type === "modified")).toBe(true);
  });

  it("renders added and removed markdown", () => {
    const md = generateDiffMarkdown("keep\nold", "keep\nnew");
    expect(md).toContain("keep");
    expect(md).toContain("<ins");
    expect(md).toContain("<del");
  });
});
