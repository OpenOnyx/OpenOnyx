import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

describe("bundled GitHub provider resource contract", () => {
  it("discovers and returns structured resources over real stdio while preserving text", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "openonyx-github-test-"));
    const fixture = path.join(directory, "fixture-fetch.mjs");
    // The process uses the real provider and SDK; only the network is replaced.
    await writeFile(fixture, `
      globalThis.fetch = async (input, options) => {
        const url = new URL(input);
        if (url.origin !== 'https://api.github.com') throw new Error('Unexpected host');
        const item = { html_url: 'https://github.com/OpenOnyx/OpenOnyx/issues/281', title: 'Windows signing', number: 281, state: 'open', body: 'Issue body', comments: 8, labels: [{name:'bug'}], updated_at: '2026-10-01T12:00:00Z' };
        let data;
        if (url.pathname === '/search/issues') {
          const query = url.searchParams.get('q');
          if (query.includes('state:all')) throw new Error('Invalid GitHub state filter');
          if (!query.includes('signpath')) throw new Error('Search query missing');
          data = { items: [item] };
        } else if (url.pathname === '/repos/OpenOnyx/OpenOnyx/issues/281') data = item;
        else if (url.pathname === '/repos/OpenOnyx/OpenOnyx/issues/281/comments') data = [{user: {login:'test-author'}, body:'Test comment'}];
        else if (url.pathname === '/search/repositories') data = {items:[{full_name:'OpenOnyx/OpenOnyx', html_url:'https://github.com/OpenOnyx/OpenOnyx', description:'Local knowledge'}]};
        else throw new Error('Unexpected route');
        return { ok: true, text: async () => JSON.stringify(data) };
      };
    `);
    const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", fixture, path.resolve("scripts/mcp-github-server.mjs")], cwd: directory, stderr: "pipe" });
    const client = new Client({ name: "resource-regression", version: "1.0.0" });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain("get_issue");
      expect(tools.tools.find((tool) => tool.name === "search_issues")?.inputSchema.required).not.toContain("repository");
      const search = await client.callTool({ name: "search_issues", arguments: { query: "signpath is:issue", state: "all", limit: 20 } });
      expect(search.structuredContent).toMatchObject({ items: [{ number: 281, title: "Windows signing", html_url: "https://github.com/OpenOnyx/OpenOnyx/issues/281" }] });
      expect(search.content).toEqual([expect.objectContaining({ type: "text", text: expect.stringContaining("Issue #281 Windows signing") })]);
      const detail = await client.callTool({ name: "get_issue", arguments: { repository: "OpenOnyx/OpenOnyx", number: 281 } });
      expect(detail.structuredContent).toMatchObject({ items: [{ body: "Issue body", comments: 8, labels: [{ name: "bug" }], discussion: [{ author: "test-author", body: "Test comment" }] }] });
      const repositories = await client.callTool({ name: "search_repositories", arguments: { query: "OpenOnyx" } });
      expect(repositories.structuredContent).toMatchObject({ items: [{ full_name: "OpenOnyx/OpenOnyx" }] });
    } finally {
      await client.close();
      await transport.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
