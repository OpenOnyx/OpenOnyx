import * as Y from "yjs";
import { describe, expect, it } from "vitest";

describe("Yjs note merge", () => {
  it("merges concurrent inserts from two clients", () => {
    const left = new Y.Doc();
    const right = new Y.Doc();
    const leftText = left.getText("content");
    leftText.insert(0, "Hello world");

    Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
    const rightText = right.getText("content");
    expect(rightText.toString()).toBe("Hello world");

    leftText.insert(5, " there");
    rightText.insert(11, "!");

    Y.applyUpdate(right, Y.encodeStateAsUpdate(left, Y.encodeStateVector(right)));
    Y.applyUpdate(left, Y.encodeStateAsUpdate(right, Y.encodeStateVector(left)));

    expect(leftText.toString()).toBe(rightText.toString());
    expect(leftText.toString()).toContain("there");
    expect(leftText.toString()).toContain("!");
    expect(leftText.toString().startsWith("Hello")).toBe(true);
  });

  it("does not drop the earlier client's text when both edit offline", () => {
    const start = new Y.Doc();
    start.getText("content").insert(0, "Base");

    const a = new Y.Doc();
    const b = new Y.Doc();
    const snapshot = Y.encodeStateAsUpdate(start);
    Y.applyUpdate(a, snapshot);
    Y.applyUpdate(b, snapshot);

    a.getText("content").insert(4, " A");
    b.getText("content").insert(4, " B");

    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    expect(a.getText("content").toString()).toBe(b.getText("content").toString());
    expect(a.getText("content").toString()).toContain("A");
    expect(a.getText("content").toString()).toContain("B");
  });
});
