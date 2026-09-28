# Developer Guide

OpenOnyx is open source. The desktop uses Electron, React, TypeScript, CodeMirror, D3, local embeddings, and optional Supabase.


## Why it exists

Open source is part of ownership. You can inspect how the app works, contribute a fix, build a plugin, or run the desktop against your own vault.

## When to use it

Use this guide when you want to run OpenOnyx from source, change the app, or understand its process boundary.

## Workflow

Clone repository → install Node.js 22+ dependencies → run development app → test against `OO-Test-Vault` → submit a focused change.

## Commands

```bash
npm ci
npm run dev
npm run lint
npm test
npm run build
```

## Process boundary

```text
Renderer → preload API → Electron IPC → main process → local vault
```

> **OpenOnyx tip**
> Keep renderer access to native capabilities behind the preload API.

> **OpenOnyx common mistake**
> Do not test destructive filesystem work against a personal vault.

## Continue learning

- [Plugins](<Plugins.md>)
- [Reference](<Reference.md>)
- [Troubleshooting](<Troubleshooting.md>)

