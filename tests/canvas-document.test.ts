import { describe, expect, it } from "vitest";
import {
  parseCanvasDocument,
  serializeCanvasDocument,
} from "../src/components/canvas/canvasDocument";

describe("canvas documents", () => {
  it("round-trips a valid canvas", () => {
    const raw = JSON.stringify({
      nodes: [
        { id: "n1", type: "text", x: 10, y: 20, width: 300, height: 200, text: "Hello" },
        { id: "n2", type: "file", x: 400, y: 20, width: 280, height: 180, file: "Note.md" },
      ],
      edges: [{ id: "e1", fromNode: "n1", toNode: "n2", fromSide: "right", toSide: "left" }],
    });
    const parsed = parseCanvasDocument(raw);
    expect(parsed.diagnostics.droppedNodes).toBe(0);
    expect(parsed.data.nodes).toHaveLength(2);
    expect(parsed.data.edges).toHaveLength(1);

    const again = parseCanvasDocument(serializeCanvasDocument(parsed.data));
    expect(again.data.nodes.map((n) => n.id)).toEqual(["n1", "n2"]);
  });

  it("drops invalid nodes and dangling edges", () => {
    const parsed = parseCanvasDocument(JSON.stringify({
      nodes: [
        { id: "ok", type: "text", x: 0, y: 0, width: 260, height: 160, text: "ok" },
        { id: "bad", type: "unknown" },
        "not-an-object",
      ],
      edges: [{ id: "e1", fromNode: "ok", toNode: "missing" }],
    }));
    expect(parsed.diagnostics.droppedNodes).toBeGreaterThan(0);
    expect(parsed.data.nodes.map((n) => n.id)).toEqual(["ok"]);
    expect(parsed.data.edges).toHaveLength(0);
    expect(parsed.diagnostics.repaired).toBe(true);
  });

  it("repairs missing ids and records a parse error for invalid JSON", () => {
    const repaired = parseCanvasDocument(JSON.stringify({
      nodes: [{ type: "text", x: 0, y: 0, width: 260, height: 160, text: "x" }],
    }));
    expect(repaired.data.nodes[0].id).toMatch(/^node-/);
    expect(repaired.diagnostics.warnings.length).toBeGreaterThan(0);

    const broken = parseCanvasDocument("{not json");
    expect(broken.diagnostics.parseError).toBeTruthy();
    expect(broken.data.nodes).toEqual([]);
  });
});
