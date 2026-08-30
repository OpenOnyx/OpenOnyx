// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OOApp } from "../src/lib/obsidian-api/app";
import {
  cssSnippetsApi,
  getCssSnippetNames,
  getCssSnippets,
  getEnabledCssSnippetSet,
  isSnippetPath,
  mergeAppearanceEnabled,
  openCssSnippetsFolder,
  parseEnabledCssSnippets,
  refreshCssSnippets,
  resetCssSnippetsForTests,
  setCssSnippetEnabled,
  snippetNameFromFile,
  startCssSnippets,
  stopCssSnippets,
} from "../src/lib/cssSnippets";

type FileEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
};

function makeApi(options?: {
  openonyxFiles?: Record<string, string>;
  obsidianFiles?: Record<string, string>;
  appearance?: string | null;
  obsidianAppearance?: string | null;
}) {
  const data = new Map<string, string>(Object.entries(options?.openonyxFiles || {}));
  if (options?.appearance !== undefined && options.appearance !== null) {
    data.set("appearance.json", options.appearance);
  }
  const vaultFiles = new Map<string, string>(
    Object.entries(options?.obsidianFiles || {}).map(([name, css]) => [
      `.obsidian/snippets/${name}`,
      css,
    ]),
  );
  if (options?.obsidianAppearance) {
    vaultFiles.set(".obsidian/appearance.json", options.obsidianAppearance);
  }

  const dataWrite = vi.fn(async (relativePath: string, content: string) => {
    data.set(relativePath, content);
  });
  const writeFile = vi.fn(async (filePath: string, content: string) => {
    vaultFiles.set(filePath, content);
  });
  const openPath = vi.fn(async () => "");
  const createDirectory = vi.fn(async () => {});

  return {
    data,
    dataWrite,
    writeFile,
    openPath,
    api: {
      getVaultPath: vi.fn(async () => "/vault"),
      dataRead: vi.fn(async (relativePath: string) => data.get(relativePath) ?? null),
      dataWrite,
      dataList: vi.fn(async (subDir: string) =>
        Array.from(data.keys())
          .filter((key) => key.startsWith(`${subDir}/`))
          .map((key) => key.slice(subDir.length + 1)),
      ),
      listFiles: vi.fn(async (dirPath?: string) => {
        if (dirPath === ".obsidian/snippets") {
          return Array.from(vaultFiles.keys())
            .filter((path) => path.startsWith(".obsidian/snippets/") && path.endsWith(".css"))
            .map((path): FileEntry => {
              const name = path.split("/").pop()!;
              return { name, path, isDirectory: false };
            });
        }
        return [] as FileEntry[];
      }),
      readFile: vi.fn(async (filePath: string) => vaultFiles.get(filePath) ?? null),
      writeFile,
      createDirectory,
      openPath,
    },
  };
}

describe("css snippet helpers", () => {
  it("parses snippet names from css filenames", () => {
    expect(snippetNameFromFile("wide-tables.css")).toBe("wide-tables");
    expect(snippetNameFromFile("snippets/pretty.CSS")).toBe("pretty");
    expect(snippetNameFromFile("readme.md")).toBeNull();
    expect(snippetNameFromFile(".css")).toBeNull();
    expect(snippetNameFromFile("../escape.css")).toBe("escape");
    expect(snippetNameFromFile(".hidden.css")).toBeNull();
  });

  it("parses enabledCssSnippets from appearance.json", () => {
    expect(parseEnabledCssSnippets(null)).toBeNull();
    expect(parseEnabledCssSnippets("")).toBeNull();
    expect(parseEnabledCssSnippets("{not json")).toBeNull();
    expect(parseEnabledCssSnippets(JSON.stringify({ theme: "dark" }))).toEqual([]);
    expect(
      parseEnabledCssSnippets(JSON.stringify({ enabledCssSnippets: ["a", "", 1, "b", "bad/path"] })),
    ).toEqual(["a", "b"]);
  });

  it("merges enabledCssSnippets without dropping other appearance keys", () => {
    const next = mergeAppearanceEnabled(
      JSON.stringify({ cssTheme: "Minimal", enabledCssSnippets: ["old"] }),
      ["pretty", "wide"],
    );
    expect(JSON.parse(next)).toEqual({
      cssTheme: "Minimal",
      enabledCssSnippets: ["pretty", "wide"],
    });
  });

  it("recognizes snippet paths from both config folders", () => {
    expect(isSnippetPath(".openonyx/snippets/pretty.css")).toBe(true);
    expect(isSnippetPath(".obsidian/snippets/pretty.css")).toBe(true);
    expect(isSnippetPath("snippets/pretty.css")).toBe(true);
    expect(isSnippetPath("Notes/pretty.css")).toBe(false);
  });
});

describe("css snippet manager", () => {
  beforeEach(() => {
    resetCssSnippetsForTests();
    document.head.innerHTML = "";
    localStorage.clear();
  });

  afterEach(() => {
    resetCssSnippetsForTests();
    document.head.innerHTML = "";
    delete (window as any).electronAPI;
  });

  it("discovers snippets from both folders and prefers the OpenOnyx copy on name clash", async () => {
    const { api } = makeApi({
      openonyxFiles: { "snippets/shared.css": ".from-openonyx { color: red; }" },
      obsidianFiles: {
        "shared.css": ".from-obsidian { color: blue; }",
        "legacy.css": ".legacy { opacity: 1; }",
      },
    });
    (window as any).electronAPI = api;

    await startCssSnippets({ pollMs: null });

    expect(getCssSnippetNames()).toEqual(["legacy", "shared"]);
    expect(getCssSnippets().find((snippet) => snippet.name === "shared")?.source).toBe("openonyx");
    expect(getCssSnippets().find((snippet) => snippet.name === "legacy")?.source).toBe("obsidian");
  });

  it("seeds enabled snippets from Obsidian appearance.json and persists them to OpenOnyx", async () => {
    const { api, dataWrite, data, writeFile } = makeApi({
      obsidianFiles: { "pretty.css": ".pretty { font-size: 18px; }" },
      obsidianAppearance: JSON.stringify({ enabledCssSnippets: ["pretty"] }),
    });
    (window as any).electronAPI = api;

    await startCssSnippets({ pollMs: null });

    expect(getEnabledCssSnippetSet().has("pretty")).toBe(true);
    expect(document.querySelector('style[data-oo-snippet="pretty"]')?.textContent).toContain(".pretty");
    expect(dataWrite).toHaveBeenCalled();
    expect(JSON.parse(data.get("appearance.json") || "{}").enabledCssSnippets).toEqual(["pretty"]);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("injects and removes CSS when a snippet is toggled", async () => {
    const { api, data } = makeApi({
      openonyxFiles: { "snippets/wide.css": ".cm-content { max-width: none; }" },
    });
    (window as any).electronAPI = api;

    await startCssSnippets({ pollMs: null });
    expect(document.querySelector('style[data-oo-snippet="wide"]')).toBeNull();

    await setCssSnippetEnabled("wide", true);
    expect(document.querySelector('style[data-oo-snippet="wide"]')?.textContent).toContain("max-width");
    expect(JSON.parse(data.get("appearance.json") || "{}").enabledCssSnippets).toEqual(["wide"]);

    await setCssSnippetEnabled("wide", false);
    expect(document.querySelector('style[data-oo-snippet="wide"]')).toBeNull();
    expect(JSON.parse(data.get("appearance.json") || "{}").enabledCssSnippets).toEqual([]);
  });

  it("reloads an enabled snippet when its file is rewritten", async () => {
    const { api, data } = makeApi({
      openonyxFiles: { "snippets/accent.css": ".title { color: red; }" },
      appearance: JSON.stringify({ enabledCssSnippets: ["accent"] }),
    });
    (window as any).electronAPI = api;

    await startCssSnippets({ pollMs: null });
    expect(document.querySelector('style[data-oo-snippet="accent"]')?.textContent).toContain("red");

    data.set("snippets/accent.css", ".title { color: green; }");
    window.dispatchEvent(
      new CustomEvent("openonyx:file-written", {
        detail: { path: ".openonyx/snippets/accent.css" },
      }),
    );
    await refreshCssSnippets();

    expect(document.querySelector('style[data-oo-snippet="accent"]')?.textContent).toContain("green");
  });

  it("drops a removed snippet and its injected styles", async () => {
    const { api, data } = makeApi({
      openonyxFiles: { "snippets/gone.css": ".gone { display: none; }" },
      appearance: JSON.stringify({ enabledCssSnippets: ["gone"] }),
    });
    (window as any).electronAPI = api;

    await startCssSnippets({ pollMs: null });
    expect(document.querySelector('style[data-oo-snippet="gone"]')).not.toBeNull();

    data.delete("snippets/gone.css");
    await refreshCssSnippets();

    expect(getCssSnippetNames()).toEqual([]);
    expect(document.querySelector('style[data-oo-snippet="gone"]')).toBeNull();
  });

  it("unloads all injected snippets when the vault stops", async () => {
    const { api } = makeApi({
      openonyxFiles: { "snippets/pretty.css": "body { padding: 8px; }" },
      appearance: JSON.stringify({ enabledCssSnippets: ["pretty"] }),
    });
    (window as any).electronAPI = api;

    await startCssSnippets({ pollMs: null });
    expect(document.querySelectorAll("style[data-oo-snippet]").length).toBe(1);

    stopCssSnippets();
    expect(document.querySelectorAll("style[data-oo-snippet]").length).toBe(0);
    expect(getCssSnippetNames()).toEqual([]);
  });

  it("keeps multiple enabled snippets injected at once", async () => {
    const { api } = makeApi({
      openonyxFiles: {
        "snippets/one.css": ".one { color: red; }",
        "snippets/two.css": ".two { color: blue; }",
      },
      appearance: JSON.stringify({ enabledCssSnippets: ["one", "two"] }),
    });
    (window as any).electronAPI = api;

    await startCssSnippets({ pollMs: null });
    expect(document.querySelector('style[data-oo-snippet="one"]')).not.toBeNull();
    expect(document.querySelector('style[data-oo-snippet="two"]')).not.toBeNull();
  });

  it("opens the vault-relative OpenOnyx snippets folder", async () => {
    const { api, openPath } = makeApi();
    (window as any).electronAPI = api;

    await openCssSnippetsFolder();

    expect(api.createDirectory).toHaveBeenCalledWith(".openonyx/snippets");
    expect(openPath).toHaveBeenCalledWith(".openonyx/snippets");
  });

  it("shares enable state with app.customCss", async () => {
    const { api } = makeApi({
      openonyxFiles: { "snippets/wide.css": ".wide { width: 100%; }" },
    });
    (window as any).electronAPI = api;

    await startCssSnippets({ pollMs: null });
    const app = new OOApp();
    expect(app.customCss).toBe(cssSnippetsApi);

    await app.customCss.setCssEnabledStatus("wide", true);
    expect(getEnabledCssSnippetSet().has("wide")).toBe(true);
    expect(document.querySelector('style[data-oo-snippet="wide"]')).not.toBeNull();
  });
});
