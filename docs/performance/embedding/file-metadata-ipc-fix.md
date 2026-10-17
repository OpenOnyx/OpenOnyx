# fs:fileMetadata runtime mismatch

## Root cause

The embedding refactor added `fs:fileMetadata` to preload and the filesystem IPC
registration. At investigation time the handler existed in both `electron/ipc.ts`
and `dist-electron/ipc.js`, and `registerIpcHandlers` ran before `createWindow`.
There was no channel spelling mismatch or late registration in the current code.

The active Electron main process (PID 274309) started on October 11, 2026 at
23:29:16, before the refactor. The compiled IPC/preload files observed at the
start of investigation were written on October 12 at 00:29:36. Node retains the
already imported main-process module; rebuilding files or Vite renderer reloads
does not update that process's IPC registry. A refreshed renderer/preload could
therefore invoke a new channel against the old main process.

Call path: background queue → API bridge → preload `ipcRenderer.invoke` →
`registerIpcHandlers` → `FileSystemManager.fileMetadata`. The exposed renderer
type is derived from `ElectronAPI` in preload through `src/vite-env.d.ts`.

## Changes

- One shared channel constant and `{ modifiedAt, size } | null` contract keep
  native registration and preload consistent; no duplicate handler was added.
- Metadata uses asynchronous realpath/stat, the existing vault resolver, and
  containment checks against the canonical vault. Traversal, invalid input,
  escaping symlinks, and wrong vault identities reject. Missing files,
  nonexistent parent directories, and directory probes return null.
- The API distinguishes missing preload capabilities, missing main handlers,
  and incompatible responses from ordinary file access failures.
- The queue coalesces capability probes, checks before consuming/pruning work,
  pauses once on infrastructure failure, and persists pending jobs. A handler
  disappearing during a batch requeues its unprocessed remainder without
  replacing newer pending revisions. Missing files are skipped without deleting
  existing embeddings. Normal file events do not trigger repeated failed probes.
- `resumeProcessing(api)` explicitly verifies recovery before resuming. A full
  restart also clears the transient failure state and restores persisted work.
- The development launcher rebuilds missing/stale native output before launch
  and warns once when Electron sources change while it is running. It does not
  forcibly restart the application or interrupt unsaved edits.

No embedding model, worker, scheduler, chunk cache, embedding schema, search,
suggestion, or Spaces implementation was reverted. Browser mock metadata now
returns byte sizes for existing mock notes rather than always returning null.

## Why earlier tests missed it

The original queue tests mocked inference and passed an API without metadata;
the optional metadata branch silently skipped the call. Builds/typechecks
verified current files, not the IPC registry of an Electron process that had
already been running. There was no actual preload-to-registration metadata
contract test or stale-native-output launcher guard.

Regression coverage now uses the real preload and registration functions with
a controlled IPC transport and real temporary filesystem fixtures. It covers
registration, startup order, metadata/Unicode byte sizes, missing files,
invalid/unauthorized paths, symlink escape, missing/incompatible capabilities,
concurrent queue starts, preserved jobs, mid-batch failure, explicit recovery,
and native build freshness. No real user vaults or AI credentials are used.

## Restart requirement

**A full Electron restart is required for the currently running process.** Stop
the existing development session with Ctrl+C, then run `npm run dev` again.
Reloading the window, renderer hot reload, or only rebuilding Electron files is
insufficient. The agent did not stop or launch the application.
