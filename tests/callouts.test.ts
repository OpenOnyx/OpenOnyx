// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { marked } from "marked";
import { buildMarkdownPdfHtml } from "../src/utils/pdfExport";

describe("callout rendering", () => {
  it("renders note and caution callouts with website docs-note classes in pdf export", () => {
    const noteHtml = buildMarkdownPdfHtml({
      markdown: "> [!NOTE]\n> You can keep using Obsidian on the same folder. The files do not belong to either app.",
      title: "Note Test",
      notePath: "Note.md",
    });
    expect(noteHtml).toContain("callout-note");
    expect(noteHtml).toContain("docs-note");
    expect(noteHtml).toContain("NOTE");
    expect(noteHtml).toContain("You can keep using Obsidian on the same folder.");

    const cautionHtml = buildMarkdownPdfHtml({
      markdown: "> [!CAUTION]\n> The collaboration panel currently shows a maintenance notice.",
      title: "Caution Test",
      notePath: "Caution.md",
    });
    expect(cautionHtml).toContain("callout-caution");
    expect(cautionHtml).toContain("docs-note");
    expect(cautionHtml).toContain("is-caution");
    expect(cautionHtml).toContain("CAUTION");
    expect(cautionHtml).toContain("The collaboration panel currently shows a maintenance notice.");
  });

  it("supports custom title in callout header", () => {
    const html = buildMarkdownPdfHtml({
      markdown: "> [!NOTE] Custom Header Title\n> Body content here.",
      title: "Custom Title",
      notePath: "Custom.md",
    });
    expect(html).toContain("Custom Header Title");
    expect(html).toContain("Body content here.");
  });

  it("handles leading space before quote and indented body line matching user case", () => {
    const raw = " > [!WARNING]                                                                         \n    > You can keep using Obsidian on the same folder. The files do not belong to either app";
    const html = buildMarkdownPdfHtml({
      markdown: raw,
      title: "Warning Test",
      notePath: "Warning.md",
    });
    expect(html).toContain("callout-warning");
    expect(html).toContain("docs-note");
    expect(html).toContain("is-caution");
    expect(html).toContain("WARNING");
    expect(html).toContain("You can keep using Obsidian on the same folder.");
    expect(html).not.toContain("&gt; You can keep using");
  });

  it("renders consecutive callouts without blank line as separate callout cards", () => {
    const raw = `> [!DANGER]
> You can keep using Obsidian on the same folder. The files do not belong to either app
> [!NOTE]
> The collaboration panel currently shows a maintenance notice: real-time multiplayer editing has`;
    const html = buildMarkdownPdfHtml({
      markdown: raw,
      title: "Consecutive Test",
      notePath: "Consecutive.md",
    });
    expect(html).toContain("callout-danger");
    expect(html).toContain("DANGER");
    expect(html).toContain("callout-note");
    expect(html).toContain("NOTE");
    // Ensure NOTE is not embedded as text inside DANGER
    expect(html.match(/class="[^"]*docs-note/g)?.length).toBe(2);
  });
});
