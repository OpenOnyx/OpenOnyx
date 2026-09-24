import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  McpConfiguration,
  McpEnvironmentValue,
  McpServerConfig,
  McpServerRuntimeState,
  McpServerSnapshot,
  McpTool,
  McpTransportConfig,
} from "./mcpTypes.js";
import { McpConfigurationStore } from "./mcpConfigStore.js";

type McpTransport = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport;

export interface McpSecretResolver {
  resolve(secretId: string): Promise<string | undefined>;
}

interface ManagedServer {
  config: McpServerConfig;
  runtime: McpServerRuntimeState;
  tools: McpTool[];
  client?: Client;
  transport?: McpTransport;
}

const MAX_DIAGNOSTICS = 20;

function createRuntime(status: McpServerRuntimeState["status"] = "disconnected"): McpServerRuntimeState {
  return { status, diagnostics: [] };
}

function sanitizeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/([A-Za-z_][A-Za-z0-9_-]*(?:key|token|secret|password))=\S+/gi, "$1=[redacted]")
    .slice(0, 500);
}

function resolveValues(
  values: Record<string, McpEnvironmentValue>,
  secretResolver: McpSecretResolver,
): Promise<Record<string, string>> {
  return Promise.all(
    Object.entries(values).map(async ([key, value]) => [
      key,
      value.type === "value" ? value.value : await secretResolver.resolve(value.secretId) ?? "",
    ] as const),
  ).then((entries) => Object.fromEntries(entries));
}

export class McpConnectionManager {
  private readonly servers = new Map<string, ManagedServer>();
  private configuration: McpConfiguration = { servers: {} };

  constructor(
    private readonly store: McpConfigurationStore,
    private readonly secretResolver: McpSecretResolver = { resolve: async () => undefined },
  ) {}

  async load(): Promise<void> {
    this.configuration = await this.store.load();
    this.servers.clear();
    for (const config of Object.values(this.configuration.servers)) {
      this.servers.set(config.id, { config, runtime: createRuntime(config.enabled ? "disconnected" : "disabled"), tools: [] });
    }
  }

  list(): McpServerSnapshot[] {
    return [...this.servers.values()].map(({ config, runtime, tools }) => ({
      config: { ...config, transport: { ...config.transport } },
      runtime: { ...runtime, diagnostics: [...runtime.diagnostics] },
      tools: tools.map((tool) => ({ ...tool })),
    }));
  }

  async upsert(config: McpServerConfig): Promise<McpServerSnapshot> {
    await this.disconnect(config.id);
    this.configuration.servers[config.id] = config;
    await this.store.save(this.configuration);
    this.servers.set(config.id, { config, runtime: createRuntime(config.enabled ? "disconnected" : "disabled"), tools: [] });
    return this.get(config.id)!;
  }

  async remove(id: string): Promise<void> {
    await this.disconnect(id);
    delete this.configuration.servers[id];
    this.servers.delete(id);
    await this.store.save(this.configuration);
  }

  async setEnabled(id: string, enabled: boolean, trusted = false): Promise<McpServerSnapshot> {
    const server = this.require(id);
    if (enabled && !server.config.trusted && !trusted) {
      throw new Error("MCP server trust approval is required before enabling");
    }
    server.config = { ...server.config, enabled, trusted: server.config.trusted || trusted, updatedAt: Date.now() };
    this.configuration.servers[id] = server.config;
    await this.store.save(this.configuration);
    if (enabled) await this.connect(id);
    else await this.disconnect(id);
    return this.get(id)!;
  }

  async connect(id: string): Promise<McpServerSnapshot> {
    const server = this.require(id);
    if (!server.config.trusted) throw new Error("MCP server trust approval is required before connecting");
    if (server.runtime.status === "connected") return this.get(id)!;
    server.runtime = { ...server.runtime, status: "connecting" };
    let transportDiagnostic = "";
    try {
      const client = new Client({ name: "OpenOnyx", version: "1.0.5" }, { capabilities: {} });
      const transport = await this.createTransport(server.config.transport);
      transport.onerror = (error) => {
        transportDiagnostic = sanitizeMessage(error);
      };
      transport.onclose = () => {
        if (server.runtime.status === "connecting" || server.runtime.status === "connected") {
          server.runtime = this.withDiagnostic(
            server.runtime,
            "transport",
            transportDiagnostic || "MCP transport closed unexpectedly",
            "error",
          );
        }
      };
      if (transport instanceof StdioClientTransport) {
        transport.stderr?.on("data", (chunk: Buffer | string) => {
          transportDiagnostic = sanitizeMessage(chunk.toString());
        });
      }
      await client.connect(transport);
      const result = await client.listTools();
      server.client = client;
      server.transport = transport;
      server.tools = result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
      server.runtime = { ...server.runtime, status: "connected", lastConnectedAt: Date.now() };
      return this.get(id)!;
    } catch (error) {
      const message = transportDiagnostic
        ? `${sanitizeMessage(error)}: ${transportDiagnostic}`
        : error;
      server.runtime = this.withDiagnostic(server.runtime, "connect", message, "error");
      await this.disconnect(id, false);
      throw error;
    }
  }

  async disconnect(id: string, updateStatus = true): Promise<void> {
    const server = this.servers.get(id);
    if (!server) return;
    try { await server.client?.close(); } catch { /* cleanup is best effort */ }
    server.client = undefined;
    server.transport = undefined;
    server.tools = [];
    if (updateStatus) server.runtime = { ...server.runtime, status: server.config.enabled ? "disconnected" : "disabled" };
  }

  async callTool(id: string, name: string, args: Record<string, unknown>): Promise<unknown> {
    const server = this.require(id);
    if (!server.config.enabledTools.includes(name)) throw new Error(`MCP tool is not enabled: ${name}`);
    if (!server.client || server.runtime.status !== "connected") await this.connect(id);
    const result = await this.require(id).client!.callTool({ name, arguments: args });
    return result;
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.servers.keys()].map((id) => this.disconnect(id)));
  }

  private get(id: string): McpServerSnapshot | undefined {
    const server = this.servers.get(id);
    if (!server) return undefined;
    return { config: server.config, runtime: server.runtime, tools: server.tools };
  }

  private require(id: string): ManagedServer {
    const server = this.servers.get(id);
    if (!server) throw new Error(`Unknown MCP server: ${id}`);
    return server;
  }

  private async createTransport(config: McpTransportConfig): Promise<McpTransport> {
    if (config.transport === "stdio") {
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: await resolveValues(config.env, this.secretResolver),
      });
    }
    const headers = await resolveValues(config.headers, this.secretResolver);
    if (config.transport === "sse") return new SSEClientTransport(new URL(config.url), { requestInit: { headers } });
    return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers } });
  }

  private withDiagnostic(
    runtime: McpServerRuntimeState,
    operation: string,
    error: unknown,
    status: McpServerRuntimeState["status"],
  ): McpServerRuntimeState {
    const diagnostic = { operation, message: sanitizeMessage(error), timestamp: Date.now() };
    return {
      ...runtime,
      status,
      lastError: diagnostic,
      diagnostics: [...runtime.diagnostics, diagnostic].slice(-MAX_DIAGNOSTICS),
    };
  }
}