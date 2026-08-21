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

  it("renders wiki image embeds as printable vault protocol images", () => {
    const html = buildMarkdownPdfHtml({
      markdown: [
        "![[attachments/demo.png]]",
        "![[diagram.png|300]]",
        "![[photo.jpg|300|Alt text]]",
        "![[missing.png]]",
        "![regular](regular.png)",
        "![[Missing Note]]",
      ].join("\n\n"),
      title: "Image Export",
      notePath: "Image Export.md",
      vaultPath: "/Users/example/My Vault",
      vaultFiles: [
        { path: "attachments/demo.png", name: "demo.png", isDirectory: false },
        { path: "assets/nested/diagram.png", name: "diagram.png", isDirectory: false },
        { path: "photo.jpg", name: "photo.jpg", isDirectory: false },
      ],
    });

    expect(html).toContain('src="vault://local/attachments/demo.png"');
    expect(html).toContain('alt="attachments/demo.png"');
    expect(html).toContain('src="vault://local/diagram.png"');
    expect(html).toContain('alt="diagram.png"');
    expect(html).toContain('style="max-width: 300px; width: 100%;"');
    expect(html).toContain('src="vault://local/photo.jpg"');
    expect(html).toContain('alt="Alt text"');
    expect(html).not.toContain('alt="300"');
    expect(html).toContain('<div class="embed-missing">missing.png</div>');
    expect(html).toContain('src="file:///Users/example/My%20Vault/regular.png"');
    expect(html).toContain('<div class="embed-missing">Missing Note</div>');
  });

  it("matches wiki image embeds case-insensitively against vault files", () => {
    const html = buildMarkdownPdfHtml({
      markdown: "![[attachments/image.png]]",
      title: "Image Export",
      notePath: "Image Export.md",
      vaultPath: "/Users/example/My Vault",
      vaultFiles: [
        { path: "Attachments/Image.PNG", name: "Image.PNG", isDirectory: false },
      ],
    });

    expect(html).toContain('src="vault://local/attachments/image.png"');
    expect(html).not.toContain('<div class="embed-missing">attachments/image.png</div>');
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
