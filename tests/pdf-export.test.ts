// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildMarkdownPdfHtml, getPdfDefaultPath } from "../src/utils/pdfExport";

describe("pdf export", () => {
  it("builds a vault-relative pdf path", () => {
    expect(getPdfDefaultPath("/vault", "notes/Hello.md")).toBe("/vault/notes/Hello.pdf");
    expect(getPdfDefaultPath(null, "notes/Hello.md")).toBe("Hello.pdf");
  });

  it("renders headings, checkboxes, and wiki links", () => {
    const html = buildMarkdownPdfHtml({
      markdown: "# Title\n\n- [x] done\n\nSee [[Other Note|alias]]",
      title: "Title",
      notePath: "Title.md",
    });
    expect(html).toContain("<h1");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
    expect(html).toContain("alias");
  });

  it("turns regular images into file uris", () => {
    const html = buildMarkdownPdfHtml({
      markdown: "![cat](attachments/cat.png)",
      title: "Img",
      notePath: "Img.md",
      vaultPath: "/Users/me/vault",
    });
    expect(html).toContain("file://");
    expect(html).toContain("cat.png");
  });

  it("currently drops wiki image embeds as missing placeholders", () => {
    const html = buildMarkdownPdfHtml({
      markdown: "![[attachments/cat.png]]",
      title: "Wiki img",
      notePath: "Wiki.md",
      vaultPath: "/Users/me/vault",
    });
    expect(html).toContain("embed-missing");
    expect(html).not.toContain("file:///Users/me/vault/attachments/cat.png");
  });

  it("escapes the document title", () => {
    const html = buildMarkdownPdfHtml({
      markdown: "hi",
      title: '<script>alert(1)</script>',
      notePath: "x.md",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
