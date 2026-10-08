// @vitest-environment jsdom

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdvancedMcpPage,
  AppDetails,
  AppsHome,
} from "../src/components/settings/components/connections/ConnectionsPages";
import type { ConnectionsActions, ConnectionsData } from "../src/components/settings/components/connections/types";
import type { McpServerSnapshot } from "../src/types/mcp";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const githubServer: McpServerSnapshot = {
  config: {
    id: "github",
    name: "GitHub",
    enabled: true,
    trusted: true,
    enabledTools: ["search_repositories"],
    favoriteTools: ["search_repositories"],
    transport: {
      transport: "stdio",
      command: "/usr/bin/node",
      args: ["/home/user/mcp-github-server.mjs"],
      env: {},
    },
    createdAt: 1,
    updatedAt: 1,
  },
  runtime: {
    status: "connected",
    lastConnectedAt: Date.now(),
    diagnostics: [],
  },
  tools: [
    {
      name: "search_repositories",
      description: "Search public GitHub repositories.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "integer", default: 5, minimum: 1, maximum: 20 },
        },
        required: ["query"],
      },
    },
  ],
};

function actions(): ConnectionsActions {
  return {
    refresh: vi.fn(async () => {}),
    connect: vi.fn(async () => {}),
    reconnect: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    revokeTrust: vi.fn(async () => {}),
    saveServer: vi.fn(async () => {}),
    toggleTool: vi.fn(async () => {}),
    toggleFavorite: vi.fn(async () => {}),
    runTool: vi.fn(async () => {}),
    clearActivity: vi.fn(async () => {}),
  };
}

function data(overrides: Partial<ConnectionsData> = {}): ConnectionsData {
  return {
    servers: [githubServer],
    tools: [{ server: githubServer, tool: githubServer.tools[0] }],
    activity: [],
    toolRuns: {},
    busy: false,
    error: null,
    ...overrides,
  };
}

const baseProps = {
  actions: actions(),
  onOpenConnection: vi.fn(),
  onOpenTool: vi.fn(),
  onAddConnection: vi.fn(),
  onViewApps: vi.fn(),
  onViewAdvanced: vi.fn(),
  onConfigureApp: vi.fn(),
  onInstallApp: vi.fn(async () => {}),
  updateToolRun: vi.fn(),
};

async function render(element: React.ReactElement): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(element);
  });
  return container;
}

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("MCP-backed Apps settings information architecture", () => {
  it("keeps raw MCP configuration out of Apps home", async () => {
    const container = await render(React.createElement(AppsHome, {
      ...baseProps,
      data: data(),
    }));

    expect(container.textContent).toContain("Apps");
    expect(container.textContent).toContain("GitHub");
    expect(container.textContent).toContain("Connected");
    expect(container.textContent).not.toContain("capabilities enabled");
    expect(container.textContent).not.toContain("search repositories");
    expect(container.textContent).not.toContain("/usr/bin/node");
    expect(container.textContent).not.toContain("inputSchema");
  });


  it("shows a populated app catalog without fake add actions", async () => {
    const container = await render(React.createElement(AppsHome, {
      ...baseProps,
      data: data(),
    }));

    expect(container.textContent).toContain("Google Calendar");
    expect(container.textContent).toContain("Discord");
    expect(container.textContent).toContain("Coming soon");
    expect(container.textContent).toContain("Custom MCP");
  });

  it("shows GitHub resources instead of raw capabilities or runners", async () => {
    const container = await render(React.createElement(AppDetails, {
      ...baseProps,
      data: data(),
      server: githubServer,
      onBack: vi.fn(),
      selectedToolKey: null,
    }));

    expect(container.textContent).toContain("Quick access");
    expect(container.textContent).toContain("Repositories");
    expect(container.textContent).toContain("Markdown editor");
    expect(container.textContent).not.toContain("Capabilities");
    expect(container.textContent).not.toContain("Always asks before running");
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(container.textContent).not.toContain("Advanced input");
    expect(container.textContent).not.toContain("search_repositories");
  });

  it("manages grouped GitHub permissions without enabling unknown discovered tools", async () => {
    const actionsForTest = actions();
    const server = { ...githubServer, tools: [...githubServer.tools, { name: "untrusted_new_action", inputSchema: {} }] };
    const container = await render(React.createElement(AppDetails, { ...baseProps, actions: actionsForTest, data: data(), server, onBack: vi.fn() }));
    const manage = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Manage")!;
    await act(async () => { manage.click(); });
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => { checkbox.click(); });
    expect(actionsForTest.saveServer).toHaveBeenCalledWith(expect.objectContaining({ enabledTools: [], trusted: true, transport: githubServer.config.transport }));
    expect(container.textContent).not.toContain("untrusted_new_action");
  });

  it("keeps raw commands in Advanced app settings", async () => {
    const container = await render(React.createElement(AdvancedMcpPage, {
      ...baseProps,
      data: data(),
    }));

    expect(container.textContent).toContain("Custom MCP");
    expect(container.textContent).toContain("/usr/bin/node /home/user/mcp-github-server.mjs");
  });
});
