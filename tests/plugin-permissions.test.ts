import { describe, expect, it } from "vitest";
import { DEFAULT_PLUGIN_PERMISSIONS } from "../src/types/plugin";

describe("default plugin permissions", () => {
  it("does not grant filesystem or network until the plugin declares them", () => {
    expect(DEFAULT_PLUGIN_PERMISSIONS).toEqual(["ui", "editor"]);
    expect(DEFAULT_PLUGIN_PERMISSIONS).not.toContain("filesystem");
    expect(DEFAULT_PLUGIN_PERMISSIONS).not.toContain("network");
  });
});
