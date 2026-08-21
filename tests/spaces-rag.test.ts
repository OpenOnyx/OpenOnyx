// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  getTopLevelFolder,
  isComprehensiveSpaceQuery,
  mapCloudRpcChunk,
  parseActionPayload,
  stripJSONBlock,
} from "../src/utils/spaces-rag";

describe("spaces RAG parsers", () => {
  it("parses a fenced action payload", () => {
    const parsed = parseActionPayload(`Sure.

\`\`\`json
{"intent":"create_note","actions":[{"type":"create_note","title":"A","path":"A.md","content":"hi"}]}
\`\`\`
`);
    expect(parsed.intent).toBe("create_note");
    expect(parsed.actions[0].title).toBe("A");
  });

  it("parses raw JSON with an action key", () => {
    const parsed = parseActionPayload('prefix {"action":"create_note","title":"B"} suffix');
    expect(parsed.action).toBe("create_note");
  });

  it("returns null for conversation-only replies", () => {
    expect(parseActionPayload("Deadlocks happen when...")).toBeNull();
    expect(parseActionPayload("")).toBeNull();
  });

  it("strips action JSON but keeps example code blocks", () => {
    const cleaned = stripJSONBlock(`Answer

\`\`\`python
print("hi")
\`\`\`

\`\`\`json
{"intent":"update_note","actions":[]}
\`\`\`
`);
    expect(cleaned).toContain("print(\"hi\")");
    expect(cleaned).not.toContain("update_note");
  });

  it("maps cloud RPC rows and keeps a path when the RPC provides one", () => {
    const withPath = mapCloudRpcChunk(
      { id: "1", note_title: "Note", content: "chunk", similarity: 0.8, path: "Folder/Note.md" },
      "space-1",
    );
    expect(withPath.chunk.notePath).toBe("Folder/Note.md");
    expect(withPath.chunk.noteTitle).toBe("Note");

    const missing = mapCloudRpcChunk({ id: "2", content: "x" }, "space-1");
    expect(missing.chunk.notePath).toBe("");
    expect(missing.chunk.noteTitle).toBe("Unknown Note");
  });

  it("detects overview queries", () => {
    expect(isComprehensiveSpaceQuery("what is in this vault?")).toBe(true);
    expect(isComprehensiveSpaceQuery("summarize the whole space")).toBe(true);
    expect(isComprehensiveSpaceQuery("what are deadlocks?")).toBe(false);
  });

  it("reads the top-level folder from a note path", () => {
    expect(getTopLevelFolder("Systems/Locks.md")).toBe("Systems");
    expect(getTopLevelFolder("Hello.md")).toBe("(root)");
    expect(getTopLevelFolder("")).toBe("(root)");
  });
});
