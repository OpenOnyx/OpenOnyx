import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  McpConfiguration,
  McpEnabledTool,
  McpEnvironmentValue,
  McpServerConfig,
  McpServerRuntimeState,
  McpServerSnapshot,
  McpTool,
  McpTransportConfig,
} from "./mcpTypes.js";
import { McpConfigurationStore } from "./mcpConfigStore.js";

type McpTransport = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport;
type McpClient = Pick<Client, "connect" | "listTools" | "callTool" | "close">;

export interface McpBundledServerLaunch {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpConnectionManagerOptions {
  createClient?: () => McpClient;
  createTransport?: (config: McpTransportConfig) => McpTransport | Promise<McpTransport>;
  resolveBundledServer?: (provider: string, args: string[]) => McpBundledServerLaunch | Promise<McpBundledServerLaunch>;
  operationTimeoutMs?: number;
  shutdownTimeoutMs?: number;
}

export interface McpSecretResolver {
  resolve(secretId: string): Promise<string | undefined>;
}

interface ManagedServer {
  config: McpServerConfig;
  runtime: McpServerRuntimeState;
  tools: McpTool[];
  client?: McpClient;
  transport?: McpTransport;
  attempt?: ConnectionAttempt;
}

interface ConnectionAttempt {
  client: McpClient;
  transport?: McpTransport;
  cancelled: boolean;
}

export const BUNDLED_MCP_COMMAND = "__openonyx_bundled_mcp__";

const MAX_DIAGNOSTICS = 20;
const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;
const BUNDLED_SCRIPT_BY_PROVIDER: Record<string, string> = {
  github: "mcp-github-server.mjs",
  filesystem: "mcp-dev-filesystem-server.mjs",
  "local-test": "mcp-dev-echo-server.mjs",
};
const PROVIDER_BY_BUNDLED_SCRIPT = new Map(Object.entries(BUNDLED_SCRIPT_BY_PROVIDER).map(([provider, script]) => [`scripts/${script}`, provider]));

class McpConnectionCancelledError extends Error {
  constructor() {
    super("MCP connection was cancelled");
    this.name = "McpConnectionCancelledError";
  }
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (!Number.isFinite(timeoutMs)) return operation;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    timer.unref?.();
    operation.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

function createRuntime(status: McpServerRuntimeState["status"] = "disconnected"): McpServerRuntimeState {
  return { status, diagnostics: [] };
}

function sanitizeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b([A-Za-z_][A-Za-z0-9_-]*(?:key|token|secret|password)|key|token|secret|password)=\S+/gi, "$1=[redacted]")
    .slice(0, 500);
}

function resolveValues(
  values: Record<string, McpEnvironmentValue>,
  secretResolver: McpSecretResolver,
): Promise<Record<string, string>> {
  return Promise.all(
    Object.entries(values).map(async ([key, value]) => [
      key,
      value.type === "value" ? value.value : await secretResolver.resolve(value.secretId).then((secret) => {
        if (secret === undefined) throw new Error(`MCP secret is unavailable: ${value.secretId}`);
        return secret;
      }),
    ] as const),
  ).then((entries) => Object.fromEntries(entries));
}

export class McpConnectionManager {
  private readonly servers = new Map<string, ManagedServer>();
  private readonly connections = new Map<string, Promise<McpServerSnapshot>>();
  private configuration: McpConfiguration = { servers: {} };

  constructor(
    private readonly store: McpConfigurationStore,
    private readonly secretResolver: McpSecretResolver = { resolve: async () => undefined },
    private readonly options: McpConnectionManagerOptions = {},
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

  async upsert(input: McpServerConfig): Promise<McpServerSnapshot> {
    const existing = this.servers.get(input.id);
    const transportChanged = Boolean(existing)
      && JSON.stringify(existing!.config.transport) !== JSON.stringify(input.transport);
    const now = Date.now();
    const config: McpServerConfig = {
      ...input,
      enabled: existing && !transportChanged ? existing.config.enabled : false,
      trusted: existing && !transportChanged ? existing.config.trusted : false,
      createdAt: existing?.config.createdAt ?? now,
      updatedAt: now,
    };
    if (transportChanged) await this.disconnect(config.id);
    this.configuration.servers[config.id] = config;
    await this.store.save(this.configuration);
    if (existing && !transportChanged) {
      existing.config = config;
      if (!config.enabled) existing.runtime = { ...existing.runtime, status: "disabled" };
    } else {
      this.servers.set(config.id, { config, runtime: createRuntime(config.enabled ? "disconnected" : "disabled"), tools: [] });
    }
    return this.get(config.id)!;
  }

  async remove(id: string): Promise<void> {
    await this.disconnect(id);
    delete this.configuration.servers[id];
    this.servers.delete(id);
    await this.store.save(this.configuration);
  }

  async setEnabled(id: string, enabled: boolean): Promise<McpServerSnapshot> {
    const server = this.require(id);
    if (enabled && !server.config.trusted) throw new Error("MCP server trust approval is required before enabling");
    server.config = { ...server.config, enabled, updatedAt: Date.now() };
    this.configuration.servers[id] = server.config;
    await this.store.save(this.configuration);
    if (enabled) await this.connect(id);
    else await this.disconnect(id);
    return this.get(id)!;
  }

  async approveAndEnable(id: string): Promise<McpServerSnapshot> {
    const server = this.require(id);
    server.config = { ...server.config, enabled: true, trusted: true, updatedAt: Date.now() };
    this.configuration.servers[id] = server.config;
    await this.store.save(this.configuration);
    await this.connect(id);
    return this.get(id)!;
  }

  async revokeTrust(id: string): Promise<McpServerSnapshot> {
    const server = this.require(id);
    await this.disconnect(id);
    server.config = { ...server.config, enabled: false, trusted: false, updatedAt: Date.now() };
    this.configuration.servers[id] = server.config;
    await this.store.save(this.configuration);
    server.runtime = { ...server.runtime, status: "disabled" };
    return this.get(id)!;
  }

  async connect(id: string): Promise<McpServerSnapshot> {
    const pending = this.connections.get(id);
    if (pending) return pending;
    const operation = this.connectInternal(id);
    this.connections.set(id, operation);
    try {
      return await operation;
    } finally {
      if (this.connections.get(id) === operation) this.connections.delete(id);
    }
  }

  async reconnect(id: string): Promise<McpServerSnapshot> {
    await this.disconnect(id);
    return this.connect(id);
  }

  listEnabledTools(): McpEnabledTool[] {
    return this.list().flatMap((server) => server.tools.map((tool) => ({
      serverId: server.config.id,
      serverName: server.config.name,
      serverStatus: server.runtime.status,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      enabled: server.config.enabledTools.includes(tool.name),
      favorite: server.config.favoriteTools.includes(tool.name),
      requiresConfirmation: true as const,
    }))).filter((tool) => tool.enabled);
  }

  private async connectInternal(id: string): Promise<McpServerSnapshot> {
    const server = this.require(id);
    if (!server.config.enabled) throw new Error("MCP server is disabled");
    if (!server.config.trusted) throw new Error("MCP server trust approval is required before connecting");
    if (server.runtime.status === "connected") return this.get(id)!;
    server.runtime = { ...server.runtime, status: "connecting" };
    let transportDiagnostic = "";
    const client = this.options.createClient?.()
      ?? new Client({ name: "OpenOnyx", version: "1.0.5" }, { capabilities: {} });
    const attempt: ConnectionAttempt = { client, cancelled: false };
    server.attempt = attempt;
    server.client = client;
    try {
      const transport = await withTimeout(
        Promise.resolve(this.options.createTransport?.(server.config.transport) ?? this.createTransport(server.config.transport)),
        this.operationTimeoutMs,
        "Timed out while creating the MCP transport",
      );
      attempt.transport = transport;
      if (!this.isCurrentAttempt(id, server, attempt)) throw new McpConnectionCancelledError();
      server.transport = transport;
      transport.onerror = (error) => {
        transportDiagnostic = sanitizeMessage(error);
      };
      transport.onclose = () => {
        if (this.isCurrentConnection(id, server, client, transport)
          && (server.runtime.status === "connecting" || server.runtime.status === "connected")) {
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
      await withTimeout(
        client.connect(transport),
        this.operationTimeoutMs,
        "Timed out while connecting to the MCP server",
      );
      if (!this.isCurrentAttempt(id, server, attempt)) throw new McpConnectionCancelledError();
      const result = await withTimeout(
        client.listTools(),
        this.operationTimeoutMs,
        "Timed out while listing MCP tools",
      );
      if (!this.isCurrentAttempt(id, server, attempt)) throw new McpConnectionCancelledError();
      server.tools = result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
      server.attempt = undefined;
      server.runtime = { ...server.runtime, status: "connected", lastConnectedAt: Date.now() };
      return this.get(id)!;
    } catch (error) {
      const isCurrent = server.attempt === attempt && this.servers.get(id) === server;
      if (isCurrent && !(error instanceof McpConnectionCancelledError)) {
        const message = transportDiagnostic
          ? `${sanitizeMessage(error)}: ${transportDiagnostic}`
          : error;
        server.runtime = this.withDiagnostic(server.runtime, "connect", message, "error");
      }
      await this.closeResources(attempt.client, attempt.transport);
      if (isCurrent) {
        server.attempt = undefined;
        server.client = undefined;
        server.transport = undefined;
        server.tools = [];
      }
      throw error;
    }
  }

  async disconnect(id: string, updateStatus = true): Promise<void> {
    const server = this.servers.get(id);
    if (!server) return;
    const attempt = server.attempt;
    if (attempt) attempt.cancelled = true;
    server.attempt = undefined;
    this.connections.delete(id);
    const client = server.client;
    const transport = server.transport ?? attempt?.transport;
    server.client = undefined;
    server.transport = undefined;
    server.tools = [];
    await this.closeResources(client, transport);
    if (updateStatus) server.runtime = { ...server.runtime, status: server.config.enabled ? "disconnected" : "disabled" };
  }

  async callTool(id: string, name: string, args: Record<string, unknown>): Promise<unknown> {
    const server = this.require(id);
    if (!server.config.enabled) throw new Error("MCP server is disabled");
    if (!server.config.enabledTools.includes(name)) throw new Error(`MCP tool is not enabled: ${name}`);
    if (!server.client || server.runtime.status !== "connected") await this.connect(id);
    try {
      return await withTimeout(
        this.require(id).client!.callTool({ name, arguments: args }),
        this.operationTimeoutMs,
        "Timed out while running MCP tool",
      );
    } catch (error) {
      server.runtime = this.withDiagnostic(server.runtime, "tool", error, "error");
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    const pending = [...this.connections.values()];
    await Promise.all([...this.servers.keys()].map((id) => this.disconnect(id)));
    await withTimeout(
      Promise.allSettled(pending).then(() => undefined),
      this.shutdownTimeoutMs,
      "Timed out while shutting down MCP connections",
    ).catch(() => { /* shutdown is best effort after transports have been closed */ });
  }

  private get operationTimeoutMs(): number {
    return this.options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
  }

  private get shutdownTimeoutMs(): number {
    return this.options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  }

  private isCurrentAttempt(id: string, server: ManagedServer, attempt: ConnectionAttempt): boolean {
    return !attempt.cancelled && this.servers.get(id) === server && server.attempt === attempt;
  }

  private isCurrentConnection(
    id: string,
    server: ManagedServer,
    client: McpClient,
    transport: McpTransport,
  ): boolean {
    return this.servers.get(id) === server && server.client === client && server.transport === transport;
  }

  private async closeResources(client?: McpClient, transport?: McpTransport): Promise<void> {
    let clientClosed = false;
    if (client) {
      try {
        await withTimeout(client.close(), this.shutdownTimeoutMs, "Timed out while closing the MCP client");
        clientClosed = true;
      } catch { /* cleanup is best effort */ }
    }
    if (transport && !clientClosed) {
      try {
        await withTimeout(transport.close(), this.shutdownTimeoutMs, "Timed out while closing the MCP transport");
      } catch { /* cleanup is best effort */ }
    }
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
      const env = await resolveValues(config.env, this.secretResolver);
      const bundled = this.getBundledServerRequest(config);
      if (bundled) {
        const launch = await this.resolveBundledServer(bundled.provider, bundled.args);
        return new StdioClientTransport({
          command: launch.command,
          args: launch.args,
          env: { ...env, ...(launch.env ?? {}) },
          cwd: launch.cwd,
          stderr: "pipe",
        });
      }
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env,
        stderr: "pipe",
      });
    }
    const headers = await resolveValues(config.headers, this.secretResolver);
    if (config.transport === "sse") return new SSEClientTransport(new URL(config.url), { requestInit: { headers } });
    return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers } });
  }

  private getBundledServerRequest(config: Extract<McpTransportConfig, { transport: "stdio" }>): { provider: string; args: string[] } | null {
    if (config.command === BUNDLED_MCP_COMMAND) {
      const [provider, ...args] = config.args;
      return provider ? { provider, args } : null;
    }
    const normalizedCommand = config.command.split(/[\/]/).pop()?.toLowerCase();
    const normalizedScript = config.args[0]?.replace(/\\/g, "/");
    if ((normalizedCommand === "node" || normalizedCommand === "node.exe") && normalizedScript) {
      const provider = PROVIDER_BY_BUNDLED_SCRIPT.get(normalizedScript);
      if (provider) return { provider, args: config.args.slice(1) };
    }
    return null;
  }

  private async resolveBundledServer(provider: string, args: string[]): Promise<McpBundledServerLaunch> {
    const launch = await this.options.resolveBundledServer?.(provider, args);
    if (launch) return launch;
    const script = BUNDLED_SCRIPT_BY_PROVIDER[provider];
    if (!script) throw new Error(`Unknown bundled MCP provider: ${provider}`);
    return {
      command: process.execPath,
      args: [`scripts/${script}`, ...args],
      env: { ELECTRON_RUN_AS_NODE: "1" },
      cwd: process.cwd(),
    };
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
