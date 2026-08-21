// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { loadFTUXState, saveFTUXState } from "../src/utils/ftux";

describe("first-run state", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts at zero notes", () => {
    expect(loadFTUXState()).toEqual({ notesCount: 0 });
  });

  it("saves a valid count", () => {
    saveFTUXState({ notesCount: 4 });
    expect(loadFTUXState().notesCount).toBe(4);
  });

  it("recovers from corrupt storage", () => {
    localStorage.setItem("openonyx-ftux", "{not json");
    expect(loadFTUXState()).toEqual({ notesCount: 0 });
  });
});
