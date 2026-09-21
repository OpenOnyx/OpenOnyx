// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { installGlobalTooltips } from "../src/lib/tooltips";

describe("global tooltip cleanup", () => {
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    document.body.replaceChildren();
  });

  it("does not remove React-owned accessible tooltips", () => {
    const preview = document.createElement("div");
    preview.setAttribute("role", "tooltip");
    preview.textContent = "Citation preview";
    document.body.append(preview);

    cleanup = installGlobalTooltips();
    document.dispatchEvent(new Event("pointermove", { bubbles: true }));

    expect(preview.isConnected).toBe(true);
    expect(document.body.contains(preview)).toBe(true);
  });

  it("still removes obsolete legacy tooltip elements", () => {
    const legacy = document.createElement("div");
    legacy.className = "titlebar-tooltip";
    document.body.append(legacy);

    cleanup = installGlobalTooltips();

    expect(legacy.isConnected).toBe(false);
  });
});
