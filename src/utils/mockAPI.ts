/**
 * Electron API Mock
 *
 * Provides a browser-compatible mock of the Electron API for development
 * and testing outside of Electron. Uses localStorage and in-memory storage
 * to simulate vault operations.
 */

import type { ElectronAPI } from "../../electron/preload";

// In-memory file system for browser mode
const mockFiles: Record<string, string> = {};
let mockVaultPath: string | null = null;

const SAMPLE_NOTES: Record<string, string> = {
  "Welcome.md": `# Welcome to OpenOnyx

OpenOnyx is your **local-first knowledge management tool**. Think of it as a second brain — all your notes, connected.

## Getting Started

1. Create notes using the sidebar or \`Ctrl+N\`
2. Link notes using \`[[Note Name]]\` syntax — like this: [[Getting Started]]
3. View your knowledge graph with \`Ctrl+G\`
4. Search across all notes with \`Ctrl+F\`
5. Use the command palette with \`Ctrl+P\`

## Features

- ✅ Markdown editing with live preview
- ✅ [[Wiki Links]] for connecting ideas
- ✅ Interactive graph visualization
- ✅ Tags with #welcome #introduction

Check out [[Getting Started]] to learn more, or explore [[Markdown Guide]] for formatting.
`,
  "Getting Started.md": `# Getting Started

Welcome to your OpenOnyx vault! Here's everything you need to know.

### Core Features

- 📝 **Markdown Editor** — Full GitHub Flavored Markdown support with Live Preview
- 🔗 **Wikilinks & Backlinks** — Connect notes with \`[[Note Name]]\` syntax
- 🕸️ **Interactive Graph View** — Visualize your knowledge graph
- 🔍 **Full-Text & Fuzzy Search** — Instant search across all your notes
- 🤖 **Semantic AI Intelligence** — Auto-suggestions, insights, and RAG Q&A (100% optional)

The power of OpenOnyx lies in connecting your ideas:

\`\`\`
[[Note Name]]
\`\`\`

This creates a bidirectional link. The linked note will show this note in its **Backlinks** panel.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| \`Ctrl+N\` | New Note |
| \`Ctrl+S\` | Save |
| \`Ctrl+F\` | Search |
| \`Ctrl+G\` | Graph View |
| \`Ctrl+P\` | Command Palette |
| \`Ctrl+B\` | Toggle Sidebar |

## Next Steps

- Read the [[Markdown Guide]] for formatting
- Explore [[Knowledge Management]] best practices
- Check out [[Project Ideas]] for inspiration

#getting-started #tutorial
`,
  "Markdown Guide.md": `# Markdown Guide

OpenOnyx supports full **GitHub Flavored Markdown**. Here's a quick reference.

## Text Formatting

- **Bold**: \`**text**\`
- *Italic*: \`*text*\`
- ~~Strikethrough~~: \`~~text~~\`
- \`Code\`: \`\` \`code\` \`\`

## Lists

- [x] Completed task
- [ ] Incomplete task

## Code Blocks

\`\`\`javascript
function greet(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

## Blockquotes

> "The only true wisdom is in knowing you know nothing."
> — Socrates

See also: [[Getting Started]], [[Knowledge Management]]

#markdown #reference #guide
`,
  "Knowledge Management.md": `# Knowledge Management

Effective knowledge management is about **capturing, connecting, and retrieving** information efficiently.

## The Zettelkasten Method

1. **Atomic notes**: Each note captures one idea
2. **Connections**: Notes link to related concepts
3. **Emergence**: Insights emerge from the network

## Best Practices

- **Write for your future self**: Be clear and specific
- **One idea per note**: Keep notes focused
- **Link liberally**: More connections = more insights

## Related

- [[Welcome]]
- [[Markdown Guide]]
- [[Project Ideas]]

#knowledge-management #zettelkasten #productivity
`,
  "Project Ideas.md": `# Project Ideas

A collection of project ideas for your [[Knowledge Management]] system.

## Software Projects

- [ ] Personal Dashboard
- [ ] CLI Tools
- [ ] Open Source Contributions

## Learning Goals

- [ ] Learn Rust
- [ ] Explore Haskell
- [ ] Machine learning basics

Related: [[Knowledge Management]], [[Welcome]]

#projects #ideas #planning
`,
};

/** Extract [[wiki-links]] from content */
function extractLinks(content: string): string[] {
  const regex = /\[\[([^\]]+)\]\]/g;
  const links: string[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    links.push(match[1].trim());
  }
  return [...new Set(links)];
}

/** Extract #tags from content */
function extractTags(content: string): string[] {
  const regex = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_-]*)/g;
  const tags: string[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    tags.push(match[1]);
  }
  return [...new Set(tags)];
}

function getBasename(path: string): string {
  return path.split("/").pop() || path;
}

/** Build file tree from mock files */
function buildFileTree(): any[] {
  const tree: any[] = [];
  const dirs: Record<string, any[]> = { "": tree };

  // Sort paths to ensure directories come before their contents
  const paths = Object.keys(mockFiles).sort();

  for (const filePath of paths) {
    const parts = filePath.split("/");
    const fileName = parts.pop()!;
    const dirPath = parts.join("/");

    // Ensure directory entries exist
    let currentPath = "";
    for (const part of parts) {
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (!dirs[currentPath]) {
        const dirEntry = {
          name: part,
          path: currentPath,
          absolutePath: `/mock-vault/${currentPath}`,
          isDirectory: true,
          extension: "",
          children: [] as any[],
          modifiedAt: Date.now(),
          size: 0,
        };
        dirs[currentPath] = dirEntry.children;
        (dirs[parentPath] || tree).push(dirEntry);
      }
    }

    const fileEntry = {
      name: fileName,
      path: filePath,
      absolutePath: `/mock-vault/${filePath}`,
      isDirectory: false,
      extension: ".md",
      modifiedAt: Date.now(),
      size: mockFiles[filePath].length,
    };
    (dirs[dirPath] || tree).push(fileEntry);
  }

  return tree;
}

export function seedMockFiles(files: Record<string, string>): void {
  for (const key of Object.keys(mockFiles)) delete mockFiles[key];
  Object.assign(mockFiles, files);
}

export function createMockAPI(): ElectronAPI {
  // Initialize with sample notes unless a vault was already seeded.
  if (Object.keys(mockFiles).length === 0) {
    Object.assign(mockFiles, SAMPLE_NOTES);
  }

  const mockAPI: ElectronAPI = {
    // Vault
    openVaultDialog: async () => {
      mockVaultPath = "/mock-vault";
      return "/mock-vault";
    },
    setVaultPath: async (path: string) => {
      mockVaultPath = path;
      const stored = localStorage.getItem("mock-previously-opened-vaults");
      const list = stored ? JSON.parse(stored) : [];
      if (!list.includes(path)) {
        list.push(path);
        localStorage.setItem("mock-previously-opened-vaults", JSON.stringify(list));
      }
      return true;
    },
    getVaultPath: async () => mockVaultPath,
    getPreviouslyOpenedVaults: async () => {
      const stored = localStorage.getItem("mock-previously-opened-vaults");
      if (stored) return JSON.parse(stored);
      return mockVaultPath ? [mockVaultPath] : [];
    },
    removePreviouslyOpenedVault: async (vaultPath: string) => {
      const stored = localStorage.getItem("mock-previously-opened-vaults");
      const list = stored ? JSON.parse(stored) : [];
      const next = list.filter((path: string) => path !== vaultPath);
      localStorage.setItem("mock-previously-opened-vaults", JSON.stringify(next));
      return next;
    },
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true, filePath: "" }),
    openPath: async () => "",
    openExternal: async () => {},
    showItemInFolder: async () => {},
    renamePath: async (_oldPath: string, newPath: string) => {
      mockVaultPath = newPath;
    },
    getSystemPath: async (name: string) => name === "documents" ? "/documents" : "/",

    // File operations
    listFiles: async (dirPath?: string) => {
      const tree = buildFileTree();
      if (!dirPath) return tree;
      // Find the subdirectory
      const findDir = (entries: any[], path: string): any[] => {
        for (const entry of entries) {
          if (entry.path === path && entry.isDirectory)
            return entry.children || [];
          if (entry.children) {
            const found = findDir(entry.children, path);
            if (found.length) return found;
          }
        }
        return [];
      };
      return findDir(tree, dirPath);
    },

    readFile: async (filePath: string) => {
      return mockFiles[filePath] || "";
    },

    readBinary: async (filePath: string) => {
      return new TextEncoder().encode(mockFiles[filePath] || "");
    },

    writeFile: async (filePath: string, content: string) => {
      mockFiles[filePath] = content;
    },

    writeBinary: async (filePath: string, content: Uint8Array) => {
      mockFiles[filePath] = new TextDecoder().decode(content);
    },

    createFile: async (filePath: string, content?: string) => {
      if (!mockFiles[filePath]) {
        mockFiles[filePath] = content || "";
      }
    },

    deleteFile: async (filePath: string) => {
      delete mockFiles[filePath];
    },

    trashFile: async (filePath: string) => {
      mockFiles[`__system_trash__/${filePath}`] = mockFiles[filePath] || "";
      delete mockFiles[filePath];
    },

    renameFile: async (oldPath: string, newPath: string) => {
      if (mockFiles[oldPath] !== undefined) {
        // Renaming a file
        mockFiles[newPath] = mockFiles[oldPath];
        delete mockFiles[oldPath];
      } else {
        // Potentially renaming a directory
        const keys = Object.keys(mockFiles);
        const prefix = oldPath.endsWith("/") ? oldPath : `${oldPath}/`;
        const newPrefix = newPath.endsWith("/") ? newPath : `${newPath}/`;

        for (const key of keys) {
          if (key.startsWith(prefix)) {
            const suffix = key.substring(prefix.length);
            const newKey = newPrefix + suffix;
            mockFiles[newKey] = mockFiles[key];
            delete mockFiles[key];
          }
        }
      }
    },

    createDirectory: async (_dirPath: string) => {
      // Directories are implicit in our mock
    },

    deleteDirectory: async (dirPath: string) => {
      for (const key of Object.keys(mockFiles)) {
        if (key.startsWith(dirPath + "/")) {
          delete mockFiles[key];
        }
      }
    },

    fileExists: async (filePath: string) => {
      return filePath in mockFiles;
    },

    getFileTree: async () => buildFileTree(),

    // Search
    search: async (query: string) => {
      if (!query.trim()) return [];
      const q = query.toLowerCase();
      return Object.entries(mockFiles)
        .filter(
          ([path, content]) =>
            path.toLowerCase().includes(q) || content.toLowerCase().includes(q),
        )
        .map(([path, content]) => ({
          path,
          name: path.replace(/\.md$/, ""),
          matches: [
            {
              key: "content",
              indices: [[0, 0]] as readonly [number, number][],
              value: content.substring(0, 200),
            },
          ],
          score: path.toLowerCase().includes(q) ? 0.1 : 0.5,
        }))
        .slice(0, 20);
    },

    rebuildIndex: async () => {},

    // Graph
    getGraphData: async () => {
      const nodes: Map<string, any> = new Map();
      const edges: any[] = [];
      // Track children for each node (outgoing links - nodes this note links TO)
      const childrenMap: Map<string, Set<string>> = new Map();

      for (const [filePath, content] of Object.entries(mockFiles)) {
        const name = getBasename(filePath).replace(/\.md$/, "");
        const key = name.toLowerCase();
        if (!nodes.has(key)) {
          nodes.set(key, { id: key, name, path: filePath, connections: 0 });
          childrenMap.set(key, new Set());
        }

        const links = extractLinks(content);
        for (const linkTarget of links) {
          const targetKey = linkTarget.toLowerCase();
          if (!nodes.has(targetKey)) {
            nodes.set(targetKey, {
              id: targetKey,
              name: linkTarget,
              path: "",
              connections: 0,
            });
            childrenMap.set(targetKey, new Set());
          }
          edges.push({ source: key, target: targetKey });
          // Track children (outgoing links from source TO target)
          childrenMap.get(key)?.add(targetKey);
        }
      }

      // Calculate total descendants for each node recursively
      const descendantCache: Map<string, number> = new Map();

      const countDescendants = (
        nodeId: string,
        visited: Set<string>,
      ): number => {
        // Prevent infinite loops from cycles
        if (visited.has(nodeId)) return 0;

        // Return cached value if available
        if (descendantCache.has(nodeId)) return descendantCache.get(nodeId)!;

        visited.add(nodeId);
        const children = childrenMap.get(nodeId) || new Set();

        let total = children.size; // Direct children
        for (const child of children) {
          total += countDescendants(child, new Set(visited));
        }

        descendantCache.set(nodeId, total);
        return total;
      };

      // Set connections to total descendants count
      for (const [nodeId, node] of nodes) {
        node.connections = countDescendants(nodeId, new Set());
      }

      return { nodes: Array.from(nodes.values()), edges };
    },

    getBacklinks: async (filePath: string) => {
      const targetName = getBasename(filePath).replace(/\.md$/, "");
      const backlinks: string[] = [];
      for (const [path, content] of Object.entries(mockFiles)) {
        if (path === filePath) continue;
        const links = extractLinks(content);
        if (links.some((l) => l.toLowerCase() === targetName.toLowerCase())) {
          backlinks.push(path);
        }
      }
      return backlinks;
    },

    // Window controls (no-op in browser)
    minimizeWindow: () => {},
    maximizeWindow: () => {},
    closeWindow: () => {},
    isMaximized: async () => false,
    isFullScreen: async () => false,
    onFullScreenChange: (_callback: (isFullScreen: boolean) => void) => () => {},

    // Menu events (no-op in browser)
    onMenuEvent: (_channel: string, _callback: (...args: any[]) => void) => {},
    removeMenuListener: (_channel: string) => {},

    // Daily note
    createDailyNote: async () => {
      const today = new Date().toISOString().split("T")[0];
      const fileName = `Daily Notes/${today}.md`;
      if (!mockFiles[fileName]) {
        mockFiles[fileName] =
          `# ${today}\n\n## Tasks\n\n- [ ] \n\n## Notes\n\n\n`;
      }
      return fileName;
    },

    // Tags
    getAllTags: async () => {
      const tagMap: Record<string, string[]> = {};
      for (const [filePath, content] of Object.entries(mockFiles)) {
        const tags = extractTags(content);
        for (const tag of tags) {
          if (!tagMap[tag]) tagMap[tag] = [];
          tagMap[tag].push(filePath);
        }
      }
      return tagMap;
    },

    // Attachments/Images
    saveImage: async (fileName: string, _base64Data: string) => {
      // In mock mode, just return a mock path
      return `attachments/${fileName}`;
    },

    saveImageDedup: async (fileName: string, _base64Data: string) => {
      return { relativePath: `attachments/${fileName}`, isDuplicate: false };
    },

    // .openonyx Data Storage (localStorage fallback in browser mode)
    dataRead: async (relativePath: string) => {
      if (typeof localStorage === "undefined" || !localStorage) return null;
      let content = localStorage.getItem(`openonyx-data:${relativePath}`);
      if (content === null) {
        content = localStorage.getItem(`openobsidian-data:${relativePath}`);
        if (content !== null) {
          localStorage.setItem(`openonyx-data:${relativePath}`, content);
          localStorage.removeItem(`openobsidian-data:${relativePath}`);
        }
      }
      return content;
    },
    dataWrite: async (relativePath: string, content: string) => {
      if (typeof localStorage !== "undefined" && localStorage) {
        localStorage.setItem(`openonyx-data:${relativePath}`, content);
      }
    },
    dataDelete: async (relativePath: string) => {
      if (typeof localStorage !== "undefined" && localStorage) {
        localStorage.removeItem(`openonyx-data:${relativePath}`);
      }
    },
    dataList: async (subDir: string) => {
      if (typeof localStorage === "undefined" || !localStorage) return [];
      const prefix = `openonyx-data:${subDir}/`;
      const files: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) {
          files.push(key.substring(prefix.length));
        }
      }
      return files;
    },

    dataFetch: async (url: string): Promise<string> => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.text();
    },

    writeClipboardText: async (text: string): Promise<void> => {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    },

    readClipboardText: async (): Promise<string> => {
      if (navigator.clipboard?.readText) {
        return navigator.clipboard.readText();
      }
      return "";
    },

    exportMarkdownPdf: async (params: { html: string; defaultPath?: string }) => {
      const preview = window.open("", "_blank");
      if (preview) {
        preview.document.open();
        preview.document.write(params.html);
        preview.document.close();
        setTimeout(() => preview.print(), 100);
      }
      return { canceled: false, filePath: params.defaultPath || null };
    },

    networkRequest: async (params: any): Promise<any> => {
      const res = await fetch(params.url, {
        method: params.method || 'GET',
        headers: params.headers,
        body: params.body
      });
      
      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      
      let data;
      if (params.responseType === 'json') {
        data = await res.json();
      } else {
        data = await res.text();
      }
      
      return {
        status: res.status,
        headers: responseHeaders,
        data
      };
    },

    // Thought Model (mock implementation for browser)
    thoughtModel: {
      build: async (_vaultPath: string, _numClusters?: number) => {
        // Simulate a build that completes quickly
        return { job_id: "mock-job-123", status: "indexing" };
      },
      status: async (_jobId: string) => {
        // Always return done for mock
        return {
          job_id: "mock-job-123",
          status: "done",
          progress: 100,
          message: "Complete (mock)",
          total_notes: 5,
          total_chunks: 12,
        };
      },
      themes: async (_jobId: string) => {
        // Return mock themes based on sample notes
        return {
          themes: [
            {
              cluster_id: 0,
              keywords: [
                "knowledge",
                "management",
                "zettelkasten",
                "notes",
                "ideas",
              ],
              representative_chunks: [
                {
                  chunk_id: "km_0",
                  note_id: "km",
                  note_path: "Knowledge Management.md",
                  note_title: "Knowledge Management",
                  chunk_text:
                    "Effective knowledge management is about capturing, connecting, and retrieving information efficiently.",
                },
              ],
              note_count: 2,
            },
            {
              cluster_id: 1,
              keywords: ["markdown", "formatting", "code", "text", "guide"],
              representative_chunks: [
                {
                  chunk_id: "md_0",
                  note_id: "md",
                  note_path: "Markdown Guide.md",
                  note_title: "Markdown Guide",
                  chunk_text:
                    "OpenOnyx supports full GitHub Flavored Markdown. Here's a quick reference.",
                },
              ],
              note_count: 1,
            },
            {
              cluster_id: 2,
              keywords: [
                "getting",
                "started",
                "tutorial",
                "shortcuts",
                "linking",
              ],
              representative_chunks: [
                {
                  chunk_id: "gs_0",
                  note_id: "gs",
                  note_path: "Getting Started.md",
                  note_title: "Getting Started",
                  chunk_text:
                    "Welcome to your OpenOnyx vault! Here's everything you need to know.",
                },
              ],
              note_count: 2,
            },
          ],
          total_notes: 5,
          total_chunks: 12,
        };
      },
      query: async (_jobId: string, query: string, _topK?: number) => {
        // Simple mock search
        const results = [];
        const q = query.toLowerCase();
        for (const [path, content] of Object.entries(mockFiles)) {
          if (content.toLowerCase().includes(q)) {
            results.push({
              score: 0.75,
              note_title: path.replace(".md", ""),
              note_path: path,
              chunk_text: content.substring(0, 200),
              cluster_id: 0,
            });
          }
        }
        return { query, results: results.slice(0, 10) };
      },
      clear: async (_jobId: string) => {
        return { status: "cleared", job_id: "mock-job-123" };
      },
      health: async () => true,
    },

    // CSS Snippets (mock)
    snippetsImport: async (_filePaths: string[]) => [],
    snippetsExport: async (_srcRelPath: string, _destAbsPath: string) => {},
  };

  return mockAPI;
}
