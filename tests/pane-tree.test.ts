import { describe, expect, it } from "vitest";
import {
  createLeaf,
  findLeafWithTab,
  insertTabIntoLeaf,
  removeTabFromTree,
  updateTabInTree,
} from "../src/components/layout/SplitPaneContainer";
import type { Tab } from "../src/types";

function tab(id: string, path: string): Tab {
  return { id, path, name: path, isModified: false };
}

describe("pane tree tab replacement", () => {
  it("turns a New tab into a file without dropping the leaf", () => {
    const newTab = tab("n1", "__new_tab__");
    const leaf = createLeaf([newTab], newTab.id);
    const fileTab = { ...newTab, path: ".openonyx/snippets/qa-pink-headings.css", name: "qa-pink-headings.css" };

    const next = updateTabInTree(leaf, newTab.id, fileTab);
    expect(next.type).toBe("leaf");
    if (next.type !== "leaf") return;
    expect(next.tabs).toHaveLength(1);
    expect(next.tabs[0].path).toBe(".openonyx/snippets/qa-pink-headings.css");
    expect(next.activeTabId).toBe(newTab.id);
    expect(findLeafWithTab(next, newTab.id)?.activeTabId).toBe(newTab.id);
  });

  it("keeps an incoming file tab when the last New tab is removed", () => {
    const newTab = tab("n1", "__new_tab__");
    const fileTab = tab("f1", ".openonyx/snippets/qa-pink-headings.css");
    const leaf = createLeaf([newTab], newTab.id);

    const removed = removeTabFromTree(leaf, newTab.id);
    expect(removed).toBeNull();

    const recovered = createLeaf([fileTab], fileTab.id);
    expect(recovered.tabs.map((t) => t.path)).toEqual([fileTab.path]);
    expect(recovered.activeTabId).toBe(fileTab.id);
  });

  it("inserts a file tab into a focused leaf that already has notes", () => {
    const note = tab("md1", "Index.md");
    const leaf = createLeaf([note], note.id);
    const fileTab = tab("f1", ".openonyx/snippets/qa-pink-headings.css");
    const next = insertTabIntoLeaf(leaf, leaf.id, fileTab);
    expect(next.type).toBe("leaf");
    if (next.type !== "leaf") return;
    expect(next.tabs.map((t) => t.path)).toEqual(["Index.md", fileTab.path]);
    expect(next.activeTabId).toBe(fileTab.id);
  });
});
