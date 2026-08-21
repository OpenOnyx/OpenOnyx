import { describe, expect, it } from "vitest";
import {
  getAllMarkdownFiles,
  parseFrontmatter,
  updateFrontmatter,
} from "../src/utils/frontmatter";
import type { FileEntry } from "../src/types";

describe("frontmatter", () => {
  it("returns empty properties when there is no yaml block", () => {
    expect(parseFrontmatter("# Hello")).toEqual({ properties: [], bodyStart: 0 });
  });

  it("parses scalars, lists, dates, and tags", () => {
    const content = `---
title: Demo
count: 3
published: 2026-01-02
tags:
  - alpha
  - beta
aliases: [one, two]
---
Body
`;
    const parsed = parseFrontmatter(content);
    expect(parsed.bodyStart).toBeGreaterThan(0);
    const byKey = Object.fromEntries(parsed.properties.map((p) => [p.key, p]));
    expect(byKey.title).toMatchObject({ value: "Demo", type: "text" });
    expect(byKey.count).toMatchObject({ value: "3", type: "number" });
    expect(byKey.published.type).toBe("date");
    expect(byKey.tags).toMatchObject({ type: "tags", value: ["alpha", "beta"] });
    expect(byKey.aliases.value).toEqual(["one", "two"]);
  });

  it("updates existing keys and keeps the body", () => {
    const next = updateFrontmatter("---\ntitle: Old\n---\nHello\n", { title: "New", draft: "yes" });
    expect(next).toContain("title: New");
    expect(next).toContain("Hello");
  });

  it("walks a file tree for markdown files", () => {
    const file = (name: string, path: string, isDirectory = false, children?: FileEntry[]): FileEntry => ({
      name,
      path,
      absolutePath: path,
      isDirectory,
      extension: isDirectory ? "" : path.slice(path.lastIndexOf(".")),
      children,
      modifiedAt: 0,
      size: 0,
    });
    const tree = file("root", "", true, [
      file("Note.md", "Note.md"),
      file("folder", "folder", true, [
        file("Nested.md", "folder/Nested.md"),
        file("skip.png", "folder/skip.png"),
      ]),
    ]);

    expect(getAllMarkdownFiles(tree).map((f) => f.path)).toEqual(["Note.md", "folder/Nested.md"]);
  });
});
