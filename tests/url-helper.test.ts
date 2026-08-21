import { describe, expect, it } from "vitest";
import {
  cleanEmbedUrl,
  getDisplayDomain,
  getSmartEmbed,
  toggleUrlInMarkdown,
} from "../src/utils/urlHelper";

describe("url helpers", () => {
  it("pulls the src out of a pasted iframe", () => {
    expect(cleanEmbedUrl('<iframe src="https://youtu.be/abc"></iframe>')).toBe("https://youtu.be/abc");
  });

  it("builds a YouTube embed", () => {
    const embed = getSmartEmbed("https://www.youtube.com/watch?v=dQw4w9wg");
    expect(embed.badge).toBe("YouTube");
    expect(embed.src).toContain("youtube.com/embed/dQw4w9wg");
  });

  it("builds a Vimeo embed", () => {
    expect(getSmartEmbed("https://vimeo.com/123456").src).toBe("https://player.vimeo.com/video/123456");
  });

  it("labels pdfs and media", () => {
    expect(getSmartEmbed("https://x.com/a.pdf").badge).toBe("PDF");
    expect(getSmartEmbed("https://x.com/a.mp3").badge).toBe("Audio Player");
    expect(getSmartEmbed("https://x.com/a.mp4").badge).toBe("Video Player");
  });

  it("strips www from display domains", () => {
    expect(getDisplayDomain("https://www.example.com/path")).toBe("example.com");
  });

  it("toggles the no-embed marker", () => {
    const withMarker = toggleUrlInMarkdown("See https://ex.com/a", "https://ex.com/a", true);
    expect(withMarker).toContain("#no-embed");
    expect(toggleUrlInMarkdown(withMarker, "https://ex.com/a", false)).toBe("See https://ex.com/a");
  });
});
