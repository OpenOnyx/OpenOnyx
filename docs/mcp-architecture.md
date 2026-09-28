# User-configurable MCP architecture

Status: proposed

## Purpose

OpenOnyx should let users add and manage their own Model Context Protocol (MCP) servers. MCP support is an application extension point, not a fixed list of integrations maintained in source code.

The first implementation should make server configuration explicit, reviewable, and local. A user must be able to add a server, choose whether it is enabled, inspect the tools it exposes, and remove it without editing application files.

## Design goals

- Keep MCP server processes and network connections in the Electron main process.
- Keep the renderer limited to a typed management and invocation API exposed by preload.
- Support independently managed server configurations rather than hardcoded integrations.
- Make connection state, discovered tools, and failures observable to the user.
- Keep secrets out of ordinary configuration files and diagnostic logs.
- Allow the application to work normally when no MCP servers are configured.
- Add transports incrementally behind one common lifecycle interface.

## Non-goals for the first version

- Bundling or hosting a marketplace of MCP servers.
- Automatically trusting or installing third-party server packages.
- Running arbitrary MCP code in the renderer.
- Making every discovered tool available automatically.
- Replacing OpenOnyx's existing vault and plugin permission boundaries.

## Process and module boundary

```text
Settings and other renderer surfaces
              |
              v
Typed preload API
              |
              v
MCP IPC handlers (main process)
              |
              v
MCP connection manager
       |          |          |
       v          v          v
     stdio   streamable HTTP  SSE
              |
              v
       MCP client implementation
```

The renderer may request configuration changes, connection tests, tool discovery, and approved tool calls. It must not receive child-process handles, unrestricted filesystem access, arbitrary command execution, or a general-purpose network client.

The main process owns:

- configuration validation before persistence or launch;
- server process creation and termination;
- transport connections and reconnect policy;
- secret resolution;
- tool discovery and tool-call validation;
- sanitized diagnostics and lifecycle cleanup.

The preload layer exposes only named, typed operations. MCP IPC channels must validate server IDs, transport-specific input, tool names, and tool arguments before delegating to the manager.

## Configuration ownership

MCP server definitions are application-level settings because a server may be useful across multiple vaults. Vault-specific enablement and tool selection may be added later if users need different MCP policies per vault.

The initial persisted model should distinguish:

- non-secret server configuration;
- secret references, with secret values stored through the operating-system secure storage mechanism;
- enabled state;
- explicitly enabled tool names;
- last-known status and diagnostics, where persisted diagnostics contain no secret values.

A configuration import or export must never include resolved secret values.

## Supported transports

The transport layer should expose one common interface for:

- connect;
- disconnect;
- status;
- list tools;
- call an approved tool;
- report diagnostics.

Implementation order:

1. stdio for local command-based servers;
2. streamable HTTP for remote servers;
3. SSE for compatibility with older MCP servers, if supported by the selected client library.

Transport-specific fields belong in the configuration validator and UI. The connection manager should consume the normalized configuration rather than duplicate transport-specific validation.

## Trust and permission model

Adding a configuration is not the same as trusting a server. Before the first connection, OpenOnyx should show the user what will happen:

- the command and arguments for stdio servers;
- the URL and request metadata for network transports;
- the configured environment-variable names;
- the tools the server exposes;
- the tools currently allowed to OpenOnyx.

A server is disabled by default until the user explicitly confirms it. Newly discovered tools are not automatically approved. Tool calls must be limited to the server's enabled tool set and must surface structured errors to the caller.

MCP permissions must not bypass existing OpenOnyx boundaries. In particular, an MCP tool must not gain unreviewed access to vault files, secrets, or external URLs merely because the MCP server was configured by a user.

## Lifecycle

The connection manager should provide deterministic lifecycle behavior:

- load validated configurations during application startup without connecting disabled servers;
- connect enabled servers only after explicit trust has been recorded;
- expose `connecting`, `connected`, `disconnected`, and `error` states;
- reconnect according to a bounded policy after an unexpected disconnect;
- terminate stdio children and close network connections during application shutdown;
- make repeated enable, disable, and remove operations idempotent.

Failures should identify the server and operation, preserve the underlying cause for diagnostics, and avoid leaking command arguments, environment values, authorization headers, or tool payloads that may contain secrets.

## Delivery sequence

The implementation is intentionally staged:

1. types and validation;
2. persistence and secure secret references;
3. transport adapters;
4. connection manager;
5. tool discovery and invocation;
6. typed IPC and preload bridge;
7. settings management UI;
8. trust review, tool selection, diagnostics, and import/export;
9. fake-server integration tests and contributor documentation.

Each stage should be independently testable and should preserve normal OpenOnyx behavior when MCP support is unused.

## Decisions still open

- Which MCP TypeScript client library and protocol version to pin.
- Whether secret storage should reuse an existing OpenOnyx keychain abstraction or introduce an Electron `safeStorage` adapter.
- Whether tool invocation is initially exposed only to built-in AI workflows or also through a general command surface.
- Whether vault-specific policies are required for the first release.
