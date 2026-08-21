import React, { useState, useEffect, useRef, useCallback } from "react";
import { Editor } from "../editor/Editor";
import { EditorHeader } from "../editor/EditorHeader";
import { Tab, ViewMode, Theme, PaneLeaf } from "../../types";
import type { AppSettings } from "../settings/SettingsPage";
import { NewTabView } from "./NewTabView";
import { getAPI } from "../../utils/api";
import { updateFrontmatter } from "../../utils/frontmatter";
import { buildMarkdownPdfHtml, getPdfDefaultPath } from "../../utils/pdfExport";
import { type LinkType } from "../ai/SuggestionBanner";
import type { EnrichedSuggestion } from "../../utils/suggestion-enrichment";
import { authManager } from "../../lib/auth";
import { collaborationEngine, type RemoteDocumentMeta } from "../../lib/collaborationEngine";
import { syncEngine, normalizeSyncPath } from "../../lib/syncEngine";
import { localDB } from "../../lib/localdb";
import { supabase } from "../../lib/supabase";
import type { CollabOperation, CursorPresence } from "../../utils/collabOperations";
import { operationToChangeSpec, clampOperation } from "../../utils/collabOperations";
import { setCursorsEffect } from "../../utils/remoteCursorsPlugin";
import { normalizeVersion, sha256Hex } from "../../utils/collabDocument";
import { Transaction } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { yDocManager, type OpenDocResult } from "../../lib/yDocManager";

const api = getAPI();


interface LeafPaneEditorProps {
  leaf: PaneLeaf;
  activeTab: Tab;
  theme: string;
  settings: AppSettings;
  allNoteNames: { name: string; path: string }[];
  editorSuggestions: EnrichedSuggestion[];
  editorNextStepSuggestions: EnrichedSuggestion[];
  inlineAnnotation: string | null;
  showInlineInsight: boolean;
  isFocused: boolean;

  onTabSelect: (leafId: string, tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onLinkClick: (linkName: string, heading?: string) => void;
  onImagePaste: (file: File) => Promise<string | null>;
  getNoteContent: (noteName: string) => string | null;
  onAdjustFontSize: (delta: number, scope: "both" | "editor" | "preview") => void;
  onAcceptSuggestion: (path: string, linkType: LinkType) => void;
  onRejectSuggestion: (path: string) => void;
  onOpenNote: (path: string) => void;
  onToggleInsight: (show: boolean) => void;
  onContentChangeGlobal: (path: string, content: string, markModified?: boolean) => void;
  activeUsers?: any[];
  getViewState?: (path: string) => { scroll?: number; cursor?: number; viewMode?: ViewMode } | undefined;
  onViewStateChange?: (path: string, state: { scroll?: number; cursor?: number; viewMode?: ViewMode }) => void;
  onGenerateInsight?: () => void;
  isGeneratingInsight?: boolean;
  onToggleBacklinks?: () => void;
  onSplitRight?: (leafId: string, tab: Tab) => void;
  onSplitDown?: (leafId: string, tab: Tab) => void;
  onRenameFileMenu?: (path: string) => void;
  onMoveFileMenu?: (path: string) => void;
  onBookmarkFile?: (path: string) => void;
  onCopyRelativePath?: (path: string) => void;
  onCopyAbsolutePath?: (path: string) => void;
  onOpenInDefaultApp?: (path: string) => void;
  onShowInSystemExplorer?: (path: string) => void;
  onRevealInNavigation?: (path: string) => void;
  onDeleteFile?: (path: string) => void;
  onPromptInput?: (title: string, message: string, defaultValue?: string) => Promise<string | null>;
  onShowToast?: (message: string, type?: "success" | "error" | "info") => void;
  canCopyAbsolutePath?: boolean;
  onFocusLeaf?: (leafId: string) => void;
}

export function LeafPaneEditor({
  leaf,
  activeTab,
  theme,
  settings,
  allNoteNames,
  editorSuggestions,
  editorNextStepSuggestions,
  inlineAnnotation,
  showInlineInsight,
  isFocused,

  onTabSelect,
  onTabClose,
  onLinkClick,
  onImagePaste,
  getNoteContent,
  onAdjustFontSize,
  onAcceptSuggestion,
  onRejectSuggestion,
  onOpenNote,
  onToggleInsight,
  onContentChangeGlobal,
  activeUsers = [],
  getViewState,
  onViewStateChange,
  onGenerateInsight,
  isGeneratingInsight,
  onToggleBacklinks,
  onSplitRight,
  onSplitDown,
  onRenameFileMenu,
  onMoveFileMenu,
  onBookmarkFile,
  onCopyRelativePath,
  onCopyAbsolutePath,
  onOpenInDefaultApp,
  onShowInSystemExplorer,
  onRevealInNavigation,
  onDeleteFile,
  onPromptInput,
  onShowToast,
  canCopyAbsolutePath,
  onFocusLeaf,
}: LeafPaneEditorProps) {
  const [content, setContent] = useState<string>("");
  const [contentPath, setContentPath] = useState<string>(activeTab.path);
  const [isLoading, setIsLoading] = useState<boolean>(activeTab.path !== "__new_tab__");
  const [viewMode, setViewMode] = useState<ViewMode>("editor");
  const [fileExists, setFileExists] = useState<boolean>(true);
  const contentCacheRef = useRef<Map<string, string>>(new Map());
  const activeTabPathRef = useRef(activeTab.path);
  useEffect(() => {
    activeTabPathRef.current = activeTab.path;
  }, [activeTab.path]);
  const onContentChangeGlobalRef = useRef(onContentChangeGlobal);
  useEffect(() => {
    onContentChangeGlobalRef.current = onContentChangeGlobal;
  }, [onContentChangeGlobal]);
  const autoSaveTimer = useRef<NodeJS.Timeout | null>(null);
  const dbSyncTimer = useRef<NodeJS.Timeout | null>(null);
  const [isSelfTyping, setIsSelfTyping] = useState<boolean>(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const cursorDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const remotePersistTimerRef = useRef<NodeJS.Timeout | null>(null);
  const fullDocumentBroadcastTimerRef = useRef<NodeJS.Timeout | null>(null);
  const docVersionRef = useRef<number>(0);
  const docHashRef = useRef<string>("");
  const pendingLocalVersionRef = useRef<{ base: number; next: number } | null>(null);
  const recentLocalEditsRef = useRef<Array<{ from: number; to: number; at: number }>>([]);
  const desyncCountRef = useRef<number>(0);
  const [collabFailSafe, setCollabFailSafe] = useState<boolean>(false);

  // Ref to the CodeMirror EditorView -- needed to apply remote operations
  // directly without going through React state (which would cause full-doc replace).
  const editorViewRef = useRef<EditorView | null>(null);

  // ── Yjs CRDT Feature Flag ───────────────────────────────────────────────────
  // Enabled by default for all collaborative spaces. Can be disabled only if
  // explicitly set to 'false' in localStorage.
  const useCRDT = typeof localStorage !== 'undefined'
    && localStorage.getItem('experimentalCRDT') !== 'false'
    && !!collaborationEngine.activeSpaceId
    && !collaborationEngine.collabPaused;

  const [yCollabExtension, setYCollabExtension] = useState<Extension | undefined>(undefined);
  const yDocResultRef = useRef<OpenDocResult | null>(null);

  // Open/close Y.Doc when CRDT mode activates/deactivates or tab changes
  useEffect(() => {
    if (!useCRDT || activeTab.path === '__new_tab__') {
      setYCollabExtension(undefined);
      return;
    }

    const spaceId = collaborationEngine.activeSpaceId;
    if (!spaceId) {
      setYCollabExtension(undefined);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        // Dynamically import y-codemirror.next to keep bundle size down
        // when CRDT is not active.
        const [{ yCollab, yUndoManagerKeymap }, { keymap }] = await Promise.all([
          import('y-codemirror.next'),
          import('@codemirror/view'),
        ]);

        const result = await yDocManager.openDoc(activeTab.path, spaceId);
        if (cancelled) {
          yDocManager.closeDoc(activeTab.path, spaceId);
          return;
        }

        yDocResultRef.current = result;

        const ext: Extension = [
          yCollab(result.text, result.awareness, { undoManager: result.undoManager }),
          keymap.of(yUndoManagerKeymap),
        ];
        console.log(`[YJS] Bound CodeMirror for note: ${activeTab.path} (guid: ${result.doc.guid})`);
        setYCollabExtension(ext);
      } catch (err) {
        console.error('[CRDT] Failed to open Y.Doc:', err);
        setYCollabExtension(undefined);
      }
    })();

    return () => {
      cancelled = true;
      if (yDocResultRef.current && spaceId) {
        yDocManager.closeDoc(activeTab.path, spaceId);
        yDocResultRef.current = null;
      }
      setYCollabExtension(undefined);
    };
  }, [useCRDT, activeTab.path]);

  const handleEditorViewReady = useCallback((view: EditorView | null) => {
    editorViewRef.current = view;
  }, []);

  // Remote cursor presence state for the current file
  const [remoteCursors, setRemoteCursors] = useState<CursorPresence[]>([]);

  // Refs for debouncing typing content updates to prevent react lags
  const latestContentRef = useRef<string>("");
  const latestContentPathRef = useRef<string>(activeTab.path);
  const contentDebounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const flushContentDebounce = useCallback(() => {
    if (contentDebounceTimeoutRef.current) {
      clearTimeout(contentDebounceTimeoutRef.current);
      contentDebounceTimeoutRef.current = null;
      const path = latestContentPathRef.current;
      contentCacheRef.current.set(path, latestContentRef.current);
      if (activeTabPathRef.current === path) {
        setContent(latestContentRef.current);
      }
      onContentChangeGlobal(path, latestContentRef.current);
    }
  }, [onContentChangeGlobal]);

  // Stable ref for auto-save and sync tracking to prevent tab-switch race conditions
  const pendingSaveRef = useRef<{
    path: string;
    content: string;
    collabMeta: {
      version: number;
      last_modified?: string;
      client_id?: string | null;
    } | null;
  } | null>(null);

  // Unified callback to immediately flush any pending save
  const flushSave = useCallback(async () => {
    // 0. Flush any debounced content changes first
    flushContentDebounce();

    // 1. Clear auto-save timer if active
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }

    // 2. Clear collab DB sync timer if active
    if (dbSyncTimer.current) {
      clearTimeout(dbSyncTimer.current);
      dbSyncTimer.current = null;
    }

    const pending = pendingSaveRef.current;
    if (pending) {
      pendingSaveRef.current = null;
      const { path, content, collabMeta } = pending;

      if (path && path !== "__new_tab__") {
        // Run disk save immediately
        try {
          await api.writeFile(path, content);
          window.dispatchEvent(
            new CustomEvent("openonyx:note-saved", {
              detail: { path },
            })
          );
        } catch (err) {
          console.error("Flush disk save failed:", err);
        }

        // Run collab DB sync immediately if applicable
        if (collabMeta) {
          try {
            const hash = await sha256Hex(content);
            await collaborationEngine.persistNoteEdit(path, content, {
              version: collabMeta.version,
              last_modified: collabMeta.last_modified || new Date().toISOString(),
              client_id: collabMeta.client_id || null,
              content_hash: hash,
            });
            syncEngine.triggerPush();
          } catch (err) {
            console.error("[Collab] Flush DB sync failed:", err);
          }
        }
      }
    }
  }, [flushContentDebounce]);

  const flushSaveRef = useRef(flushSave);
  useEffect(() => {
    flushSaveRef.current = flushSave;
  }, [flushSave]);

  // Load content when the active tab changes
  useEffect(() => {
    // Flush any pending changes of the previous note before switching tabs or loading new content
    void flushSaveRef.current();

    let isActive = true;
    
    const cachedContent = contentCacheRef.current.get(activeTab.path);
    setIsLoading(cachedContent === undefined);
    setFileExists(true);

    if (activeTab.path === "__new_tab__") {
      setContentPath(activeTab.path);
      setContent("");
      latestContentRef.current = "";
      latestContentPathRef.current = activeTab.path;
      setIsLoading(false);
      return;
    } else if (cachedContent !== undefined) {
      setContentPath(activeTab.path);
      setContent(cachedContent);
      latestContentRef.current = cachedContent;
      latestContentPathRef.current = activeTab.path;
    } else {
      setContentPath(activeTab.path);
      setContent("");
      latestContentRef.current = "";
      latestContentPathRef.current = activeTab.path;
    }
    
    const loadContent = async () => {
      try {
        const exists = await api.fileExists(activeTab.path);
        if (!isActive) return;
        if (!exists) {
          setFileExists(false);
          setIsLoading(false);
          return;
        }
        const c = await api.readFile(activeTab.path);
        if (!isActive) return;
        const spaceId = collaborationEngine.activeSpaceId;
        if (spaceId) {
          const note = await localDB.getNoteByPath(spaceId, activeTab.path);
          if (!isActive) return;
          docVersionRef.current = normalizeVersion(note?.version);
          docHashRef.current = note?.content_hash || await sha256Hex(c);
        } else {
          docVersionRef.current = 0;
          docHashRef.current = await sha256Hex(c);
        }
        contentCacheRef.current.set(activeTab.path, c);
        setContentPath(activeTab.path);
        setContent(c);
        latestContentRef.current = c;
        latestContentPathRef.current = activeTab.path;
        onContentChangeGlobalRef.current(activeTab.path, c, false);
        setIsLoading(false);
      } catch (err) {
        if (isActive) {
          setFileExists(false);
          setContentPath(activeTab.path);
          setContent("");
          latestContentRef.current = "";
          latestContentPathRef.current = activeTab.path;
          setIsLoading(false);
          console.error("Failed to load note content:", err);
        }
      }
    };

    void loadContent();

    return () => {
      isActive = false;
    };
  }, [activeTab.path]);

  // ── Content Change Handler ──────────────────────────────────────────────────

  const handleContentChange = useCallback((newContent: string, isUserEdit?: boolean, sourcePath = activeTab.path) => {
    if (!sourcePath || sourcePath === "__new_tab__") return;
    latestContentRef.current = newContent;
    latestContentPathRef.current = sourcePath;

    if (!isUserEdit) {
      if (contentDebounceTimeoutRef.current) {
        clearTimeout(contentDebounceTimeoutRef.current);
        contentDebounceTimeoutRef.current = null;
      }
      if (activeTabPathRef.current === sourcePath) {
        setContent(newContent);
      }
      contentCacheRef.current.set(sourcePath, newContent);
      onContentChangeGlobal(sourcePath, newContent, false);
      return;
    }

    if (contentDebounceTimeoutRef.current) {
      clearTimeout(contentDebounceTimeoutRef.current);
    }
    contentDebounceTimeoutRef.current = setTimeout(() => {
      contentDebounceTimeoutRef.current = null;
      if (activeTabPathRef.current === sourcePath) {
        setContent(newContent);
      }
      contentCacheRef.current.set(sourcePath, newContent);
      onContentChangeGlobal(sourcePath, newContent);
    }, 250);

    // Presence: mark as typing
    const isCollabSpace = !!collaborationEngine.activeSpaceId && !collaborationEngine.collabPaused && !collabFailSafe;
    let localEditMeta: RemoteDocumentMeta | null = null;
    if (isCollabSpace && !collabFailSafe) {
      const base = docVersionRef.current;
      const next = base + 1;
      docVersionRef.current = next;
      pendingLocalVersionRef.current = { base, next };
      localEditMeta = {
        version: next,
        last_modified: new Date().toISOString(),
        client_id: collaborationEngine.currentClientId,
        content_hash: docHashRef.current,
      };
      void sha256Hex(newContent).then((hash) => {
        if (docVersionRef.current === next) {
          docHashRef.current = hash;
        }
      });
    }

    // Set the stable pendingSaveRef values to prevent any race condition on tab switch
    pendingSaveRef.current = {
      path: sourcePath,
      content: newContent,
      collabMeta: localEditMeta ? {
        version: localEditMeta.version,
        last_modified: localEditMeta.last_modified,
        client_id: localEditMeta.client_id,
      } : null,
    };

    if (isCollabSpace && sourcePath && sourcePath !== "__new_tab__") {
      setIsSelfTyping(true);
      collaborationEngine.updatePresenceNote(sourcePath, true);

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      typingTimeoutRef.current = setTimeout(() => {
        typingTimeoutRef.current = null;
        collaborationEngine.updatePresenceNote(sourcePath, false);
        setIsSelfTyping(false);
      }, 2500);
    }

    // Auto-save to local disk (debounced)
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
    }
    autoSaveTimer.current = setTimeout(async () => {
      autoSaveTimer.current = null;
      const pending = pendingSaveRef.current;
      if (!pending) return;

      try {
        await api.writeFile(pending.path, pending.content);
        window.dispatchEvent(
          new CustomEvent("openonyx:note-saved", {
            detail: { path: pending.path },
          }),
        );
      } catch (err) {
        console.error("Auto-save failed:", err);
      }

      // Only clear pendingSaveRef if the sync timer is not running
      if (!dbSyncTimer.current) {
        pendingSaveRef.current = null;
      }
    }, 2000);

    // Persist to IndexedDB + enqueue for sync to Supabase (debounced).
    // Lower debounce than disk save so cloud sync starts sooner.
    if (isCollabSpace && !collabFailSafe && sourcePath && sourcePath !== "__new_tab__") {
      if (dbSyncTimer.current) {
        clearTimeout(dbSyncTimer.current);
      }
      dbSyncTimer.current = setTimeout(async () => {
        dbSyncTimer.current = null;
        const pending = pendingSaveRef.current;
        if (!pending || !pending.collabMeta) return;

        try {
          const hash = await sha256Hex(pending.content);
          docHashRef.current = hash;
          await collaborationEngine.persistNoteEdit(pending.path, pending.content, {
            version: pending.collabMeta.version,
            last_modified: pending.collabMeta.last_modified || new Date().toISOString(),
            client_id: pending.collabMeta.client_id || null,
            content_hash: hash,
          });
          syncEngine.triggerPush();
        } catch (err) {
          console.error("[Collab] DB sync failed:", err);
        }

        // Only clear pendingSaveRef if the auto-save timer is not running
        if (!autoSaveTimer.current) {
          pendingSaveRef.current = null;
        }
      }, 300);
    }
  }, [activeTab.path, onContentChangeGlobal, collabFailSafe]);

  const scheduleFullDocumentBroadcast = useCallback((contentToBroadcast: string, delay = 400) => {
    if (!collaborationEngine.activeSpaceId) return;
    if (collabFailSafe) return;
    if (!activeTab.path || activeTab.path === "__new_tab__") return;

    if (fullDocumentBroadcastTimerRef.current) {
      clearTimeout(fullDocumentBroadcastTimerRef.current);
    }

    fullDocumentBroadcastTimerRef.current = setTimeout(async () => {
      fullDocumentBroadcastTimerRef.current = null;
      const hash = await sha256Hex(contentToBroadcast);
      docHashRef.current = hash;
      await collaborationEngine.broadcastFullDocument(activeTab.path, contentToBroadcast, {
        version: docVersionRef.current,
        last_modified: new Date().toISOString(),
        client_id: collaborationEngine.currentClientId,
        content_hash: hash,
      });
    }, delay);
  }, [activeTab.path, collabFailSafe]);

  // ── Operation-Based Broadcast ───────────────────────────────────────────────

  /**
   * Called by the Editor when the user makes an edit. The Editor extracts
   * granular operations from the CodeMirror transaction and passes them here.
   * We broadcast them to all peers immediately.
   */
  const handleCollabOperations = useCallback((ops: CollabOperation[]) => {
    if (!collaborationEngine.activeSpaceId) return;
    if (collabFailSafe) return;
    if (!activeTab.path || activeTab.path === "__new_tab__") return;

    const versionMeta = pendingLocalVersionRef.current || {
      base: Math.max(0, docVersionRef.current - 1),
      next: docVersionRef.current,
    };
    pendingLocalVersionRef.current = null;

    // For large edits (paste, AI generation), broadcast ONLY the full document.
    // Sending both granular ops AND a full-doc causes double-application on the
    // receiver side. Granular ops are only useful for small, incremental edits.
    const totalInserted = ops.reduce((sum, op) => sum + (op.text?.length || 0), 0);
    const now = Date.now();
    for (const op of ops) {
      recentLocalEditsRef.current.push({
        from: op.from,
        to: op.to ?? op.from + (op.text?.length || 0),
        at: now,
      });
    }
    recentLocalEditsRef.current = recentLocalEditsRef.current.filter(edit => now - edit.at < 5000);

    if (totalInserted > 500) {
      const view = editorViewRef.current;
      if (view) {
        scheduleFullDocumentBroadcast(view.state.doc.toString(), 400);
      }
    } else {
      void (async () => {
        const view = editorViewRef.current;
        const hash = await sha256Hex(view?.state.doc.toString() || content);
        docHashRef.current = hash;
        const enrichedOps = ops.map(op => ({
          ...op,
          base_version: versionMeta.base,
          version: versionMeta.next,
          content_hash: hash,
          client_id: collaborationEngine.currentClientId,
          clientId: collaborationEngine.currentClientId,
        }));
        collaborationEngine.broadcastOperations(activeTab.path, enrichedOps);
      })();
    }
  }, [activeTab.path, collabFailSafe, content, scheduleFullDocumentBroadcast]);

  // ── Cursor Presence Broadcast ───────────────────────────────────────────────

  const handleCursorChange = useCallback((cursor: { from: number; to: number }) => {
    if (!collaborationEngine.activeSpaceId) return;
    if (collabFailSafe) return;
    if (!activeTab.path || activeTab.path === "__new_tab__") return;

    // Debounce cursor presence updates (150ms). The collaboration engine
    // also throttles at 100ms, but debouncing here avoids creating
    // unnecessary CursorPresence objects on every keystroke.
    if (cursorDebounceRef.current) {
      clearTimeout(cursorDebounceRef.current);
    }
    cursorDebounceRef.current = setTimeout(() => {
      cursorDebounceRef.current = null;
      const user = authManager.getUser();
      if (!user) return;

      const userId = user.id;
      collaborationEngine.broadcastCursorPresence({
        user_id: userId,
        client_id: collaborationEngine.currentClientId,
        file_path: activeTab.path,
        cursor,
        name: user.email?.split('@')[0] || 'Anonymous',
        color: getColorForUser(userId),
        doc_version: docVersionRef.current,
      });
    }, 150);
  }, [activeTab.path, collabFailSafe]);

  const enterFailSafeMode = useCallback((reason: string) => {
    desyncCountRef.current += 1;
    console.warn("[Collab][fail_safe_check]", { path: activeTab.path, reason, desyncCount: desyncCountRef.current });
    if (desyncCountRef.current >= 10) {
      console.error("[Collab][fail_safe_enabled]", { path: activeTab.path, reason });
      setCollabFailSafe(true);
      collaborationEngine.setCollabPaused(true);
    }
  }, [activeTab.path]);

  // Decay the desync counter over time so transient issues do not accumulate
  // across an entire session and eventually trip the fail-safe.
  useEffect(() => {
    const decayInterval = setInterval(() => {
      if (desyncCountRef.current > 0) {
        desyncCountRef.current = Math.max(0, desyncCountRef.current - 1);
      }
    }, 30_000);
    return () => clearInterval(decayInterval);
  }, []);

  const scheduleRemoteContentPersist = useCallback((path: string, remoteContent: string, meta?: RemoteDocumentMeta) => {
    if (!collaborationEngine.activeSpaceId || path === "__new_tab__") return;

    if (remotePersistTimerRef.current) {
      clearTimeout(remotePersistTimerRef.current);
    }

    remotePersistTimerRef.current = setTimeout(async () => {
      remotePersistTimerRef.current = null;
      try {
        await api.writeFile(path, remoteContent);

        const spaceId = collaborationEngine.activeSpaceId;
        if (!spaceId) return;

        const note = await localDB.getNoteByPath(spaceId, path);
        if (note) {
          const hash = meta?.content_hash || await sha256Hex(remoteContent);
          await localDB.putNote({
            ...note,
            content: remoteContent,
            version: normalizeVersion(meta?.version ?? docVersionRef.current),
            last_modified: meta?.last_modified || new Date().toISOString(),
            client_id: meta?.client_id || null,
            content_hash: hash,
            updated_at: meta?.last_modified || new Date().toISOString(),
          }, false);
        }
      } catch (err) {
        console.error("[Collab] Failed to persist remote content:", err);
      }
    }, 250);
  }, []);

  // ── Receive Remote Operations ───────────────────────────────────────────────

  useEffect(() => {
    if (useCRDT || activeTab.path === "__new_tab__") return;

    const unsub = collaborationEngine.onRemoteOperation((path, ops) => {
      if (path !== activeTab.path) return;
      if (collabFailSafe) return;

      const view = editorViewRef.current;
      if (!view) return;

      // Apply each operation sequentially. Each dispatch changes the document
      // length, so we must re-read doc.length after each one. Batching them
      // all against a single stale snapshot causes position corruption on the
      // 2nd+ operation.
      let batchNextVersion = docVersionRef.current;
      for (let index = 0; index < ops.length; index++) {
        const op = ops[index];
        const incomingVersion = normalizeVersion(op.version);

        // Apply optimistically -- version skew is expected during concurrent
        // editing in a LWW system. Position clamping prevents out-of-range
        // errors, and the full-document fallback handles convergence.
        const docLen = view.state.doc.length;
        const clamped = clampOperation(op, docLen);
        const change = operationToChangeSpec(clamped);
        view.dispatch({
          changes: change,
          // Use 'remote' annotation so the CM update listener recognises this
          // as a non-user edit (isUserEvent("input"/"delete"/etc.) returns false).
          annotations: Transaction.remote.of(true),
        });
        batchNextVersion = Math.max(batchNextVersion, incomingVersion || batchNextVersion + 1);
        collaborationEngine.markOperationApplied(op.operation_id);
      }
      docVersionRef.current = batchNextVersion;
      // Reset desync counter on every successful batch of remote ops
      desyncCountRef.current = 0;

      const nextContent = view.state.doc.toString();
      const lastOp = ops[ops.length - 1];
      void sha256Hex(nextContent).then((hash) => {
        docHashRef.current = hash;
        setContent(nextContent);
        latestContentRef.current = nextContent;
        latestContentPathRef.current = activeTab.path;
        contentCacheRef.current.set(activeTab.path, nextContent);
        onContentChangeGlobal(activeTab.path, nextContent);
        scheduleRemoteContentPersist(activeTab.path, nextContent, {
          version: docVersionRef.current,
          last_modified: new Date().toISOString(),
          client_id: lastOp?.client_id || lastOp?.clientId || null,
          content_hash: hash,
        });
      });
    });

    return unsub;
  }, [activeTab.path, onContentChangeGlobal, scheduleRemoteContentPersist, enterFailSafeMode, collabFailSafe]);

  // ── Receive Remote Cursor Presence ──────────────────────────────────────────

  // Track when each remote cursor was last updated, so we can clean up stale ones
  const cursorLastSeenRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (activeTab.path === "__new_tab__") return;

    const unsub = collaborationEngine.onRemoteCursor((presence) => {
      const cursorKey = presence.client_id || presence.user_id;
      const localUserId = authManager.getUserId();

      if (
        presence.client_id === collaborationEngine.currentClientId ||
        (!presence.client_id && localUserId && presence.user_id === localUserId)
      ) {
        setRemoteCursors(prev =>
          prev.filter(c => (c.client_id || c.user_id) !== cursorKey),
        );
        cursorLastSeenRef.current.delete(cursorKey);
        return;
      }

      // Only show cursors for the same file
      if (presence.file_path !== activeTab.path) {
        // Remove this user's cursor if they moved to a different file
        setRemoteCursors(prev =>
          prev.filter(c => (c.client_id || c.user_id) !== cursorKey),
        );
        cursorLastSeenRef.current.delete(cursorKey);
        return;
      }

      // Update last-seen timestamp for stale cleanup
      cursorLastSeenRef.current.set(cursorKey, Date.now());

      setRemoteCursors(prev => {
        const existing = prev.findIndex(c => (c.client_id || c.user_id) === cursorKey);
        if (existing >= 0) {
          const next = [...prev];
          next[existing] = presence;
          return next;
        }
        return [...prev, presence];
      });
    });

    // Clean up stale cursors every 10 seconds. If a user's cursor hasn't
    // been updated in 15 seconds they are likely offline or on another file.
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      const staleThreshold = 15_000;
      const staleCursorKeys: string[] = [];
      for (const [cursorKey, lastSeen] of cursorLastSeenRef.current) {
        if (now - lastSeen > staleThreshold) {
          staleCursorKeys.push(cursorKey);
        }
      }
      if (staleCursorKeys.length > 0) {
        for (const id of staleCursorKeys) {
          cursorLastSeenRef.current.delete(id);
        }
        setRemoteCursors(prev =>
          prev.filter(c => !staleCursorKeys.includes(c.client_id || c.user_id)),
        );
      }
    }, 10_000);

    // Also clean up cursors when users go offline (leave presence)
    const unsubUsers = collaborationEngine.onActiveUsersChange((users) => {
      const onlineUserIds = new Set(users.map(u => u.id));
      setRemoteCursors(prev => {
        const filtered = prev.filter(c => onlineUserIds.has(c.user_id));
        // Also prune the lastSeen map
        for (const [cursorKey] of cursorLastSeenRef.current) {
          const cursor = filtered.find(c => (c.client_id || c.user_id) === cursorKey);
          if (!cursor) {
            cursorLastSeenRef.current.delete(cursorKey);
          }
        }
        return filtered.length !== prev.length ? filtered : prev;
      });
    });

    return () => {
      unsub();
      clearInterval(cleanupInterval);
      unsubUsers();
    };
  }, [activeTab.path]);

  // ── Full-Content Fallback (DB-level sync via postgres_changes) ──────────────

  useEffect(() => {
    if (useCRDT || activeTab.path === "__new_tab__") return;

    const unsub = collaborationEngine.onRemoteDocumentUpdate((path, remoteContent, _senderClientId, isBroadcast, meta) => {
      if (path !== activeTab.path) return;
      if (collabFailSafe) return;

      // Allow remote full-doc updates even while the user is typing. Previously
      // this was blocked by `isSelfTyping`, which caused peer text changes to
      // be silently dropped for 2.5s after each keystroke.

      const incomingVersion = normalizeVersion(meta?.version);
      const currentVersion = docVersionRef.current;
      if (incomingVersion <= currentVersion) {
        console.info("[Collab][full_doc_ignored_stale]", {
          path,
          isBroadcast,
          incomingVersion,
          currentVersion,
        });
        return;
      }


      void sha256Hex(remoteContent).then((hash) => {
        if (meta?.content_hash && meta.content_hash !== hash) {
          console.warn("[Collab][full_doc_hash_mismatch]", {
            path,
            incomingVersion,
            expected: meta.content_hash,
            actual: hash,
          });
          enterFailSafeMode("full document hash mismatch");
          void collaborationEngine.triggerSafeResync(path, currentVersion);
          return;
        }

        docVersionRef.current = incomingVersion;
        docHashRef.current = hash;

      const view = editorViewRef.current;
      if (view) {
        const currentDoc = view.state.doc.toString();
        if (currentDoc !== remoteContent) {
          view.dispatch({
            changes: { from: 0, to: currentDoc.length, insert: remoteContent },
            annotations: Transaction.remote.of(true),
          });
        }
      } else {
        setContent(remoteContent);
        latestContentRef.current = remoteContent;
        latestContentPathRef.current = activeTab.path;
        contentCacheRef.current.set(activeTab.path, remoteContent);
        onContentChangeGlobal(activeTab.path, remoteContent);
      }

      // Clear stale remote cursor positions -- after a full-doc replace, all
      // absolute cursor positions from peers are invalid and must be refreshed
      // by the next cursor-presence broadcast from each peer.
      setRemoteCursors([]);

      // Write to local disk (debounced)
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current);
      }
      autoSaveTimer.current = setTimeout(async () => {
        autoSaveTimer.current = null;
        try {
          await api.writeFile(activeTab.path, remoteContent);
          const spaceId = collaborationEngine.activeSpaceId;
          if (spaceId) {
            const note = await localDB.getNoteByPath(spaceId, activeTab.path);
            if (note) {
              await localDB.putNote({
                ...note,
                content: remoteContent,
                version: incomingVersion,
                last_modified: meta?.last_modified || new Date().toISOString(),
                client_id: meta?.client_id || null,
                content_hash: hash,
                updated_at: meta?.last_modified || new Date().toISOString(),
              }, false);
            }
          }
        } catch (err) {
          console.error("[Collab] Failed to write remote content to disk:", err);
        }
      }, 1000);
      });
    });

    return unsub;
  }, [activeTab.path, onContentChangeGlobal, collabFailSafe, enterFailSafeMode]);

  // Re-sync active note upon network reconnection or page focus
  useEffect(() => {
    if (activeTab.path === "__new_tab__") return;
    if (!collaborationEngine.activeSpaceId) return;

    const handleReSync = async () => {
      // Only pull if there are no pending unsaved local edits
      if (dbSyncTimer.current !== null) return;
      const isTabModified = leaf.tabs.find(t => t.id === activeTab.id)?.isModified;
      if (isSelfTyping || isTabModified) return;
      try {
        const spaceId = collaborationEngine.activeSpaceId;
        if (!spaceId) return;

        const queue = await localDB.getSyncQueue();
        const hasPendingEdit = queue.some(item => item.table === 'notes' && item.payload?.path === activeTab.path);
        if (hasPendingEdit) return; // Keep unsaved local edits

        // Fetch the remote note from Supabase directly
        const { data: remote } = await supabase
          .from('notes')
          .select('content, updated_at, version, last_modified, client_id, content_hash')
          .eq('space_id', spaceId)
          .eq('path', activeTab.path)
          .maybeSingle();

        if (remote) {
          const localNote = await localDB.getNoteByPath(spaceId, activeTab.path);
          const remoteVersion = normalizeVersion((remote as any).version);
          const localVersion = normalizeVersion(localNote?.version ?? docVersionRef.current);
          const remoteTime = new Date(remote.updated_at).getTime();
          const localTime = localNote ? new Date(localNote.updated_at).getTime() : 0;

          if (remoteVersion > localVersion || (remoteVersion === 0 && remoteTime > localTime)) {
            console.log(`[Collab] Reconnection resync: Remote is newer. Updating editor for ${activeTab.path}.`);
            const hash = (remote as any).content_hash || await sha256Hex(remote.content || '');
            docVersionRef.current = remoteVersion;
            docHashRef.current = hash;
            
            // Remote is newer, update IndexedDB, disk and editor!
            if (localNote) {
              localNote.content = remote.content;
              localNote.updated_at = remote.updated_at;
              localNote.version = remoteVersion;
              localNote.last_modified = (remote as any).last_modified || remote.updated_at;
              localNote.client_id = (remote as any).client_id || null;
              localNote.content_hash = hash;
              await localDB.putNote(localNote, false);
            }
            await api.writeFile(activeTab.path, remote.content || '');

            const view = editorViewRef.current;
            if (view) {
              const currentDoc = view.state.doc.toString();
              if (currentDoc !== remote.content) {
                view.dispatch({
                  changes: { from: 0, to: currentDoc.length, insert: remote.content },
                  annotations: Transaction.remote.of(true),
                });
              }
            } else {
              setContent(remote.content);
              latestContentRef.current = remote.content;
              latestContentPathRef.current = activeTab.path;
              contentCacheRef.current.set(activeTab.path, remote.content);
              onContentChangeGlobal(activeTab.path, remote.content);
            }
          }
        }
      } catch (err) {
        console.warn("[Collab] Reconnection resync failed:", err);
      }
    };

    window.addEventListener('online', handleReSync);
    window.addEventListener('focus', handleReSync);
    const handleRealtimeEvent = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.type === 'connected') {
        handleReSync();
        const view = editorViewRef.current;
        if (view) {
          const sel = view.state.selection.main;
          handleCursorChange({ from: sel.from, to: sel.to });
          scheduleFullDocumentBroadcast(view.state.doc.toString(), 400);
        }
      }
    };
    window.addEventListener('collaboration:realtime', handleRealtimeEvent);

    return () => {
      window.removeEventListener('online', handleReSync);
      window.removeEventListener('focus', handleReSync);
      window.removeEventListener('collaboration:realtime', handleRealtimeEvent);
    };
  }, [activeTab.path, handleCursorChange, scheduleFullDocumentBroadcast]);

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      void flushSaveRef.current();
      if (dbSyncTimer.current) clearTimeout(dbSyncTimer.current);
      if (contentDebounceTimeoutRef.current) {
        clearTimeout(contentDebounceTimeoutRef.current);
        contentDebounceTimeoutRef.current = null;
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      if (cursorDebounceRef.current) {
        clearTimeout(cursorDebounceRef.current);
        cursorDebounceRef.current = null;
      }
      if (remotePersistTimerRef.current) {
        clearTimeout(remotePersistTimerRef.current);
        remotePersistTimerRef.current = null;
      }
      if (fullDocumentBroadcastTimerRef.current) {
        clearTimeout(fullDocumentBroadcastTimerRef.current);
        fullDocumentBroadcastTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      if (isSelfTyping && activeTab.path && activeTab.path !== "__new_tab__") {
        collaborationEngine.updatePresenceNote(activeTab.path, false);
      }
    };
  }, [activeTab.path, isSelfTyping]);

  // Clear remote cursors when switching files (both React state AND CodeMirror)
  useEffect(() => {
    setRemoteCursors([]);
    const view = editorViewRef.current;
    if (view) {
      try {
        view.dispatch({ effects: setCursorsEffect.of([]) });
      } catch { /* view may be destroyed during tab switch */ }
    }
  }, [activeTab.path]);

  // Restore viewMode state when tab changes
  useEffect(() => {
    if (activeTab.path && activeTab.path !== "__new_tab__") {
      const cached = getViewState?.(activeTab.path);
      if (cached?.viewMode) {
        setViewMode(cached.viewMode);
      } else {
        setViewMode(settings.defaultView ?? "editor");
      }
    }
  }, [activeTab.path, getViewState, settings.defaultView]);

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    if (activeTab.path && activeTab.path !== "__new_tab__") {
      onViewStateChange?.(activeTab.path, { viewMode: mode });
    }
  };

  const promptForText = useCallback(
    async (title: string, message: string, defaultValue = ""): Promise<string | null> => {
      if (onPromptInput) return onPromptInput(title, message, defaultValue);
      const result = window.prompt(message, defaultValue);
      return result?.trim() || null;
    },
    [onPromptInput],
  );

  const handleAddFileProperty = useCallback(async () => {
    if (!activeTab.path || activeTab.path === "__new_tab__") return;

    const key = await promptForText("Add File Property", "Property name:");
    if (!key) return;
    const normalizedKey = key.trim().replace(/\s+/g, "-");
    if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(normalizedKey)) {
      onShowToast?.("Property names must start with a letter or underscore.", "error");
      return;
    }

    const value = await promptForText("Add File Property", `Value for ${normalizedKey}:`);
    if (value === null) return;

    const current = latestContentRef.current || content;
    const next = updateFrontmatter(current, { [normalizedKey]: value });
    setContent(next);
    handleContentChange(next, true);
    onShowToast?.("File property added", "success");
  }, [activeTab.path, content, handleContentChange, onShowToast, promptForText]);

  const handleExportPdf = useCallback(async () => {
    if (!activeTab.path || activeTab.path === "__new_tab__") return;

    try {
      const vaultPath = await api.getVaultPath();
      const vaultFiles = vaultPath ? await api.getFileTree().catch(() => undefined) : undefined;
      const markdown = latestContentRef.current || content;
      const html = buildMarkdownPdfHtml({
        markdown,
        title: activeTab.name || activeTab.path.replace(/\.md$/i, ""),
        notePath: activeTab.path,
        vaultPath: vaultPath || undefined,
        vaultFiles,
      });
      const result = await api.exportMarkdownPdf({
        html,
        defaultPath: getPdfDefaultPath(vaultPath, activeTab.path),
      });
      if (!result.canceled && result.filePath) {
        onShowToast?.("PDF exported", "success");
      }
    } catch (error) {
      console.error("Failed to export PDF:", error);
      onShowToast?.("Failed to export PDF.", "error");
    }
  }, [activeTab.name, activeTab.path, content, onShowToast]);

  // ── Render ──────────────────────────────────────────────────────────────────

  const currentUser = authManager.getUser();
  const currentUserId = currentUser?.id;
  const isCollabSpace = !!collaborationEngine.activeSpaceId && !collaborationEngine.collabPaused && !collabFailSafe;

  const normalizedActivePath = normalizeSyncPath(activeTab.path);
  const activeEditors = [...(activeUsers || []).filter(u => {
    if (!u.activeNoteId) return true;
    return normalizeSyncPath(u.activeNoteId) === normalizedActivePath;
  })];
  const editorContent =
    contentPath === activeTab.path
      ? content
      : contentCacheRef.current.get(activeTab.path) ?? "";
  
  if (isCollabSpace && currentUser && activeTab.path !== "__new_tab__") {
    const hasSelf = activeEditors.some(u => u.id === currentUserId);
    if (!hasSelf) {
      const username = currentUser.email?.split('@')[0] || 'Guest';
      activeEditors.unshift({
        id: currentUserId,
        email: currentUser.email || '',
        name: `You (${username})`,
        color: '#10b981',
        isEditing: isSelfTyping,
        activeNoteId: activeTab.path,
      });
    }
  }

  if (!fileExists) {
    return (
      <div className="file-missing-placeholder" style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: '24px',
        color: 'var(--text-muted)',
        textAlign: 'center',
        backgroundColor: 'var(--bg-primary, var(--background-primary))'
      }}>
        <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', color: 'var(--text-normal, var(--text-primary))' }}>
          File missing
        </div>
        <div style={{ fontSize: '12px', marginBottom: '16px', maxWidth: '300px' }}>
          The file <code style={{ wordBreak: 'break-all', backgroundColor: 'var(--bg-secondary, var(--background-secondary))', padding: '2px 4px', borderRadius: '4px' }}>{activeTab.path}</code> could not be found. It may have been renamed or deleted.
        </div>
        <button 
          className="cursor-pointer rounded border border-[var(--border-medium)] bg-[var(--bg-tertiary)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-[background-color,border-color,transform] duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] active:scale-[0.98] active:bg-[var(--bg-active)]"
          onClick={() => onTabClose(activeTab.id)}
          style={{ padding: '6px 12px', fontSize: '12px' }}
        >
          Close tab
        </button>
      </div>
    );
  }

  return (
    <div
      className="leaf-editor-host relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      onMouseDownCapture={() => {
        if (!isFocused && onFocusLeaf) {
          onFocusLeaf(leaf.id);
        }
      }}
      onFocusCapture={() => {
        if (!isFocused && onFocusLeaf) {
          onFocusLeaf(leaf.id);
        }
      }}
    >
      <EditorHeader
        filePath={activeTab.path}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        onToggleInsight={() => onToggleInsight(!showInlineInsight)}
        activeEditors={activeEditors}
        onToggleBacklinks={onToggleBacklinks}
        onSplitRight={() => onSplitRight?.(leaf.id, activeTab)}
        onSplitDown={() => onSplitDown?.(leaf.id, activeTab)}
        onRename={() => onRenameFileMenu?.(activeTab.path)}
        onMoveFile={() => onMoveFileMenu?.(activeTab.path)}
        onBookmark={() => onBookmarkFile?.(activeTab.path)}
        onAddProperty={handleAddFileProperty}
        onExportPdf={() => void handleExportPdf()}
        onFind={() => document.dispatchEvent(new CustomEvent("editor:open-search"))}
        onReplace={() => document.dispatchEvent(new CustomEvent("editor:open-search"))}
        onCopyRelativePath={() => onCopyRelativePath?.(activeTab.path)}
        onCopyAbsolutePath={() => onCopyAbsolutePath?.(activeTab.path)}
        onOpenInDefaultApp={() => onOpenInDefaultApp?.(activeTab.path)}
        onShowInSystemExplorer={() => onShowInSystemExplorer?.(activeTab.path)}
        onRevealInNavigation={() => onRevealInNavigation?.(activeTab.path)}
        onDeleteFile={() => onDeleteFile?.(activeTab.path)}
        canCopyAbsolutePath={canCopyAbsolutePath}
        isFocused={isFocused}
      />
      {activeTab.path === "__new_tab__" ? (
        <NewTabView
          onNewNote={() => {
            window.dispatchEvent(new CustomEvent("oo:new-note"));
          }}
          onSearch={() => {
            window.dispatchEvent(new CustomEvent("oo:fuzzy-search"));
          }}
          onClose={() => onTabClose(activeTab.id)}
        />
      ) : (
        <>
        {collabFailSafe && (
          <div style={{
            padding: "8px 12px",
            borderBottom: "1px solid var(--border-color)",
            background: "var(--bg-secondary)",
            color: "var(--text-primary)",
            fontSize: 12,
          }}>
            Realtime paused after repeated sync conflicts. This note is view-only until refresh.
          </div>
        )}
        <Editor
          tabs={leaf.tabs}
          activeTabId={activeTab.id}
          content={editorContent}
          viewMode={viewMode}
          isFocused={isFocused}
          availableNotes={allNoteNames}
          onAdjustFontSize={onAdjustFontSize}
          onTabSelect={(id) => onTabSelect(leaf.id, id)}
          onTabClose={onTabClose}
          onContentChange={handleContentChange}
          onViewModeChange={handleViewModeChange}
          onLinkClick={onLinkClick}
          onImagePaste={onImagePaste}
          onGetNoteContent={getNoteContent}
          suggestions={editorSuggestions}
          nextStepSuggestions={editorNextStepSuggestions}
          onAcceptSuggestion={onAcceptSuggestion}
          onRejectSuggestion={onRejectSuggestion}
          onOpenNote={onOpenNote}
          annotation={inlineAnnotation}
          showInsight={showInlineInsight}
          onToggleInsight={onToggleInsight}
          theme={theme}
          settings={settings}
          onCollabOperations={isCollabSpace ? handleCollabOperations : undefined}
          onCursorChange={isCollabSpace && !useCRDT ? handleCursorChange : undefined}
          remoteCursors={isCollabSpace && !useCRDT ? remoteCursors : undefined}
          localClientId={isCollabSpace && !useCRDT ? collaborationEngine.currentClientId : undefined}
          onEditorViewReady={handleEditorViewReady}
          getViewState={getViewState}
          onViewStateChange={onViewStateChange}
          readOnly={collabFailSafe}
          onGenerateInsight={onGenerateInsight}
          isGeneratingInsight={isGeneratingInsight}
          yCollabExtension={yCollabExtension}
        />
        {isLoading && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 top-[38px] bg-[color-mix(in_srgb,var(--bg-primary)_78%,transparent)]"
          />
        )}
        </>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const COLLABORATOR_COLORS = [
  '#3b82f6', '#2563eb', '#059669', '#d97706', '#dc2626',
  '#0ea5e9', '#0891b2', '#65a30d', '#ea580c', '#e11d48',
];

function getColorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i);
    hash |= 0;
  }
  return COLLABORATOR_COLORS[Math.abs(hash) % COLLABORATOR_COLORS.length];
}
