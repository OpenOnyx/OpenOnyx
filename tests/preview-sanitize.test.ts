// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { PREVIEW_ADD_ATTR, sanitizePreviewHtml } from "../src/utils/previewSanitize";

describe("preview HTML sanitizer", () => {
  it("does not allow event-handler attributes", () => {
    expect(PREVIEW_ADD_ATTR).not.toContain("onerror");
    expect(PREVIEW_ADD_ATTR).not.toContain("onmouseover");
    expect(PREVIEW_ADD_ATTR).not.toContain("onmouseout");
  });

  it("strips onerror from user markdown HTML", () => {
    const html = sanitizePreviewHtml('<img src="x" onerror="window.pwned=1">');
    expect(html.toLowerCase()).not.toContain("onerror");
    expect(html.toLowerCase()).not.toContain("pwned");
  });
});
