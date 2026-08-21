import { describe, expect, it } from "vitest";
import { filterCommands, filterCommandsByWords } from "../src/utils/commandFilter";

const commands = [
  { id: "new", label: "Create note", category: "File" },
  { id: "sidebar", label: "Toggle sidebar", category: "View" },
  { id: "graph", label: "Open graph", category: "View" },
];

describe("command filter", () => {
  it("returns every command when the query is empty", () => {
    expect(filterCommands(commands, "")).toHaveLength(3);
  });

  it("matches a substring of the label or category", () => {
    expect(filterCommands(commands, "side").map((c) => c.id)).toEqual(["sidebar"]);
    expect(filterCommands(commands, "view").map((c) => c.id)).toEqual(["sidebar", "graph"]);
  });

  it("current substring filter misses word-reordered queries", () => {
    expect(filterCommands(commands, "new note")).toEqual([]);
  });

  it("word filter finds Create note when every word appears", () => {
    expect(filterCommandsByWords(commands, "create note").map((c) => c.id)).toEqual(["new"]);
  });
});
