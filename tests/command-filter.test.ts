import { describe, expect, it } from "vitest";
import {
  filterCommands,
  filterCommandsByWords,
  getPrimaryModifierLabel,
} from "../src/utils/commandFilter";

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

  it("matches all query words across command metadata", () => {
    expect(filterCommands(commands, "new note").map((c) => c.id)).toEqual(["new"]);
    expect(filterCommands(commands, "view graph").map((c) => c.id)).toEqual(["graph"]);
  });

  it("word filter finds Create note when every word appears", () => {
    expect(filterCommandsByWords(commands, "create note").map((c) => c.id)).toEqual(["new"]);
  });
});

describe("primary modifier label", () => {
  it("uses the Command symbol on macOS", () => {
    expect(getPrimaryModifierLabel("MacIntel")).toBe("⌘");
  });

  it("uses Ctrl on Windows and Linux", () => {
    expect(getPrimaryModifierLabel("Win32")).toBe("Ctrl");
    expect(getPrimaryModifierLabel("Linux x86_64")).toBe("Ctrl");
  });
});
