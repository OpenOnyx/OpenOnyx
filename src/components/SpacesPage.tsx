/**
 * SpacesPage — Main entry for the Spaces feature
 *
 * A Space is a queryable knowledge layer over the user's entire vault.
 * Stored locally (or synced with Supabase), fully indexed using AI embeddings.
 *
 * Redesigned UI/UX:
 *  1. Marketplace — Gorgeous glassmorphic grid with search, filter tabs, stats.
 *  2. Dual-Column Workspace — Sidebar (details & indexed notes explorer) + AI Chat.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Plus, X, Trash2, ArrowLeft, ArrowUp, Loader2,
  Copy, FileText, Globe, RefreshCw, LogIn, LogOut, Search, Sparkles,
  Zap, Layers, Brain, Check, GitBranch, MessageSquare, Edit2, Square,
  Lock, Unlock
} from "lucide-react";
import {
  listSpaces, getSpace, createSpace, deleteSpace, forkSpace, updateSpace,
  loadSpaceChat, saveSpaceChat,
  loadSpaceConversations, saveSpaceConversations,
  loadSpaceConversationMessages, saveSpaceConversationMessages,
  deleteSpaceConversationMessages
} from "../utils/spaces-store";
import {
  isSpaceUnlocked,
  unlockSpace,
  lockSpace,
  deriveMasterKey,
  generateSpaceKey,
  encryptSpaceKey,
  decryptSpaceKey,
  base64ToArrayBuffer,
  arrayBufferToBase64
} from "../utils/spaces-crypto";
import { buildVectorIndex, type VaultNote } from "../utils/spaces-processing";
import { querySpaceStreaming, parseActionPayload, stripJSONBlock, type RAGResult, type SpaceMetadata } from "../utils/spaces-rag";
import { isAIConfigured } from "../utils/ai-core";
import { getAPI } from "../utils/api";
import type { Space, SpaceIndexEntry, SpaceChatMessage, SpaceVisibility, SpaceConversation } from "../types/spaces";
import type { FileEntry } from "../types/index";
import { SpacesIcon } from "./SpacesIcon";
import { MarkdownPreview } from "./editor/MarkdownPreview";
import { authManager, AuthRequiredError } from "../lib/auth";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { AuthModal } from "./AuthModal";
import { collaborationEngine } from "../lib/collaborationEngine";
import { syncEngine } from "../lib/syncEngine";
import { generateDiffMarkdown } from "../utils/diff";

// ── Props ────────────────────────────────────────────────────────────────────

interface SpacesPageProps {
  onClose: () => void;
  fileTree: FileEntry[];
  onOpenNote?: (path: string) => void;
}

// ── Suggested Queries ────────────────────────────────────────────────────────

const SUGGESTED_QUERIES = [
  "Summarize the key ideas in my vault",
  "What are the main connections and themes?",
  "What mistakes or gaps should I watch out for?",
  "Give me a simple, actionable plan based on my notes",
  "How can I structure this project better?"
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Count .md files in a file tree */
function countNotes(entries: FileEntry[] = []): number {
  if (!entries) return 0;
  let count = 0;
  for (const e of entries) {
    if (e.isDirectory && e.children) count += countNotes(e.children);
    else if (e.name.endsWith(".md") || e.name.endsWith(".canvas")) count++;
  }
  return count;
}

/** Catalog all markdown notes recursively in the vault */
function getAllVaultNotes(entries: FileEntry[] = []): { path: string; title: string }[] {
  if (!entries) return [];
  const notes: { path: string; title: string }[] = [];

  function walk(items: FileEntry[]) {
    if (!items) return;
    for (const e of items) {
      if (e.isDirectory && e.children) {
        walk(e.children);
      } else if (e.name.endsWith(".md")) {
        notes.push({ path: e.path, title: e.name.replace(/\.md$/, "") });
      }
    }
  }

  walk(entries);
  return notes;
}

/** Get all preview notes from the file tree */
function getPreviewNotes(entries: FileEntry[] = [], max = 15): { path: string; title: string }[] {
  if (!entries) return [];
  const notes: { path: string; title: string; modified: number }[] = [];

  function walk(items: FileEntry[]) {
    if (!items) return;
    for (const e of items) {
      if (e.isDirectory && e.children) walk(e.children);
      else if (e.name.endsWith(".md")) {
        notes.push({ path: e.path, title: e.name.replace(/\.md$/, ""), modified: e.modifiedAt });
      }
    }
  }

  walk(entries);
  notes.sort((a, b) => b.modified - a.modified);
  return notes.slice(0, max);
}

function getVisibilityLabel(visibility: SpaceVisibility): string {
  switch (visibility) {
    case "local":
      return "Local";
    case "private":
      return "Private";
    case "public":
      return "Public";
    default:
      return "Local";
  }
}

function cleanDescription(desc: string | null | undefined): string {
  if (!desc) return "";
  if (desc.startsWith("__ENCRYPTED_SPACE__:")) {
    const newlineIndex = desc.indexOf("\n");
    if (newlineIndex !== -1) {
      return desc.substring(newlineIndex + 1);
    }
    return "";
  }
  return desc;
}

/**
 * Detects the action type from a potentially incomplete action block during streaming,
 * falling back to proactive detection from the user query if the stream hasn't started/reached the JSON block yet.
 */
function detectActionType(text: string, query?: string): string | null {
  // 1. Try to detect from stream content first (highest accuracy)
  if (text) {
    const lower = text.toLowerCase();
    if (lower.includes('"action": "create_note"') || lower.includes('"action":"create_note"') || lower.includes("'action': 'create_note'") || lower.includes("'action':'create_note'")) {
      return "create_note";
    }
    if (lower.includes('"action": "update_note"') || lower.includes('"action":"update_note"') || lower.includes("'action': 'update_note'") || lower.includes("'action':'update_note'")) {
      return "update_note";
    }
    if (lower.includes('"action": "suggest_structure"') || lower.includes('"action":"suggest_structure"') || lower.includes("'action': 'suggest_structure'") || lower.includes("'action':'suggest_structure'")) {
      return "suggest_structure";
    }
    if (lower.includes('"action": "suggest_links"') || lower.includes('"action":"suggest_links"') || lower.includes("'action': 'suggest_links'") || lower.includes("'action':'suggest_links'")) {
      return "suggest_links";
    }
    if (lower.includes('"action": "insight_report"') || lower.includes('"action":"insight_report"') || lower.includes("'action': 'insight_report'") || lower.includes("'action':'insight_report'")) {
      return "insight_report";
    }
    if (lower.includes("```") || lower.includes('"action"') || lower.includes("'action'")) {
      return "update_note";
    }
  }

  // 2. Fall back to proactive pre-detection from the user's query
  if (query) {
    const qLower = query.toLowerCase();
    if (qLower.includes("insight")) {
      return "insight_report";
    }
    if (qLower.includes("organize") || qLower.includes("structure") || qLower.includes("hierarchy") || qLower.includes("folder")) {
      return "suggest_structure";
    }
    if (qLower.includes("link")) {
      return "suggest_links";
    }
    if (qLower.includes("summary") || qLower.includes("summarize") || qLower.includes("create")) {
      return "create_note";
    }
    if (qLower.includes("rewrite") || qLower.includes("simplify") || qLower.includes("expand") || qLower.includes("edit") || qLower.includes("update") || qLower.includes("[[")) {
      return "update_note";
    }
  }

  return null;
}

/**
 * Strips JSON action blocks (complete or incomplete) from assistant messages.
 */


interface ActiveActionStatusProps {
  actionType: string;
  isApplied: boolean;
}

function ActiveActionStatus({ actionType, isApplied }: ActiveActionStatusProps) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (isApplied) return;
    const interval = setInterval(() => {
      setStep((prev) => (prev < 2 ? prev + 1 : 0));
    }, 2500);
    return () => clearInterval(interval);
  }, [isApplied]);

  if (isApplied) {
    return (
      <div className="active-action-status completed">
        <Check size={13} className="status-icon" />
        <span>Changes successfully saved and integrated</span>
      </div>
    );
  }

  let steps = ["Preparing changes...", "Editing note...", "Linking your notes..."];
  if (actionType === "suggest_structure") {
    steps = ["Analyzing note hierarchy...", "Structuring folders...", "Linking your notes..."];
  } else if (actionType === "suggest_links") {
    steps = ["Scanning references...", "Analyzing connections...", "Linking your notes..."];
  } else if (actionType === "insight_report") {
    steps = ["Reviewing space contents...", "Correlating insights...", "Structuring findings..."];
  }

  return (
    <div className="active-action-status processing">
      <Loader2 size={13} className="spinner status-icon" />
      <span>{steps[step]}</span>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function SpacesPage({ onClose, fileTree, onOpenNote }: SpacesPageProps) {
  // E2EE Private Spaces States
  const [spaceUnlocked, setSpaceUnlocked] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [createPassword, setCreatePassword] = useState("");
  
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [changePasswordCurrent, setChangePasswordCurrent] = useState("");
  const [changePasswordNew, setChangePasswordNew] = useState("");
  const [changePasswordConfirm, setChangePasswordConfirm] = useState("");
  const [changePasswordError, setChangePasswordError] = useState<string | null>(null);

  // Navigation
  const [view, setView] = useState<"marketplace" | "space">("marketplace");
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const activeSpaceIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Marketplace states
  const [spaces, setSpaces] = useState<SpaceIndexEntry[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [marketFilter, setMarketFilter] = useState<"all" | "local" | "private" | "public">("all");
  const [marketSearch, setMarketSearch] = useState("");

  // Space view state
  const [activeSpace, setActiveSpace] = useState<Space | null>(null);
  const currentUserId = authManager.getUserId();
  const isRemote = activeSpace?.visibility !== "local" && activeSpace?.ownerId !== currentUserId;

  // Create form states
  const [createTitle, setCreateTitle] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createTags, setCreateTags] = useState<string[]>([]);
  const [createTagInput, setCreateTagInput] = useState("");
  const [createVisibility, setCreateVisibility] = useState<SpaceVisibility>("local");
  const [createError, setCreateError] = useState<string | null>(null);

  // Auth/cloud state
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [authEmail, setAuthEmail] = useState<string | null>(authManager.getUser()?.email ?? null);

  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<SpaceChatMessage[]>([]);
  const [isQuerying, setIsQuerying] = useState(false);
  const [streamingText, setStreamingText] = useState("");

  // Conversation session states
  const [conversations, setConversations] = useState<SpaceConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const [editingConvId, setEditingConvId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const inputTokens = useMemo(() => Math.ceil((chatInput || "").length / 4), [chatInput]);

  const estimatedHistoryTokens = useMemo(() => {
    let total = 0;
    const recent = chatMessages.slice(-10);
    for (const msg of recent) {
      total += Math.ceil((msg.content || "").length / 4);
    }
    return total;
  }, [chatMessages]);

  // Mentions State
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);

  // Indexing
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState({ done: 0, total: 0 });
  const [isIndexed, setIsIndexed] = useState(false);

  // Right Sidebar for AI Actions (Preview, Diff, Edit)
  const [rightSidebarMode, setRightSidebarMode] = useState<"preview" | "diff" | "edit" | "review_list" | null>(null);
  const [rightSidebarData, setRightSidebarData] = useState<{
    actionType: "create_note" | "update_note";
    title?: string;
    path: string;
    content?: string;
    before?: string;
    after?: string;
    msgId: string;
    actionIndex?: number;
    actions?: any[];
  } | null>(null);
  const [rejectedActions, setRejectedActions] = useState<Record<string, boolean>>({});
  const [sidebarEditText, setSidebarEditText] = useState("");

  // Remote notes (for cloud spaces)
  const [remoteNotes, setRemoteNotes] = useState<{ path: string; title: string }[]>([]);
  const [isLoadingRemote, setIsLoadingRemote] = useState(false);

  // Delete confirm
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Toast notifications
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<"success" | "error">("success");

  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToastMessage(message);
    setToastType(type);
    setTimeout(() => setToastMessage(null), 4000);
  }, []);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const centralInputRef = useRef<HTMLTextAreaElement>(null);
  const bottomInputRef = useRef<HTMLTextAreaElement>(null);

  const vaultNoteCount = countNotes(fileTree);
  const allVaultNotes = useMemo(() => getAllVaultNotes(fileTree), [fileTree]);

  const notesList = activeSpace 
    ? (activeSpace.visibility === "local" ? allVaultNotes : remoteNotes)
    : [];

  const filteredNotes = useMemo(() => {
    if (!showMentionDropdown) return [];
    if (!mentionQuery) return notesList.slice(0, 10);
    const q = mentionQuery.toLowerCase();
    
    // 1. Filter matching notes
    const matches = notesList.filter(note => {
      const title = (note.title || "").toLowerCase();
      const path = (note.path || "").toLowerCase();
      return title.includes(q) || path.includes(q);
    });

    // 2. Sort by relevance
    matches.sort((a, b) => {
      const aTitle = (a.title || "").toLowerCase();
      const bTitle = (b.title || "").toLowerCase();
      const aPath = (a.path || "").toLowerCase();
      const bPath = (b.path || "").toLowerCase();

      // Priority 1: Exact title match
      const aExact = aTitle === q ? 1 : 0;
      const bExact = bTitle === q ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;

      // Priority 2: Title starts with query
      const aStartsWith = aTitle.startsWith(q) ? 1 : 0;
      const bStartsWith = bTitle.startsWith(q) ? 1 : 0;
      if (aStartsWith !== bStartsWith) return bStartsWith - aStartsWith;

      // Priority 3: Title contains query
      const aTitleContains = aTitle.includes(q) ? 1 : 0;
      const bTitleContains = bTitle.includes(q) ? 1 : 0;
      if (aTitleContains !== bTitleContains) return bTitleContains - aTitleContains;

      // Priority 4: Filename contains query (excluding directory paths)
      const aFilename = aPath.split("/").pop() || "";
      const bFilename = bPath.split("/").pop() || "";
      const aFileContains = aFilename.includes(q) ? 1 : 0;
      const bFileContains = bFilename.includes(q) ? 1 : 0;
      if (aFileContains !== bFileContains) return bFileContains - aFileContains;

      // Default: Preserve alphabetical/original order
      return 0;
    });

    return matches.slice(0, 10);
  }, [notesList, mentionQuery, showMentionDropdown]);

  const selectNote = (note: any) => {
    const textBefore = chatInput.substring(0, mentionStartIndex);
    const activeTextarea = document.activeElement as HTMLTextAreaElement;
    let cursorPos = mentionStartIndex;
    
    if (activeTextarea && activeTextarea.tagName === "TEXTAREA") {
      cursorPos = activeTextarea.selectionStart;
    }
    
    const textAfter = chatInput.substring(cursorPos);
    const insertedLink = `[[${note.title}]] `;
    const newValue = textBefore + insertedLink + textAfter;
    setChatInput(newValue);
    setShowMentionDropdown(false);
    setMentionQuery("");
    setMentionStartIndex(-1);

    setTimeout(() => {
      if (activeTextarea && activeTextarea.tagName === "TEXTAREA") {
        activeTextarea.focus();
        const newCursorPos = textBefore.length + insertedLink.length;
        activeTextarea.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 50);
  };

  const checkForMention = (text: string, selectionStart: number) => {
    const lastAtIndex = text.lastIndexOf('@', selectionStart - 1);
    if (lastAtIndex !== -1) {
      const textBetween = text.substring(lastAtIndex + 1, selectionStart);
      const hasSpace = /\s/.test(textBetween);
      if (!hasSpace) {
        setShowMentionDropdown(true);
        setMentionQuery(textBetween);
        setMentionStartIndex(lastAtIndex);
        setMentionActiveIndex(0);
        return;
      }
    }
    setShowMentionDropdown(false);
    setMentionQuery("");
    setMentionStartIndex(-1);
  };

  useEffect(() => {
    return authManager.subscribe((state) => {
      setAuthEmail(state.user?.email ?? null);
    });
  }, []);

  // ── Load spaces ──────────────────────────────────────
  const refreshSpaces = useCallback(async () => {
    try {
      const list = await listSpaces();
      setSpaces(list);
    } catch (err) {
      console.error("[Spaces] Failed to load spaces:", err);
      setSpaces([]);
    }
  }, []);

  useEffect(() => {
    refreshSpaces();
  }, [refreshSpaces]);

  // ── Open a space ─────────────────────────────────────
  const openSpace = useCallback(async (id: string) => {
    activeSpaceIdRef.current = id;
    const space = await getSpace(id);
    if (activeSpaceIdRef.current !== id) return;
    if (space) {
      setActiveSpace(space);
      setActiveSpaceId(id);
      
      const isPrivate = space.visibility === "private";
      setSpaceUnlocked(!isPrivate || isSpaceUnlocked(id));
      setUnlockPassword("");
      setUnlockError(null);

      setView("space");
      setStreamingText("");
      setChatInput("");
      const currentUserId = authManager.getUserId();
      const isRemoteSpace = space.visibility !== "local" && space.ownerId !== currentUserId;
      
      // If it's a cloud space owned by someone else, we don't auto-index on open
      setIsIndexed(isRemoteSpace);

      // Load conversations from disk
      const convList = await loadSpaceConversations(id);
      if (activeSpaceIdRef.current !== id) return;

      if (convList.length === 0) {
        // Attempt migration of legacy single chat
        const legacyHistory = await loadSpaceChat(id);
        if (activeSpaceIdRef.current !== id) return;

        if (legacyHistory && legacyHistory.length > 0) {
          const migratedConv: SpaceConversation = {
            id: "migrated",
            title: "Previous Chat",
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          await saveSpaceConversationMessages(id, "migrated", legacyHistory);
          await saveSpaceConversations(id, [migratedConv]);
          if (activeSpaceIdRef.current === id) {
            setConversations([migratedConv]);
            setActiveConversationId("migrated");
            activeConversationIdRef.current = "migrated";
            setChatMessages(legacyHistory);
          }
        } else {
          // Create default conversation
          const defaultConv: SpaceConversation = {
            id: `conv-${Date.now()}`,
            title: "New Chat",
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          await saveSpaceConversationMessages(id, defaultConv.id, []);
          await saveSpaceConversations(id, [defaultConv]);
          if (activeSpaceIdRef.current === id) {
            setConversations([defaultConv]);
            setActiveConversationId(defaultConv.id);
            activeConversationIdRef.current = defaultConv.id;
            setChatMessages([]);
          }
        }
      } else {
        // Sort conversations by updatedAt descending
        const sorted = [...convList].sort((a, b) => b.updatedAt - a.updatedAt);
        const firstConv = sorted[0];
        const msgs = await loadSpaceConversationMessages(id, firstConv.id);
        if (activeSpaceIdRef.current === id) {
          setConversations(sorted);
          setActiveConversationId(firstConv.id);
          activeConversationIdRef.current = firstConv.id;
          setChatMessages(msgs);
        }
      }
    }
  }, []);

  // ── Conversation actions ─────────────────────────────
  const selectConversation = useCallback(async (convId: string) => {
    if (!activeSpaceId) return;
    setStreamingText("");
    setChatInput("");
    setActiveConversationId(convId);
    activeConversationIdRef.current = convId;
    
    const msgs = await loadSpaceConversationMessages(activeSpaceId, convId);
    if (activeConversationIdRef.current === convId) {
      setChatMessages(msgs);
    }
  }, [activeSpaceId]);

  const handleNewConversation = useCallback(async () => {
    if (!activeSpaceId) return;
    const newConv: SpaceConversation = {
      id: `conv-${Date.now()}`,
      title: "New Chat",
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    const updated = [newConv, ...conversations];
    setConversations(updated);
    setActiveConversationId(newConv.id);
    activeConversationIdRef.current = newConv.id;
    setChatMessages([]);
    setStreamingText("");
    setChatInput("");
    
    await saveSpaceConversationMessages(activeSpaceId, newConv.id, []);
    await saveSpaceConversations(activeSpaceId, updated);
  }, [activeSpaceId, conversations]);

  const handleDeleteConversation = useCallback(async (convId: string) => {
    if (!activeSpaceId) return;
    const remaining = conversations.filter(c => c.id !== convId);
    setConversations(remaining);
    await deleteSpaceConversationMessages(activeSpaceId, convId);
    await saveSpaceConversations(activeSpaceId, remaining);

    if (activeConversationId === convId) {
      if (remaining.length > 0) {
        selectConversation(remaining[0].id);
      } else {
        const defaultConv: SpaceConversation = {
          id: `conv-${Date.now()}`,
          title: "New Chat",
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        setConversations([defaultConv]);
        setActiveConversationId(defaultConv.id);
        activeConversationIdRef.current = defaultConv.id;
        setChatMessages([]);
        await saveSpaceConversationMessages(activeSpaceId, defaultConv.id, []);
        await saveSpaceConversations(activeSpaceId, [defaultConv]);
      }
    }
  }, [activeSpaceId, conversations, activeConversationId, selectConversation]);

  const startRename = useCallback((convId: string, currentTitle: string) => {
    setEditingConvId(convId);
    setRenameValue(currentTitle);
  }, []);

  const finishRename = useCallback(async (convId: string) => {
    if (!activeSpaceId || !renameValue.trim()) {
      setEditingConvId(null);
      return;
    }
    const updated = conversations.map(c =>
      c.id === convId ? { ...c, title: renameValue.trim(), updatedAt: Date.now() } : c
    );
    setConversations(updated);
    setEditingConvId(null);
    await saveSpaceConversations(activeSpaceId, updated);
  }, [activeSpaceId, conversations, renameValue]);

  const cancelRename = useCallback(() => {
    setEditingConvId(null);
  }, []);

  const handleAbortChat = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  // ── Create space ─────────────────────────────────────
  const handleCreate = useCallback(async () => {
    if (!createTitle.trim()) return;
    setCreateError(null);
    try {
      let finalDescription = createDesc.trim();
      let spaceKey: CryptoKey | null = null;
      
      if (createVisibility === "private") {
        if (createPassword.length < 8) {
          setCreateError("Encryption password must be at least 8 characters long.");
          return;
        }
        
        spaceKey = await generateSpaceKey();
        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        const masterKey = await deriveMasterKey(createPassword, salt);
        const encrypted = await encryptSpaceKey(spaceKey, masterKey);
        
        const e2eeMeta = {
          salt: arrayBufferToBase64(salt),
          keyVersion: 1,
          encryptedKey: {
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            authTag: encrypted.authTag
          }
        };
        
        finalDescription = `__ENCRYPTED_SPACE__:${JSON.stringify(e2eeMeta)}\n${createDesc.trim()}`;
      }

      const space = await createSpace({
        title: createTitle.trim(),
        description: finalDescription,
        helpsWith: createTags,
        noteCount: vaultNoteCount,
        visibility: createVisibility,
      });
      
      if (createVisibility === "private" && spaceKey) {
        unlockSpace(space.id, spaceKey);
        setSpaceUnlocked(true);
      }
      
      setCreateTitle("");
      setCreateDesc("");
      setCreateTags([]);
      setCreateTagInput("");
      setCreateVisibility("local");
      setCreatePassword("");
      setShowCreateModal(false);
      await refreshSpaces();
      openSpace(space.id);
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        setAuthMessage("Sign in to create private/public cloud spaces.");
        setShowAuthModal(true);
        return;
      }
      console.error("[SpacesPage] Failed to create space:", err);
      setCreateError(err instanceof Error ? err.message : "Failed to create space.");
    }
  }, [createTitle, createDesc, createTags, vaultNoteCount, createVisibility, createPassword, refreshSpaces, openSpace]);

  const handleLockSpace = useCallback(() => {
    if (!activeSpace) return;
    lockSpace(activeSpace.id);
    setSpaceUnlocked(false);
    setView("marketplace");
    setActiveSpace(null);
    setActiveSpaceId(null);
    activeSpaceIdRef.current = null;
    showToast("Space locked.");
  }, [activeSpace]);

  const handleUnlockSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSpace || !unlockPassword) return;
    setUnlockError(null);
    try {
      const desc = activeSpace.description || "";
      if (!desc.startsWith("__ENCRYPTED_SPACE__:")) {
        setUnlockError("No encryption metadata found for this space.");
        return;
      }
      
      const newlineIndex = desc.indexOf("\n");
      const metaJsonStr = newlineIndex !== -1 
        ? desc.substring("__ENCRYPTED_SPACE__:".length, newlineIndex)
        : desc.substring("__ENCRYPTED_SPACE__:".length);
      
      const e2eeMeta = JSON.parse(metaJsonStr);
      const salt = new Uint8Array(base64ToArrayBuffer(e2eeMeta.salt));
      
      const masterKey = await deriveMasterKey(unlockPassword, salt);
      const spaceKey = await decryptSpaceKey(e2eeMeta.encryptedKey, masterKey);
      
      unlockSpace(activeSpace.id, spaceKey);
      setSpaceUnlocked(true);
      
      syncEngine.sync();
      showToast("Space unlocked successfully.");
    } catch (err) {
      console.error("[SpacesPage] Unlock failed:", err);
      setUnlockError("Incorrect password. Please try again.");
    }
  }, [activeSpace, unlockPassword]);

  const handleChangePasswordSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSpace || !changePasswordCurrent || !changePasswordNew || !changePasswordConfirm) return;
    setChangePasswordError(null);
    
    if (changePasswordNew.length < 8) {
      setChangePasswordError("New password must be at least 8 characters long.");
      return;
    }
    if (changePasswordNew !== changePasswordConfirm) {
      setChangePasswordError("Passwords do not match.");
      return;
    }
    
    try {
      const desc = activeSpace.description || "";
      if (!desc.startsWith("__ENCRYPTED_SPACE__:")) {
        setChangePasswordError("No E2EE metadata found.");
        return;
      }
      
      const newlineIndex = desc.indexOf("\n");
      const metaJsonStr = newlineIndex !== -1 
        ? desc.substring("__ENCRYPTED_SPACE__:".length, newlineIndex)
        : desc.substring("__ENCRYPTED_SPACE__:".length);
      
      const userDesc = newlineIndex !== -1 ? desc.substring(newlineIndex + 1) : "";
      
      const e2eeMeta = JSON.parse(metaJsonStr);
      const salt = new Uint8Array(base64ToArrayBuffer(e2eeMeta.salt));
      
      const oldMasterKey = await deriveMasterKey(changePasswordCurrent, salt);
      const spaceKey = await decryptSpaceKey(e2eeMeta.encryptedKey, oldMasterKey);
      
      const newSalt = window.crypto.getRandomValues(new Uint8Array(16));
      const newMasterKey = await deriveMasterKey(changePasswordNew, newSalt);
      const encrypted = await encryptSpaceKey(spaceKey, newMasterKey);
      
      const newE2eeMeta = {
        salt: arrayBufferToBase64(newSalt),
        keyVersion: 1,
        encryptedKey: {
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag
        }
      };
      
      const finalDescription = `__ENCRYPTED_SPACE__:${JSON.stringify(newE2eeMeta)}\n${userDesc}`;
      
      await updateSpace(activeSpace.id, { description: finalDescription });
      setActiveSpace(prev => prev ? { ...prev, description: finalDescription } : null);
      
      setShowChangePasswordModal(false);
      setChangePasswordCurrent("");
      setChangePasswordNew("");
      setChangePasswordConfirm("");
      showToast("Password changed successfully.");
    } catch (err) {
      console.error("[SpacesPage] Change password failed:", err);
      setChangePasswordError("Incorrect current password. Please try again.");
    }
  }, [activeSpace, changePasswordCurrent, changePasswordNew, changePasswordConfirm]);

  useEffect(() => {
    const handleAutoLocked = () => {
      if (activeSpace && activeSpace.visibility === "private") {
        setSpaceUnlocked(false);
        setView("marketplace");
        setActiveSpace(null);
        setActiveSpaceId(null);
        activeSpaceIdRef.current = null;
        showToast("Auto-locked due to inactivity.");
      }
    };

    window.addEventListener("spaces-crypto:auto-locked", handleAutoLocked);
    return () => {
      window.removeEventListener("spaces-crypto:auto-locked", handleAutoLocked);
    };
  }, [activeSpace]);

  // ── Delete space ─────────────────────────────────────
  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteSpace(id);
      setDeleteConfirmId(null);
      if (activeSpaceId === id) {
        setView("marketplace");
        setActiveSpace(null);
        setActiveSpaceId(null);
        activeSpaceIdRef.current = null;
        setActiveConversationId(null);
        activeConversationIdRef.current = null;
        setConversations([]);
        setChatMessages([]);
      }
      await refreshSpaces();
      showToast("Space deleted.");
    } catch (err) {
      setDeleteConfirmId(null);
      if (err instanceof AuthRequiredError) {
        setAuthMessage("Sign in to delete cloud spaces.");
        setShowAuthModal(true);
      } else {
        showToast(err instanceof Error ? err.message : "Failed to delete space.", "error");
      }
    }
  }, [activeSpaceId, refreshSpaces, showToast]);

  // ── Fork space ───────────────────────────────────────
  const handleFork = useCallback(async (id: string) => {
    try {
      const forked = await forkSpace(id);
      if (forked) {
        await refreshSpaces();
        showToast(`\u201c${forked.title}\u201d saved to your vault.`);
        openSpace(forked.id);
      }
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        setAuthMessage("Sign in to fork cloud spaces.");
        setShowAuthModal(true);
      } else {
        showToast(err instanceof Error ? err.message : "Remix failed.", "error");
      }
    }
  }, [refreshSpaces, openSpace, showToast]);

  const handleSignOut = useCallback(async () => {
    try {
      await authManager.signOut();
      await refreshSpaces();
    } catch (err) {
      console.error("[Spaces] Sign out failed:", err);
    }
  }, [refreshSpaces]);

  // ── Build index (auto-indexes entire vault) ──────────
  const handleBuildIndex = useCallback(async () => {
    if (!activeSpaceId) return;
    setIsIndexing(true);
    
    try {
      let customNotes: VaultNote[] | undefined = undefined;
      
      const currentUserId = authManager.getUserId();
      const isRemoteSpace = activeSpace && activeSpace.visibility !== "local" && activeSpace.ownerId !== currentUserId;
      
      if (activeSpace && activeSpace.visibility !== "local" && isRemoteSpace && isSupabaseConfigured) {
        // Cloud space (Remote): Fetch notes directly from Supabase to index them on the cloud
        const { data: cloudNotes, error: fetchErr } = await supabase
          .from("notes")
          .select("path, title, content, is_canvas")
          .eq("space_id", activeSpaceId)
          .eq("deleted", false);
          
        if (fetchErr) throw fetchErr;
        
        if (cloudNotes) {
          customNotes = cloudNotes.map(n => ({
            path: n.path,
            title: n.title,
            content: n.content || "",
            isCanvas: n.is_canvas || false,
          }));
        }
      }

      // Fetch a FRESH file tree from the API to avoid stale props
      const api = getAPI();
      const freshTree = await api.getFileTree();
      
      await buildVectorIndex(activeSpaceId, freshTree, (done, total) => {
        setIndexProgress({ done, total });
      }, customNotes);
      
      setIsIndexed(true);
      // Refresh space to get updated noteCount
      const updated = await getSpace(activeSpaceId);
      if (updated) setActiveSpace(updated);
      await refreshSpaces();
    } catch (err) {
      console.error("[Spaces] Index build failed:", err);
      showToast("Indexing failed. Check logs for details.", "error");
    }
    setIsIndexing(false);
  }, [activeSpaceId, activeSpace, refreshSpaces, showToast]);

  useEffect(() => {
    if (activeSpaceId && fileTree.length > 0 && view === "space" && !isIndexed && !isIndexing && !isRemote) {
      handleBuildIndex();
    }
  }, [activeSpaceId, activeSpace, isRemote, isIndexed, isIndexing, view, fileTree.length, handleBuildIndex]);

  // Fetch remote notes for preview when entering a cloud space
  useEffect(() => {
    if (activeSpaceId && activeSpace && activeSpace.visibility !== "local" && view === "space") {
      const fetchRemote = async () => {
        setIsLoadingRemote(true);
        try {
          const { data } = await supabase
            .from("notes")
            .select("id, title")
            .eq("space_id", activeSpaceId)
            .eq("deleted", false)
            .limit(15);
          
          if (data) {
            setRemoteNotes(data.map(n => ({ path: n.id, title: n.title })));
          }
        } catch (err) {
          console.error("[Spaces] Failed to fetch remote notes:", err);
        }
        setIsLoadingRemote(false);
      };
      fetchRemote();
    } else {
      setRemoteNotes([]);
    }
  }, [activeSpaceId, activeSpace, view]);

  // ── Chat query ───────────────────────────────────────
  const handleChat = useCallback(async (query?: string) => {
    const q = (query || chatInput).trim();
    if (!q || !activeSpaceId || !activeSpace || isQuerying || !activeConversationId) return;

    // Handle auto-rename and updatedAt timestamp updates
    let updatedConversations = conversations;
    const activeConv = conversations.find(c => c.id === activeConversationId);
    if (activeConv) {
      const isNewChat = activeConv.title === "New Chat";
      let title = activeConv.title;
      if (isNewChat) {
        title = q.substring(0, 30).trim();
        if (q.length > 30) {
          title += "...";
        }
        title = title.replace(/^["']|["']$/g, "");
      }
      updatedConversations = conversations.map(c =>
        c.id === activeConversationId
          ? { ...c, title, updatedAt: Date.now() }
          : c
      ).sort((a, b) => b.updatedAt - a.updatedAt);
      setConversations(updatedConversations);
      saveSpaceConversations(activeSpaceId, updatedConversations);
    }

    const userMsg: SpaceChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: q,
      timestamp: Date.now(),
    };
    setChatMessages((prev) => {
      const next = [...prev, userMsg];
      saveSpaceConversationMessages(activeSpaceId, activeConversationId, next);
      return next;
    });
    setChatInput("");
    setIsQuerying(true);
    setStreamingText("");

    const controller = new AbortController();
    abortControllerRef.current = controller;
    let accumulatedAnswer = "";

    try {
      // Parse query for mentioned files [[Note Title]]
      const matches = [...q.matchAll(/\[\[([^\]]+)\]\]/g)];
      const explicitNotes: { path: string; title: string; content: string }[] = [];

      if (matches.length > 0) {
        const allVaultNotes = getAllVaultNotes(fileTree);
        for (const match of matches) {
          const title = match[1].trim();
          const found = allVaultNotes.find(
            (n) => n.title.toLowerCase() === title.toLowerCase()
          );
          if (found) {
            try {
              const content = await (window as any).electronAPI.readFile(found.path);
              explicitNotes.push({ path: found.path, title: found.title, content });
            } catch (err) {
              console.warn(`[SpacesPage] Failed to read mentioned note: ${found.path}`, err);
            }
          }
        }
      }

      // ── Detect Complex/Vault-Wide Tasks ───────────────────
      const historyText = (chatMessages || []).slice(-3).map(m => m.content).join(" ");
      const combinedText = (q + " " + historyText).toLowerCase();

      const isOrphanQuery = /orphan/i.test(combinedText) || /unlinked/i.test(combinedText);
      const isVaultWideLinking = /connect all|link all|link those/i.test(combinedText) ||
                                 (/continue|next|proceed|go on/i.test(q) && (/orphan|link|connect/i.test(combinedText)));
      const isStructureQuery = /structure|organize|restructure|hierarchy|folders/i.test(combinedText);
      const isDuplicateQuery = /duplicate|merge|redundant/i.test(combinedText);

      let finalQuery = q;

      if (isOrphanQuery || isVaultWideLinking || isStructureQuery || isDuplicateQuery) {
        // 1. Load graph data to find relationships and orphans
        let graph: { nodes: any[]; edges: any[] } = { nodes: [], edges: [] };
        try {
          if ((window as any).electronAPI.getGraphData) {
            graph = await (window as any).electronAPI.getGraphData();
          }
        } catch (err) {
          console.warn("[SpacesPage] Failed to retrieve graph data:", err);
        }

        // 2. Identify orphan notes (notes with 0 connections)
        const hasConnections = new Set<string>();
        for (const edge of graph.edges || []) {
          if (edge.source) hasConnections.add(edge.source.toLowerCase());
          if (edge.target) hasConnections.add(edge.target.toLowerCase());
        }

        const allNotesList = getAllVaultNotes(fileTree);
        const orphanNodes: any[] = (graph.nodes || []).filter(
          (node: any) => node.id && !hasConnections.has(node.id.toLowerCase()) && node.path
        );

        // 3. Load contents of orphans if they are queried
        if ((isOrphanQuery || isVaultWideLinking) && orphanNodes.length > 0) {
          const orphansToLoad = orphanNodes
            .filter(o => !explicitNotes.some(n => n.path === o.path));
          
          await Promise.all(
            orphansToLoad.map(async (orphan) => {
              try {
                const content = await (window as any).electronAPI.readFile(orphan.path);
                explicitNotes.push({ path: orphan.path, title: orphan.name, content });
              } catch (err) {
                console.warn(`[SpacesPage] Failed to read orphan file: ${orphan.path}`, err);
              }
            })
          );
        }

        // 4. Inject a comprehensive vault list summary into the query context
        const notesSummary = allNotesList
          .map(n => {
            const nodeKey = n.title.toLowerCase();
            const isOrphan = orphanNodes.some((o: any) => o.id && o.id.toLowerCase() === nodeKey);
            const status = isOrphan ? " [ORPHAN - No links]" : "";
            return `- Note: "${n.title}" (Path: "${n.path}")${status}`;
          })
          .join("\n");

        finalQuery += `\n\n--- VAULT STRUCTURE SUMMARY ---\nHere is the current directory structure and connectivity of the vault:\n${notesSummary}\n\n`;
        finalQuery += `IMPORTANT UPDATING INSTRUCTIONS:\n`;
        finalQuery += `1. There are ${orphanNodes.length} orphan notes in total. The full content of all ${orphanNodes.length} notes has been loaded for your direct edit access.\n`;
        finalQuery += `2. You should update ALL orphan notes in a single go by using Option B (search-and-replace patches) under 'changes'. Simply search for a specific line (e.g. the main heading or the end of the note) and replace it with that line plus the new [[Wiki Link]]. This allows you to process all files in a single response quickly. Only use Option A (full file updates) if you are editing 1-2 notes maximum.\n`;
        finalQuery += `3. Do not use emojis in the responses, titles, paths, or contents.`;
      }

      const spaceMeta: SpaceMetadata = {
        title: activeSpace.title,
        description: activeSpace.description,
        helpsWith: activeSpace.helpsWith || [],
        explicitNotes: explicitNotes.length > 0 ? explicitNotes : undefined,
      };
      const result = await querySpaceStreaming(activeSpaceId, finalQuery, spaceMeta, chatMessages, (chunk) => {
        accumulatedAnswer += chunk;
        setStreamingText(accumulatedAnswer);
      }, controller.signal);

      const assistantMsg: SpaceChatMessage = {
        id: `msg-${Date.now()}-resp`,
        role: "assistant",
        content: result.answer,
        sources: result.sources.map((s) => s.noteTitle),
        timestamp: Date.now(),
      };
      setChatMessages((prev) => {
        const next = [...prev, assistantMsg];
        saveSpaceConversationMessages(activeSpaceId, activeConversationId, next);
        return next;
      });
      setStreamingText("");
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (isAbort) {
        if (accumulatedAnswer.trim()) {
          const abortedMsg: SpaceChatMessage = {
            id: `msg-${Date.now()}-resp`,
            role: "assistant",
            content: accumulatedAnswer.trim() + " [Generation Stopped]",
            sources: [],
            timestamp: Date.now(),
          };
          setChatMessages((prev) => {
            const next = [...prev, abortedMsg];
            saveSpaceConversationMessages(activeSpaceId, activeConversationId, next);
            return next;
          });
        }
      } else {
        const errMsg: SpaceChatMessage = {
          id: `msg-${Date.now()}-err`,
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : "Query failed"}`,
          timestamp: Date.now(),
        };
        setChatMessages((prev) => {
          const next = [...prev, errMsg];
          saveSpaceConversationMessages(activeSpaceId, activeConversationId, next);
          return next;
        });
      }
      setStreamingText("");
    } finally {
      abortControllerRef.current = null;
      setIsQuerying(false);
    }
  }, [chatInput, activeSpaceId, activeSpace, isQuerying, fileTree, chatMessages, activeConversationId, conversations]);

  // ── Applied Actions state ─────────────────────────────
  const [appliedActions, setAppliedActions] = useState<Record<string, boolean>>({});

  // ── Dashboard Operations Click Handlers ────────────────
  const handleGenerateSummary = useCallback(async () => {
    if (!activeSpace) return;
    await handleChat("Generate a comprehensive, highly structured space_summary.md file for the entire active space, synthesizing all key concepts, notes, and topics in the structured multi-note synthesis format: # Topic, ## Key Ideas, ## Insights, ## Gaps, ## Suggested Actions. Return this only as a create_note action block.");
  }, [handleChat, activeSpace]);

  const handleFindInsights = useCallback(async () => {
    if (!activeSpace) return;
    await handleChat("Analyze all notes in this space. Find repeated ideas, direct contradictions, and missing definitions or knowledge gaps. Generate an insight report detailing these findings. Return this as an insight_report action block.");
  }, [handleChat, activeSpace]);

  const handleOrganizeSpace = useCallback(async () => {
    if (!activeSpace) return;
    await handleChat("Examine the titles, folders, and contents of the notes in this space. Suggest note mergers for duplicate topics, title improvements, and folder restructuring changes to improve coherence and indexing. Return this as a suggest_structure action block.");
  }, [handleChat, activeSpace]);

  // ── Filesystem Action Executors ───────────────────────
  const handleCreateNoteAction = async (title: string, path: string, content: string, msgId: string) => {
    try {
      let notePath = path || `${title}.md`;
      if (!notePath.endsWith(".md")) notePath += ".md";

      const exists = await (window as any).electronAPI.fileExists(notePath);
      if (exists) {
        const overwrite = window.confirm(`Note "${notePath}" already exists. Overwrite?`);
        if (!overwrite) return;
      }

      await (window as any).electronAPI.writeFile(notePath, content);
      setAppliedActions(prev => ({ ...prev, [msgId]: true }));
      showToast(`Note "${notePath}" created successfully!`);
      handleBuildIndex();
    } catch (err) {
      showToast("Failed to create note: " + (err instanceof Error ? err.message : "Unknown error"), "error");
    }
  };

  const handleUpdateNoteAction = async (path: string, content: string, msgId: string) => {
    try {
      const exists = await (window as any).electronAPI.fileExists(path);
      if (!exists) {
        showToast(`Note "${path}" does not exist to update. Creating it instead.`, "success");
      }
      await (window as any).electronAPI.writeFile(path, content);
      setAppliedActions(prev => ({ ...prev, [msgId]: true }));
      showToast(`Note "${path}" updated successfully!`);
      handleBuildIndex();
    } catch (err) {
      showToast("Failed to update note: " + (err instanceof Error ? err.message : "Unknown error"), "error");
    }
  };

  const handleInsertLinksAction = async (links: Array<{ from: string, to: string, reason: string }>, msgId: string) => {
    try {
      for (const link of links) {
        let fromPath = link.from;
        if (!fromPath.endsWith(".md")) fromPath += ".md";
        let toTitle = link.to.replace(/\.md$/, "");

        const exists = await (window as any).electronAPI.fileExists(fromPath);
        if (exists) {
          const originalContent = await (window as any).electronAPI.readFile(fromPath);
          const linkText = `\n\n%% AI Suggestion: ${link.reason} %%\n[[${toTitle}]]\n`;
          await (window as any).electronAPI.writeFile(fromPath, originalContent + linkText);
        }
      }
      setAppliedActions(prev => ({ ...prev, [msgId]: true }));
      showToast("Wiki-links inserted successfully!");
      handleBuildIndex();
    } catch (err) {
      showToast("Failed to insert links: " + (err instanceof Error ? err.message : "Unknown error"), "error");
    }
  };

  const handleApplyStructureAction = async (changes: any[], msgId: string) => {
    try {
      for (const change of changes) {
        if (change.type === "rename" || change.type === "move") {
          let oldPath = change.note;
          let newPath = change.target;
          if (!oldPath.endsWith(".md")) oldPath += ".md";
          if (!newPath.endsWith(".md")) newPath += ".md";

          const exists = await (window as any).electronAPI.fileExists(oldPath);
          if (exists) {
            await (window as any).electronAPI.renameFile(oldPath, newPath);
          }
        } else if (change.type === "merge") {
          const targetTitle = change.target;
          let targetPath = `${targetTitle}.md`;
          const mergedContent = change.content;

          await (window as any).electronAPI.writeFile(targetPath, mergedContent);

          for (const srcNote of change.notes) {
            let srcPath = srcNote;
            if (!srcPath.endsWith(".md")) srcPath += ".md";
            const srcExists = await (window as any).electronAPI.fileExists(srcPath);
            if (srcExists) {
              await (window as any).electronAPI.deleteFile(srcPath);
            }
          }
        }
      }
      setAppliedActions(prev => ({ ...prev, [msgId]: true }));
      showToast("Restructuring applied successfully!");
      handleBuildIndex();
    } catch (err) {
      showToast("Failed to apply restructuring: " + (err instanceof Error ? err.message : "Unknown error"), "error");
    }
  };

  const handleSaveInsightsAction = async (insights: any[], msgId: string) => {
    try {
      if (!activeSpace) return;
      const timestamp = new Date().toLocaleDateString();
      const path = `Insights - ${activeSpace.title}.md`;
      let content = `# Space Insight Report: ${activeSpace.title}\n*Generated by AI Operator on ${timestamp}*\n\n`;

      insights.forEach((insight, idx) => {
        content += `### ${idx + 1}. [${insight.type.toUpperCase()}] ${insight.description}\n`;
        if (insight.notes && insight.notes.length > 0) {
          content += `*Related Notes:* ${insight.notes.map((n: string) => `[[${n.replace(/\.md$/, "")}]]`).join(", ")}\n`;
        }
        content += `\n`;
      });

      await (window as any).electronAPI.writeFile(path, content);
      setAppliedActions(prev => ({ ...prev, [msgId]: true }));
      showToast(`Insight report created as "${path}"!`);
      handleBuildIndex();
    } catch (err) {
      showToast("Failed to save report: " + (err instanceof Error ? err.message : "Unknown error"), "error");
    }
  };

  const handleOpenSource = useCallback((noteTitle: string, chunkText: string) => {
    let notePath = "";
    const searchTree = (nodes: any[]) => {
      for (const node of nodes) {
        if (node.isFolder) {
          searchTree(node.children || []);
        } else if (node.name.replace(/\.md$/, "") === noteTitle.replace(/\.md$/, "")) {
          notePath = node.path;
          break;
        }
      }
    };
    searchTree(fileTree || []);

    if (!notePath) {
      notePath = `${noteTitle}.md`;
    }

    onOpenNote?.(notePath);

    if (chunkText) {
      setTimeout(() => {
        const event = new CustomEvent("editor:highlight-text", {
          detail: { path: notePath, text: chunkText }
        });
        document.dispatchEvent(event);
      }, 300);
    }
  }, [fileTree, onOpenNote]);

  const resolveActionContent = async (action: any): Promise<{ before: string, after: string }> => {
    let filePath = action.file_path || action.path || "";
    if (filePath.startsWith("/")) filePath = filePath.substring(1);

    let before = action.changes?.before || "";
    let after = action.changes?.after || action.content || "";

    if (action.changes?.search !== undefined && action.changes?.replace !== undefined) {
      try {
        before = await getAPI().readFile(filePath) || "";
        after = before.replace(action.changes.search, action.changes.replace);
      } catch (err) {
        console.warn(`[SpacesPage] Failed to read file for patch: ${filePath}`, err);
      }
    } else if (!before && filePath) {
      try {
        before = await getAPI().readFile(filePath) || "";
      } catch (err) {
        // Fallback
      }
    }
    return { before, after };
  };

  const handleApplySingleAction = async (action: any, msgId: string, actionIndex?: number) => {
    const isMulti = actionIndex !== undefined;
    const key = isMulti ? `${msgId}-${actionIndex}` : msgId;
    
    try {
      if (action.type === "create_note") {
        let notePath = action.path || `${action.title}.md`;
        if (notePath.endsWith("/")) {
          notePath = notePath + (action.title || "Untitled");
        }
        if (!notePath.endsWith(".md")) notePath += ".md";

        if (notePath.startsWith("/")) {
          notePath = notePath.substring(1);
        }

        const exists = await getAPI().fileExists(notePath);
        if (exists) {
          const overwrite = window.confirm(`Note "${notePath}" already exists. Overwrite?`);
          if (!overwrite) return false;
        }

        await getAPI().writeFile(notePath, action.content);
        
        if (collaborationEngine.activeSpaceId) {
          await collaborationEngine.persistNoteEdit(notePath, action.content);
          syncEngine.triggerPush();
        }

        setAppliedActions(prev => ({ ...prev, [key]: true }));
        showToast(`Note "${notePath}" created successfully!`);
      } else if (action.type === "update_note") {
        let notePath = action.file_path || action.path;
        if (notePath.startsWith("/")) {
          notePath = notePath.substring(1);
        }

        const { after: afterContent } = await resolveActionContent(action);
        await getAPI().writeFile(notePath, afterContent);
        
        if (collaborationEngine.activeSpaceId) {
          await collaborationEngine.persistNoteEdit(notePath, afterContent);
          syncEngine.triggerPush();
        }

        setAppliedActions(prev => ({ ...prev, [key]: true }));
        showToast(`Note "${notePath}" updated successfully!`);
      }
      
      handleBuildIndex();
      return true;
    } catch (err) {
      showToast("Failed to execute action: " + (err instanceof Error ? err.message : "Unknown error"), "error");
      return false;
    }
  };

  const handleApplyAllActions = async (actions: any[], msgId: string) => {
    let successCount = 0;
    for (let i = 0; i < actions.length; i++) {
      const success = await handleApplySingleAction(actions[i], msgId, i);
      if (success) successCount++;
    }
    if (successCount === actions.length) {
      setAppliedActions(prev => ({ ...prev, [msgId]: true }));
    }
    showToast(`Applied ${successCount} of ${actions.length} actions.`);
  };

  const handleChatKeyDown = (e: React.KeyboardEvent) => {
    if (showMentionDropdown && filteredNotes.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionActiveIndex((prev) => (prev + 1) % filteredNotes.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionActiveIndex((prev) => (prev - 1 + filteredNotes.length) % filteredNotes.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        selectNote(filteredNotes[mentionActiveIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setShowMentionDropdown(false);
      }
    } else {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleChat();
      }
    }
  };

  // Scroll to bottom on new messages
  useEffect(() => {
    if (chatMessages.length > 0 || streamingText) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [chatMessages, streamingText]);

  // Dynamically adjust textarea height based on content
  useEffect(() => {
    const adjustHeight = (textarea: HTMLTextAreaElement | null) => {
      if (!textarea) return;
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    adjustHeight(centralInputRef.current);
    adjustHeight(bottomInputRef.current);
  }, [chatInput]);

  // ── Tag input ────────────────────────────────────────
  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === ",") && createTagInput.trim()) {
      e.preventDefault();
      const tag = createTagInput.trim().replace(/,/g, "");
      if (tag && !createTags.includes(tag)) {
        setCreateTags((prev) => [...prev, tag]);
      }
      setCreateTagInput("");
    }
    if (e.key === "Backspace" && !createTagInput && createTags.length > 0) {
      setCreateTags((prev) => prev.slice(0, -1));
    }
  };

  // ── Filtering and Search inside Marketplace ─────────
  const filteredSpaces = spaces.filter((s) => {
    const matchesSearch =
      s.title.toLowerCase().includes(marketSearch.toLowerCase()) ||
      (s.description || "").toLowerCase().includes(marketSearch.toLowerCase()) ||
      (s.helpsWith || []).some(t => t.toLowerCase().includes(marketSearch.toLowerCase()));

    if (marketFilter === "local") {
      return matchesSearch && s.visibility === "local";
    }
    if (marketFilter === "private") {
      return matchesSearch && s.visibility === "private";
    }
    if (marketFilter === "public") {
      return matchesSearch && s.visibility === "public";
    }
    return matchesSearch;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Marketplace View
  // ═══════════════════════════════════════════════════════════════════════════

  if (view === "marketplace") {
    return (
      <div className="spaces-page">
        {/* Toast Notification */}
        {toastMessage && (
          <div className={`space-toast ${toastType}`} onClick={() => setToastMessage(null)}>
            {toastMessage}
          </div>
        )}

        <div className="spaces-marketplace-container">
          {/* Left Sidebar Panel */}
          <div className="spaces-marketplace-sidebar">
            <div className="spaces-sidebar-brand">
              <SpacesIcon size={26} />
              <span>Spaces</span>
            </div>

            <button
              className="btn btn-primary btn-sm spaces-sidebar-new-btn"
              onClick={() => setShowCreateModal(true)}
            >
              <Plus size={14} /> New Space
            </button>

            <div className="spaces-menu-list">
              <button
                className={`spaces-menu-item ${marketFilter === "all" ? "active" : ""}`}
                onClick={() => setMarketFilter("all")}
              >
                All Spaces
              </button>
              <button
                className={`spaces-menu-item ${marketFilter === "local" ? "active" : ""}`}
                onClick={() => setMarketFilter("local")}
              >
                Local Spaces
              </button>
              <button
                className={`spaces-menu-item ${marketFilter === "private" ? "active" : ""}`}
                onClick={() => setMarketFilter("private")}
              >
                Private Spaces
              </button>
              <button
                className={`spaces-menu-item ${marketFilter === "public" ? "active" : ""}`}
                onClick={() => setMarketFilter("public")}
              >
                Public Spaces
              </button>
            </div>

            {/* Cloud User Profile status in Sidebar */}
            <div className="spaces-sidebar-user-section">
              <div className="spaces-user-status-text">
                {isSupabaseConfigured
                  ? authEmail
                    ? `Cloud Connected\n${authEmail}`
                    : "Cloud database online. Sign in for sync."
                  : "Cloud offline (Local Mode)"}
              </div>
              <div>
                {authEmail ? (
                  <button className="btn btn-ghost btn-sm" onClick={handleSignOut} style={{ width: "100%", padding: "6px 12px", fontSize: 11 }}>
                    <LogOut size={12} /> Sign out
                  </button>
                ) : (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setAuthMessage("Sign in to sync your knowledge layers with the cloud.");
                      setShowAuthModal(true);
                    }}
                    disabled={!isSupabaseConfigured}
                    title={!isSupabaseConfigured ? "Configure Supabase vars in environment to enable cloud database" : undefined}
                    style={{ width: "100%", padding: "6px 12px", fontSize: 11 }}
                  >
                    <LogIn size={12} /> Sign in
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Right Main Content Panel */}
          <div className="spaces-marketplace-content">
            <div className="spaces-marketplace-header">
              <div className="spaces-search-wrapper">
                <Search size={13} className="spaces-search-icon" />
                <input
                  type="text"
                  placeholder="Search custom spaces..."
                  className="spaces-search-input"
                  value={marketSearch}
                  onChange={(e) => setMarketSearch(e.target.value)}
                />
              </div>

              <div className="spaces-marketplace-header-right">
                <div className="spaces-marketplace-stats">
                  Vault Notes: {vaultNoteCount} | Custom Layers: {spaces.length}
                </div>
                <button className="spaces-close-btn" onClick={onClose}>
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* Main Body Grid */}
            <div className="spaces-body">
              {filteredSpaces.length === 0 ? (
                <div className="spaces-empty">
                  <SpacesIcon size={36} style={{ opacity: 0.3, color: "var(--text-muted)", marginBottom: 8 }} />
                  <p>
                    {marketSearch
                      ? `No spaces matched the query "${marketSearch}".`
                      : `Build your first queryable AI knowledge layer over your ${vaultNoteCount} notes.`}
                  </p>
                  {!marketSearch && (
                    <button className="btn btn-primary btn-sm" onClick={() => setShowCreateModal(true)}>
                      <Plus size={14} /> Create a Space
                    </button>
                  )}
                </div>
              ) : (
                <div className="spaces-grid">
                  {filteredSpaces.map((s) => (
                    <div key={s.id} className="space-card" onClick={() => openSpace(s.id)}>
                      <div className="space-card-header-row">
                        <h3 className="space-card-title">{s.title}</h3>
                        <span className={`visibility-badge ${s.visibility}`}>
                          {getVisibilityLabel(s.visibility)}
                        </span>
                      </div>

                      {cleanDescription(s.description) && <p className="space-card-desc">{cleanDescription(s.description)}</p>}

                      {(s.helpsWith || []).length > 0 && (
                        <div className="space-card-tags">
                          {(s.helpsWith || []).map((tag) => (
                            <span key={tag} className="space-tag">{tag}</span>
                          ))}
                        </div>
                      )}

                      <div className="space-card-meta">
                        <div className="space-card-meta-left">
                          <span>{s.noteCount} note{s.noteCount !== 1 ? "s" : ""} index size</span>
                        </div>
                        <div className="space-card-actions" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => handleFork(s.id)} title="Remix/Save Space">
                            <Copy size={11} /> Remix
                          </button>
                          <button onClick={() => setDeleteConfirmId(s.id)} title="Delete Space">
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Create Space Dialog Modal */}
        {showCreateModal && (
          <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>New Knowledge Space</h3>
                <button className="modal-close" onClick={() => setShowCreateModal(false)}>
                  <X size={15} />
                </button>
              </div>
              <div className="space-create-form">
                <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>
                  Creates an AI-queryable vector directory indexing all {vaultNoteCount} notes in your active vault.
                </div>

                <div className="space-form-field">
                  <label>Title</label>
                  <input
                    className="space-form-input"
                    placeholder="e.g. Research Hub, React Dev"
                    value={createTitle}
                    onChange={(e) => setCreateTitle(e.target.value)}
                    autoFocus
                  />
                </div>

                <div className="space-form-field">
                  <label>Description</label>
                  <textarea
                    className="space-form-input"
                    placeholder="Describe the knowledge covered by this space..."
                    value={createDesc}
                    onChange={(e) => setCreateDesc(e.target.value)}
                  />
                </div>

                <div className="space-form-field">
                  <label>Focus Tags (Press Enter / Comma)</label>
                  <div className="space-form-tags-input">
                    {createTags.map((tag) => (
                      <span key={tag} className="space-form-tag">
                        {tag}
                        <button onClick={() => setCreateTags((prev) => prev.filter((t) => t !== tag))}>
                          <X size={8} />
                        </button>
                      </span>
                    ))}
                    <input
                      placeholder={createTags.length === 0 ? "e.g. backend, hooks, styling" : ""}
                      value={createTagInput}
                      onChange={(e) => setCreateTagInput(e.target.value)}
                      onKeyDown={handleTagKeyDown}
                    />
                  </div>
                </div>

                <div className="space-form-field">
                  <label>Vault Visibility</label>
                  <div className="space-visibility-options">
                    <button
                      type="button"
                      className={`space-visibility-option ${createVisibility === "local" ? "active" : ""}`}
                      onClick={() => setCreateVisibility("local")}
                    >
                      Local-Only
                    </button>
                    <button
                      type="button"
                      className={`space-visibility-option ${createVisibility === "private" ? "active" : ""}`}
                      onClick={() => setCreateVisibility("private")}
                      disabled={!isSupabaseConfigured}
                    >
                      Private Cloud
                    </button>
                    <button
                      type="button"
                      className={`space-visibility-option ${createVisibility === "public" ? "active" : ""}`}
                      onClick={() => setCreateVisibility("public")}
                      disabled={!isSupabaseConfigured}
                    >
                      Public Cloud
                    </button>
                  </div>
                  <div className="space-form-hint">
                    {createVisibility === "local"
                      ? "Securely cached on this local device only."
                      : createVisibility === "private"
                        ? "Encrypted & synced. Access restricted to your logged account."
                        : "Published dynamically. Discoverable and remixable by others."}
                  </div>
                  {!isSupabaseConfigured && (
                    <div className="space-form-hint warning">
                      Cloud DB parameters (Supabase environment keys) are required to toggle remote features.
                    </div>
                  )}
                  {createVisibility === "private" && (
                    <div className="space-form-field" style={{ marginTop: '12px' }}>
                      <label>Encryption Password (Min 8 characters)</label>
                      <input
                        type="password"
                        className="space-form-input"
                        placeholder="Create a strong password..."
                        value={createPassword}
                        onChange={(e) => setCreatePassword(e.target.value)}
                        required
                      />
                      <div className="space-form-hint warning" style={{ marginTop: '4px', color: '#eab308' }}>
                        <strong>WARNING:</strong> This password cannot be recovered. If you lose it, you will lose access to all notes in this private space.
                      </div>
                    </div>
                  )}
                </div>

                {createError && <div className="space-form-error">{createError}</div>}

                <div className="space-form-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowCreateModal(false)}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleCreate}
                    disabled={!createTitle.trim()}
                  >
                    Create Space
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirm Modal */}
        {deleteConfirmId && (() => {
          const spaceToDelete = spaces.find(s => s.id === deleteConfirmId);
          const isCloud = spaceToDelete && spaceToDelete.visibility !== "local";
          const currentUserId = authManager.getUserId();
          const isOwner = spaceToDelete && currentUserId && spaceToDelete.ownerId === currentUserId;
          const canDelete = !isCloud || (authManager.isLoggedIn() && isOwner);

          return (
            <div className="modal-overlay" onClick={() => setDeleteConfirmId(null)}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
                <div className="modal-header">
                  <h3>Delete Space</h3>
                  <button className="modal-close" onClick={() => setDeleteConfirmId(null)}>
                    <X size={15} />
                  </button>
                </div>
                <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
                    Are you sure you want to delete <strong>{spaceToDelete?.title || "this layer"}</strong>?
                    {" "}
                    {spaceToDelete?.visibility === "local"
                      ? "This action clears all local index tables."
                      : isOwner
                        ? "This will permanently remove the indices from cloud registers."
                        : ""}
                  </p>

                  {isCloud && !authManager.isLoggedIn() && (
                    <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
                      Account authentication is required to modify cloud states.
                    </p>
                  )}

                  {isCloud && authManager.isLoggedIn() && !isOwner && (
                    <p style={{ fontSize: 11, color: "#e8a838", margin: 0 }}>
                      Only space authors can delete this layer from cloud directory.
                    </p>
                  )}

                  <div className="space-form-actions" style={{ marginTop: 8 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setDeleteConfirmId(null)}>
                      Cancel
                    </button>
                    <button
                      className="btn btn-primary btn-sm btn-danger"
                      onClick={() => handleDelete(deleteConfirmId)}
                      disabled={!canDelete}
                    >
                      Confirm Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {showAuthModal && (
          <AuthModal
            onClose={() => setShowAuthModal(false)}
            onSuccess={() => {
              setShowAuthModal(false);
              refreshSpaces();
            }}
            message={authMessage}
          />
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Space View (Dual-Column Overhaul)
  // ═══════════════════════════════════════════════════════════════════════════

  if (!activeSpace) return null;

  if (activeSpace.visibility === "private" && !spaceUnlocked) {
    return (
      <div className="spaces-page space-view" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--bg-primary)' }}>
        <div style={{
          width: '100%',
          maxWidth: '400px',
          padding: '40px 32px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-medium)',
          borderRadius: '12px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '24px',
          textAlign: 'center'
        }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: 'rgba(59, 130, 246, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-accent)'
          }}>
            <Lock size={32} />
          </div>
          <div>
            <h3 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 8px 0' }}>Unlock Space</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
              <strong>{activeSpace.title}</strong> is protected with Zero-Knowledge E2EE. Enter the password to unlock.
            </p>
          </div>
          <form onSubmit={handleUnlockSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left' }}>
              <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-muted)' }}>Password</label>
              <input
                type="password"
                className="space-form-input"
                placeholder="Enter password..."
                value={unlockPassword}
                onChange={(e) => {
                  setUnlockPassword(e.target.value);
                  setUnlockError(null);
                }}
                autoFocus
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
              {unlockError && (
                <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px', fontWeight: 500 }}>
                  {unlockError}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setView("marketplace");
                  setActiveSpace(null);
                  setActiveSpaceId(null);
                  activeSpaceIdRef.current = null;
                }}
                style={{ flex: 1 }}
              >
                Back
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={!unlockPassword}
                style={{ flex: 1 }}
              >
                Unlock
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="spaces-page space-view">
      {/* Dual Column Workspace Container */}
      <div className="space-view-workspace">
        
        {/* LEFT COLUMN: Sidebar (ChatGPT-Inspired Details & Notes Explorer) */}
        <div className="space-view-sidebar">
          {/* ChatGPT-style Sidebar Header Actions */}
          <div className="space-sidebar-actions-group">
            <button
              className="space-sidebar-btn primary-action"
              onClick={handleNewConversation}
              title="Start a new AI conversation session"
            >
              <Plus size={14} />
              <span>New chat</span>
            </button>

            <button
              className="space-sidebar-btn secondary-action"
              onClick={() => {
                setView("marketplace");
                setActiveSpace(null);
                setActiveSpaceId(null);
                activeSpaceIdRef.current = null;
                setActiveConversationId(null);
                activeConversationIdRef.current = null;
                setConversations([]);
                setChatMessages([]);
                setIsIndexed(false);
              }}
              title="Return to the spaces marketplace directory"
            >
              <ArrowLeft size={14} />
              <span>Back to Spaces</span>
            </button>
          </div>

          {/* Space Information Details block */}
          <div className="space-sidebar-section">
            <div className="space-sidebar-section-header">Space Layer</div>
            <div className="space-sidebar-project-card">
              <div className="space-sidebar-project-header">
                <span className={`space-sidebar-visibility ${activeSpace.visibility}`}>
                  {getVisibilityLabel(activeSpace.visibility)}
                </span>
                <span className="space-sidebar-project-title">{activeSpace.title}</span>
              </div>
              
              {cleanDescription(activeSpace.description) && (
                <p className="space-sidebar-project-desc">{cleanDescription(activeSpace.description)}</p>
              )}

              {(activeSpace.helpsWith || []).length > 0 && (
                <div className="space-sidebar-project-tags">
                  {(activeSpace.helpsWith || []).map((tag) => (
                    <span key={tag} className="space-sidebar-project-tag">{tag}</span>
                  ))}
                </div>
              )}

              <div className="space-sidebar-project-meta">
                {activeSpace.visibility === "local" 
                  ? `${activeSpace.noteCount || vaultNoteCount} notes indexed` 
                  : `${activeSpace.noteCount ?? 0} notes indexed`}
              </div>

              <div className="space-sidebar-project-actions">
                {!isRemote && (
                  <button
                    className="space-sidebar-project-btn"
                    onClick={handleBuildIndex}
                    disabled={isIndexing}
                    title="Recompute vector indexes over note database"
                  >
                    <RefreshCw size={11} className={isIndexing ? "spinner" : ""} />
                    <span>Re-index</span>
                  </button>
                )}
                <button className="space-sidebar-project-btn" onClick={() => handleFork(activeSpace.id)}>
                  <Copy size={11} />
                  <span>Remix</span>
                </button>
                {activeSpace.visibility === "private" && (
                  <button
                    className="space-sidebar-project-btn"
                    onClick={handleLockSpace}
                    title="Lock this E2EE space"
                  >
                    <Lock size={11} />
                    <span>Lock Space</span>
                  </button>
                )}
                {activeSpace.visibility === "private" && activeSpace.ownerId === currentUserId && (
                  <button
                    className="space-sidebar-project-btn"
                    onClick={() => setShowChangePasswordModal(true)}
                    title="Change password for E2EE"
                  >
                    <Lock size={11} />
                    <span>Change Password</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Space Operations Dashboard */}
          <div className="space-sidebar-section">
            <div className="space-sidebar-section-header">Space Operations</div>
            <div className="space-operations-grid">
              <button
                className="space-operations-btn"
                onClick={handleGenerateSummary}
                disabled={isQuerying || isIndexing}
                title="Synthesize topics across the space into a structured summary note"
              >
                <Brain size={13} />
                <span>Generate Summary</span>
              </button>
              <button
                className="space-operations-btn"
                onClick={handleFindInsights}
                disabled={isQuerying || isIndexing}
                title="Look for repeated ideas, gaps, and contradictions in space"
              >
                <Sparkles size={13} />
                <span>Find Insights</span>
              </button>
              <button
                className="space-operations-btn"
                onClick={handleOrganizeSpace}
                disabled={isQuerying || isIndexing}
                title="Suggest renames, mergers, and folder restructuring changes"
              >
                <Layers size={13} />
                <span>Organize Space</span>
              </button>
            </div>
          </div>

          {/* Conversations Explorer Session List */}
          <div className="space-sidebar-section fill-height">
            <div className="space-sidebar-section-header">
              <span>Conversations</span>
              <span className="space-sidebar-section-badge">{conversations.length}</span>
            </div>

            {conversations.length === 0 ? (
              <div className="space-sidebar-notes-empty">
                No chat sessions.
              </div>
            ) : (
              <div className="space-sidebar-conversations-list">
                {conversations.map((conv) => {
                  const isActive = activeConversationId === conv.id;
                  return (
                    <div
                      key={conv.id}
                      className={`space-sidebar-conv-item ${isActive ? "active" : ""}`}
                      onClick={() => selectConversation(conv.id)}
                    >
                      <MessageSquare size={13} className="space-conv-icon" />
                      {editingConvId === conv.id ? (
                        <input
                          type="text"
                          className="space-conv-rename-input"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => finishRename(conv.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") finishRename(conv.id);
                            if (e.key === "Escape") cancelRename();
                          }}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="space-conv-title" title={conv.title}>{conv.title}</span>
                      )}
                      <div className="space-conv-actions">
                        {editingConvId !== conv.id && (
                          <>
                            <button
                              className="space-conv-action-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                startRename(conv.id, conv.title);
                              }}
                              title="Rename conversation"
                            >
                              <Edit2 size={11} />
                            </button>
                            <button
                              className="space-conv-action-btn delete"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteConversation(conv.id);
                              }}
                              title="Delete conversation"
                            >
                              <Trash2 size={11} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Interactive AI Conversation Interface */}
        <div className="space-view-chat-container">
          {isIndexing && (
            <div className="space-view-indexing-indicator">
              <Loader2 size={12} className="spinner" />
              <span>AI Indexing Vault... ({indexProgress.done}/{indexProgress.total})</span>
            </div>
          )}
          
          <div className="space-chat-messages-scroll">
            {chatMessages.length > 0 && <div style={{ marginTop: "auto" }} />}
            {chatMessages.length === 0 && (
              <div className="space-chat-welcome">
                <div className="space-chat-welcome-glow" />
                <div className="space-chat-welcome-content">
                  <h2>Command your knowledge network</h2>
                  <p>Query the knowledge layer of {activeSpace?.title || "this space"} using semantic context retrieval.</p>
                  
                  {/* CENTRAL INPUT */}
                  <div className="space-chat-central-input-wrapper">
                    <div className="space-chat-input-wrapper">
                      {showMentionDropdown && filteredNotes.length > 0 && (
                        <div className="spaces-mention-dropdown">
                          {filteredNotes.map((note: any, index: number) => (
                            <div
                              key={note.path}
                              className={`spaces-mention-item ${index === mentionActiveIndex ? "active" : ""}`}
                              onClick={() => selectNote(note)}
                            >
                              <FileText size={12} className="mention-item-icon" />
                              <span className="mention-item-title">{note.title}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <textarea
                        ref={centralInputRef}
                        className="space-chat-input"
                        placeholder="Ask anything..."
                        value={chatInput}
                        onChange={(e) => {
                          setChatInput(e.target.value);
                          checkForMention(e.target.value, e.target.selectionStart);
                        }}
                        onSelect={(e: any) => {
                          checkForMention(e.target.value, e.target.selectionStart);
                        }}
                        onKeyDown={handleChatKeyDown}
                        rows={1}
                        disabled={isQuerying}
                      />
                      <div className="space-chat-input-actions" style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                        {inputTokens > 0 && (
                          <span className="space-chat-token-counter" style={{ fontSize: "10px", color: "var(--text-muted)", opacity: 0.8 }}>
                            {inputTokens} tokens
                          </span>
                        )}
                        <button
                          className={`space-chat-send ${isQuerying ? "aborting" : ""}`}
                          onClick={() => {
                            if (isQuerying) {
                              handleAbortChat();
                            } else {
                              handleChat();
                            }
                          }}
                          disabled={!isQuerying && !chatInput.trim()}
                          title={isQuerying ? "Stop generating" : "Send message"}
                        >
                          {isQuerying ? <Square size={12} fill="currentColor" /> : <ArrowUp size={14} />}
                        </button>
                      </div>
                    </div>
                    {!isAIConfigured() && (
                      <div className="space-chat-no-ai-warning">
                        Configure an API key in AI Settings to enable chat queries over vector layers.
                      </div>
                    )}
                  </div>

                  <div className="space-chat-welcome-suggestions">
                    <div className="space-chat-suggestions-grid">
                      {SUGGESTED_QUERIES.map((q) => (
                        <button key={q} className="space-chat-suggestion" onClick={() => handleChat(q)}>
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Conversation Flow */}
            {chatMessages.map((msg) => (
              <div key={msg.id} className={`space-chat-message ${msg.role}`}>
                {msg.role === "user" ? (
                  <div className="message-bubble">
                    <div className="message-content">{msg.content}</div>
                  </div>
                ) : (
                  <>
                    {stripJSONBlock(msg.content) && (
                      <div className="message-content">
                        <MarkdownPreview
                          content={stripJSONBlock(msg.content)}
                          onLinkClick={(link) => onOpenNote?.(`${link}.md`)}
                        />
                      </div>
                    )}

                    {/* Render Interactive Action Cards if JSON action exists */}
                    {(() => {
                      const payload = parseActionPayload(msg.content);
                      if (!payload) return null;
                      
                      const isApplied = appliedActions[msg.id];
                      const isRejected = rejectedActions[msg.id];
                      
                      const intent = payload.intent || payload.action;
                      const summary = payload.summary || "AI proposed changes";
                      
                      if (isApplied) {
                        return (
                          <div className="space-action-card applied">
                            <div className="space-action-card-header">
                              <Check size={14} style={{ color: "var(--success)" }} />
                              <span>{summary}</span>
                              <span className="action-applied-badge">Applied</span>
                            </div>
                          </div>
                        );
                      }
                      
                      if (isRejected) {
                        return (
                          <div className="space-action-card rejected">
                            <div className="space-action-card-header">
                              <X size={14} style={{ color: "var(--error)" }} />
                              <span>{summary}</span>
                              <span className="action-rejected-badge">Rejected</span>
                            </div>
                          </div>
                        );
                      }

                      // Create Note flow
                      if (intent === "create_note" || (payload.actions && payload.actions.length === 1 && payload.actions[0].type === "create_note")) {
                        const action = payload.actions?.[0] || payload;
                        let displayPath = action.path || "";
                        if (displayPath.startsWith("/")) displayPath = displayPath.substring(1);
                        const displayTitle = action.title || "Untitled";
                        const notePath = displayPath + (displayPath ? (displayPath.endsWith("/") ? "" : "/") : "") + displayTitle + ".md";
                        
                        return (
                          <div className="space-action-card">
                            <div className="space-action-card-header">
                              <FileText size={14} />
                              <span>AI Plan: Create Note</span>
                            </div>
                            <div className="space-action-card-body">
                              <div className="space-action-details">
                                <div><strong>Create:</strong> {displayTitle}.md</div>
                                <div><strong>Location:</strong> {displayPath || "/"}</div>
                              </div>
                              <div className="space-action-buttons">
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => {
                                    setSidebarEditText(action.content || "");
                                    setRightSidebarMode("preview");
                                    setRightSidebarData({
                                      actionType: "create_note",
                                      title: displayTitle,
                                      path: notePath,
                                      content: action.content,
                                      msgId: msg.id
                                    });
                                  }}
                                >
                                  Preview
                                </button>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => {
                                    setSidebarEditText(action.content || "");
                                    setRightSidebarMode("edit");
                                    setRightSidebarData({
                                      actionType: "create_note",
                                      title: displayTitle,
                                      path: notePath,
                                      content: action.content,
                                      msgId: msg.id
                                    });
                                  }}
                                >
                                  Edit
                                </button>
                                <button
                                  className="btn btn-primary btn-sm"
                                  onClick={async () => {
                                    const ok = await handleApplySingleAction(action, msg.id);
                                    if (ok) setAppliedActions(prev => ({ ...prev, [msg.id]: true }));
                                  }}
                                >
                                  Confirm
                                </button>
                                <button
                                  className="btn btn-danger btn-sm"
                                  onClick={() => {
                                    setRejectedActions(prev => ({ ...prev, [msg.id]: true }));
                                    showToast("Action rejected.");
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      // Update Note flow
                      if (intent === "update_note" || (payload.actions && payload.actions.length === 1 && payload.actions[0].type === "update_note")) {
                        const action = payload.actions?.[0] || payload;
                        let filePath = action.file_path || action.path || "";
                        if (filePath.startsWith("/")) filePath = filePath.substring(1);
                        
                        const beforeContent = action.changes?.before || "";
                        const afterContent = action.changes?.after || action.content || "";
                        
                        return (
                          <div className="space-action-card">
                            <div className="space-action-card-header">
                              <RefreshCw size={14} />
                              <span>AI Plan: Update Note</span>
                            </div>
                            <div className="space-action-card-body">
                              <div className="space-action-details">
                                <div><strong>Update:</strong> {filePath}</div>
                              </div>
                              <div className="space-action-buttons">
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={async () => {
                                    const { before, after } = await resolveActionContent(action);
                                    setSidebarEditText(after);
                                    setRightSidebarMode("diff");
                                    setRightSidebarData({
                                      actionType: "update_note",
                                      path: filePath,
                                      before: before,
                                      after: after,
                                      msgId: msg.id
                                    });
                                  }}
                                >
                                  Preview Changes
                                </button>
                                <button
                                  className="btn btn-primary btn-sm"
                                  onClick={async () => {
                                    const ok = await handleApplySingleAction(action, msg.id);
                                    if (ok) setAppliedActions(prev => ({ ...prev, [msg.id]: true }));
                                  }}
                                >
                                  Apply Changes
                                </button>
                                <button
                                  className="btn btn-danger btn-sm"
                                  onClick={() => {
                                    setRejectedActions(prev => ({ ...prev, [msg.id]: true }));
                                    showToast("Changes rejected.");
                                  }}
                                >
                                  Reject
                                </button>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => {
                                    setSidebarEditText(afterContent);
                                    setRightSidebarMode("edit");
                                    setRightSidebarData({
                                      actionType: "update_note",
                                      path: filePath,
                                      before: beforeContent,
                                      after: afterContent,
                                      msgId: msg.id
                                    });
                                  }}
                                >
                                  Edit Before Apply
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      // Multi Action flow
                      if (intent === "multi_action" || (payload.actions && payload.actions.length > 1)) {
                        const actions = payload.actions || [];
                        
                        return (
                          <div className="space-action-card">
                            <div className="space-action-card-header">
                              <Layers size={14} />
                              <span>{actions.length} Actions Found</span>
                            </div>
                            <div className="space-action-card-body">
                              <div className="space-multi-action-list">
                                {actions.map((act: any, idx: number) => {
                                  const isActApplied = appliedActions[`${msg.id}-${idx}`];
                                  const title = act.title || act.file_path || act.path || "Action";
                                  const displayTitle = title.startsWith("/") ? title.substring(1) : title;
                                  
                                  return (
                                    <div key={idx} className="multi-action-item">
                                      <span className="action-num">{idx + 1}.</span>
                                      <span className="action-desc">
                                        {act.type === "create_note" ? "Create" : "Update"} <code>{displayTitle}</code>
                                      </span>
                                      {isActApplied ? (
                                        <span className="action-mini-applied">Applied</span>
                                      ) : (
                                        <button
                                          className="btn btn-secondary btn-xs"
                                          onClick={async () => {
                                            if (act.type === "create_note") {
                                              let displayPath = act.path || "";
                                              if (displayPath.startsWith("/")) displayPath = displayPath.substring(1);
                                              const displayTitle = act.title || "Untitled";
                                              const notePath = displayPath + (displayPath ? (displayPath.endsWith("/") ? "" : "/") : "") + displayTitle + ".md";
                                              setRightSidebarMode("preview");
                                              setRightSidebarData({
                                                actionType: "create_note",
                                                title: displayTitle,
                                                path: notePath,
                                                content: act.content,
                                                msgId: msg.id,
                                                actionIndex: idx
                                              });
                                            } else {
                                              let filePath = act.file_path || act.path || "";
                                              if (filePath.startsWith("/")) filePath = filePath.substring(1);
                                              const { before, after } = await resolveActionContent(act);
                                              setSidebarEditText(after);
                                              setRightSidebarMode("diff");
                                              setRightSidebarData({
                                                actionType: "update_note",
                                                path: filePath,
                                                before: before,
                                                after: after,
                                                msgId: msg.id,
                                                actionIndex: idx
                                              });
                                            }
                                          }}
                                        >
                                          Review
                                        </button>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="space-action-buttons">
                                <button
                                  className="btn btn-primary btn-sm"
                                  onClick={() => handleApplyAllActions(actions, msg.id)}
                                >
                                  Apply All
                                </button>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => {
                                    setRightSidebarMode("review_list");
                                    setRightSidebarData({
                                      actionType: "create_note",
                                      path: "",
                                      msgId: msg.id,
                                      actions: actions
                                    });
                                  }}
                                >
                                  Review Individually
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      // Fallback support for old restructuring, links, or insight report
                      switch (payload.action) {
                        case "suggest_structure":
                          return (
                            <div className="space-action-card">
                              <div className="space-action-card-header">
                                <Layers size={14} />
                                <span>Suggested Structure Restructuring</span>
                              </div>
                              <div className="space-action-card-body">
                                <div className="space-action-structure-list">
                                  {payload.changes?.map((change: any, index: number) => (
                                    <div key={index} className="structure-change-item">
                                      <div className="change-type-badge">{change.type.toUpperCase()}</div>
                                      {change.type === "merge" && (
                                        <div className="change-details">
                                          Merge <code>{change.notes.join(", ")}</code> into <strong>{change.target}</strong>
                                        </div>
                                      )}
                                      {change.type === "rename" && (
                                        <div className="change-details">
                                          Rename <code>{change.note}</code> to <code>{change.target}</code>
                                        </div>
                                      )}
                                      {change.type === "move" && (
                                        <div className="change-details">
                                          Move <code>{change.note}</code> to <code>{change.target}</code>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                                <button
                                  className="btn btn-primary btn-sm space-action-btn"
                                  onClick={() => handleApplyStructureAction(payload.changes, msg.id)}
                                >
                                  Apply Restructuring
                                </button>
                              </div>
                            </div>
                          );
                        case "suggest_links":
                          return (
                            <div className="space-action-card">
                              <div className="space-action-card-header">
                                <GitBranch size={14} />
                                <span>Suggested Wiki-Links</span>
                              </div>
                              <div className="space-action-card-body">
                                <table className="space-action-table">
                                  <thead>
                                    <tr>
                                      <th>From</th>
                                      <th>To</th>
                                      <th>Reason</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {payload.links?.map((link: any, index: number) => (
                                      <tr key={index}>
                                        <td><code>{link.from}</code></td>
                                        <td><code>{link.to}</code></td>
                                        <td>{link.reason}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                <button
                                  className="btn btn-primary btn-sm space-action-btn"
                                  onClick={() => handleInsertLinksAction(payload.links, msg.id)}
                                >
                                  Insert Links
                                </button>
                              </div>
                            </div>
                          );
                        case "insight_report":
                          return (
                            <div className="space-action-card">
                              <div className="space-action-card-header">
                                <Sparkles size={14} />
                                <span>Insight Report</span>
                              </div>
                              <div className="space-action-card-body">
                                <div className="space-action-insights">
                                  {payload.insights?.map((insight: any, index: number) => (
                                    <div key={index} className="insight-item">
                                      <div className="insight-type">Type: <strong>{insight.type}</strong></div>
                                      <div className="insight-desc">{insight.description}</div>
                                      {insight.notes && (
                                        <div className="insight-notes">Notes: {insight.notes.join(", ")}</div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                                <button
                                  className="btn btn-primary btn-sm space-action-btn"
                                  onClick={() => handleSaveInsightsAction(payload.insights, msg.id)}
                                >
                                  Save Insight Report to Vault
                                </button>
                              </div>
                            </div>
                          );
                        default:
                          return null;
                      }
                    })()}
                    
                    {(() => {
                      const payload = parseActionPayload(msg.content);
                      const sources = payload?.sources || msg.sources || [];
                      if (sources.length === 0) return null;
                      
                      return (
                        <div className="space-chat-sources">
                          <span className="space-chat-sources-label">Sources Used</span>
                          <div className="space-chat-sources-list">
                            {sources.map((s: any, i: number) => {
                              const isObject = typeof s === "object";
                              const noteTitle = isObject ? (s.note || s.noteTitle) : s;
                              const chunkText = isObject ? (s.chunk || s.chunkText) : "";
                              
                              return (
                                <span
                                  key={i}
                                  className="space-chat-source-pill"
                                  onClick={() => handleOpenSource(noteTitle, chunkText)}
                                  title={chunkText ? `Excerpt: ${chunkText.substring(0, 100)}...` : `Open ${noteTitle}`}
                                >
                                  {noteTitle}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            ))}

            {/* Streaming Indicator */}
            {isQuerying && streamingText && (() => {
              const cleanedText = stripJSONBlock(streamingText);
              const lastUserMsg = [...chatMessages].reverse().find((m) => m.role === "user");
              const activeQuery = lastUserMsg?.content || "";
              const actionType = detectActionType(streamingText, activeQuery);
              
              return (
                <div className="space-chat-message assistant">
                  {cleanedText && (
                    <div className="message-content">
                      <MarkdownPreview
                        content={cleanedText}
                        onLinkClick={(link) => onOpenNote?.(`${link}.md`)}
                      />
                    </div>
                  )}
                  {actionType && (
                    <ActiveActionStatus
                      actionType={actionType}
                      isApplied={false}
                    />
                  )}
                </div>
              );
            })()}

            {/* AI thinking state loader */}
            {isQuerying && !streamingText && (
              <div className="space-chat-loading-indicator">
                <div className="flat-spinner" />
                <span>Synthesizing response...</span>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Sticky Anchored Query Drawer Input */}
          {chatMessages.length > 0 && (
            <div className="space-chat-input-panel">
              <div className="space-chat-input-wrapper">
                {estimatedHistoryTokens > 0 && (
                  <div className="space-chat-memory-badge">
                    Memory: ~{estimatedHistoryTokens} tokens
                  </div>
                )}
                {showMentionDropdown && filteredNotes.length > 0 && (
                  <div className="spaces-mention-dropdown">
                    {filteredNotes.map((note: any, index: number) => (
                      <div
                        key={note.path}
                        className={`spaces-mention-item ${index === mentionActiveIndex ? "active" : ""}`}
                        onClick={() => selectNote(note)}
                      >
                        <FileText size={12} className="mention-item-icon" />
                        <span className="mention-item-title">{note.title}</span>
                      </div>
                    ))}
                  </div>
                )}
                <textarea
                  ref={bottomInputRef}
                  className="space-chat-input"
                  placeholder="Ask anything..."
                  value={chatInput}
                  onChange={(e) => {
                    setChatInput(e.target.value);
                    checkForMention(e.target.value, e.target.selectionStart);
                  }}
                  onSelect={(e: any) => {
                    checkForMention(e.target.value, e.target.selectionStart);
                  }}
                  onKeyDown={handleChatKeyDown}
                  rows={1}
                  disabled={isQuerying}
                />
                <div className="space-chat-input-actions" style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                  {inputTokens > 0 && (
                    <span className="space-chat-token-counter" style={{ fontSize: "10px", color: "var(--text-muted)", opacity: 0.8 }}>
                      {inputTokens} tokens
                    </span>
                  )}
                  <button
                    className={`space-chat-send ${isQuerying ? "aborting" : ""}`}
                    onClick={() => {
                      if (isQuerying) {
                        handleAbortChat();
                      } else {
                        handleChat();
                      }
                    }}
                    disabled={!isQuerying && !chatInput.trim()}
                    title={isQuerying ? "Stop generating" : "Send message"}
                  >
                    {isQuerying ? <Square size={12} fill="currentColor" /> : <ArrowUp size={14} />}
                  </button>
                </div>
              </div>
              
              <div className="space-chat-footer-info">
                Spaces chat can make mistakes. Verify key details.
              </div>

              {!isAIConfigured() && (
                <div className="space-chat-no-ai-warning">
                  Configure an API key in AI Settings to enable chat queries over vector layers.
                </div>
              )}
            </div>
          )}
        </div>

        {rightSidebarMode && rightSidebarData && (
          <div className="space-view-right-sidebar">
            <div className="space-right-sidebar-header" style={{ flexDirection: "column", alignItems: "stretch", gap: "10px", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div className="space-right-sidebar-title">
                  {rightSidebarMode === "review_list" ? "Review Actions" : `Review: ${rightSidebarData.title || rightSidebarData.path || "Note"}`}
                </div>
                <button className="space-right-sidebar-close" onClick={() => setRightSidebarMode(null)}>
                  <X size={16} />
                </button>
              </div>

              {rightSidebarMode !== "review_list" && (
                <div className="space-right-sidebar-tabs">
                  <button
                    className={`space-sidebar-tab ${rightSidebarMode === "preview" ? "active" : ""}`}
                    onClick={() => setRightSidebarMode("preview")}
                  >
                    Preview
                  </button>
                  {rightSidebarData.actionType !== "create_note" && (
                    <button
                      className={`space-sidebar-tab ${rightSidebarMode === "diff" ? "active" : ""}`}
                      onClick={() => setRightSidebarMode("diff")}
                    >
                      Diff Changes
                    </button>
                  )}
                  <button
                    className={`space-sidebar-tab ${rightSidebarMode === "edit" ? "active" : ""}`}
                    onClick={() => setRightSidebarMode("edit")}
                  >
                    Edit Content
                  </button>
                </div>
              )}
            </div>

            <div className="space-right-sidebar-body">
              {rightSidebarMode === "preview" && (
                <div className="space-right-sidebar-preview">
                  <MarkdownPreview
                    content={sidebarEditText || ""}
                    onLinkClick={(link) => onOpenNote?.(`${link}.md`)}
                  />
                </div>
              )}

              {rightSidebarMode === "diff" && (
                <div className="space-right-sidebar-preview">
                  <MarkdownPreview
                    content={generateDiffMarkdown(rightSidebarData.before || "", sidebarEditText || "")}
                    onLinkClick={(link) => onOpenNote?.(`${link}.md`)}
                  />
                </div>
              )}

              {rightSidebarMode === "edit" && (
                <div className="space-right-sidebar-edit" style={{ display: "flex", flexDirection: "column", height: "100%", gap: "10px" }}>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                    Editing proposed content before committing to the vault. No emojis allowed.
                  </div>
                  <textarea
                    className="space-right-sidebar-textarea"
                    value={sidebarEditText}
                    onChange={(e) => setSidebarEditText(e.target.value)}
                    style={{
                      flex: 1,
                      width: "100%",
                      height: "100%",
                      minHeight: "200px",
                      fontFamily: "var(--font-monospace, monospace)",
                      fontSize: "12px",
                      color: "var(--text-primary)",
                      background: "var(--bg-primary)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "6px",
                      padding: "12px",
                      resize: "none",
                      outline: "none",
                      lineHeight: "1.5"
                    }}
                  />
                </div>
              )}

              {rightSidebarMode === "review_list" && rightSidebarData.actions && (
                <div className="space-right-sidebar-review-list">
                  <div className="space-sidebar-section-header">Pending Changes ({rightSidebarData.actions.filter((_, idx) => !appliedActions[`${rightSidebarData.msgId}-${idx}`]).length})</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "12px" }}>
                    {rightSidebarData.actions.map((act: any, idx: number) => {
                      const isActApplied = appliedActions[`${rightSidebarData.msgId}-${idx}`];
                      const title = act.title || act.file_path || act.path || "Action";
                      const displayTitle = title.startsWith("/") ? title.substring(1) : title;
                      
                      return (
                        <div key={idx} className="review-list-item" style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "10px",
                          background: "var(--bg-primary)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: "6px"
                        }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                            <span style={{ fontSize: "12px", fontWeight: 500 }}>
                              {act.type === "create_note" ? "Create Note" : "Update Note"}
                            </span>
                            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                              {displayTitle}
                            </span>
                          </div>
                          {isActApplied ? (
                            <span className="action-applied-badge">Applied</span>
                          ) : (
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => {
                                if (act.type === "create_note") {
                                  let displayPath = act.path || "";
                                  if (displayPath.startsWith("/")) displayPath = displayPath.substring(1);
                                  const displayTitle = act.title || "Untitled";
                                  const notePath = displayPath + (displayPath ? (displayPath.endsWith("/") ? "" : "/") : "") + displayTitle + ".md";
                                  setRightSidebarMode("preview");
                                  setRightSidebarData(prev => ({
                                    ...prev!,
                                    actionType: "create_note",
                                    title: displayTitle,
                                    path: notePath,
                                    content: act.content,
                                    actionIndex: idx
                                  }));
                                  setSidebarEditText(act.content || "");
                                } else {
                                  let filePath = act.file_path || act.path || "";
                                  if (filePath.startsWith("/")) filePath = filePath.substring(1);
                                  setRightSidebarMode("diff");
                                  setRightSidebarData(prev => ({
                                    ...prev!,
                                    actionType: "update_note",
                                    path: filePath,
                                    before: act.changes?.before || "",
                                    after: act.changes?.after || act.content || "",
                                    actionIndex: idx
                                  }));
                                  setSidebarEditText(act.changes?.after || act.content || "");
                                }
                              }}
                            >
                              Review
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="space-right-sidebar-footer" style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: "8px",
              borderTop: "1px solid var(--border-subtle)",
              paddingTop: "16px",
              marginTop: "auto",
              flexShrink: 0
            }}>
              {rightSidebarMode === "review_list" ? (
                <>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={async () => {
                      await handleApplyAllActions(rightSidebarData.actions || [], rightSidebarData.msgId);
                      setRightSidebarMode(null);
                    }}
                  >
                    Apply All
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setRightSidebarMode(null)}>
                    Close
                  </button>
                </>
              ) : (
                <>
                  {rightSidebarData.actionIndex !== undefined && (
                    <button 
                      className="btn btn-secondary btn-sm" 
                      onClick={() => {
                        setRightSidebarMode("review_list");
                        setRightSidebarData(prev => ({
                          ...prev!,
                          actionType: "create_note",
                          path: "",
                        }));
                      }}
                      style={{ marginRight: "auto" }}
                    >
                      Back to List
                    </button>
                  )}
                  
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => {
                      if (rightSidebarData.actionIndex !== undefined) {
                        setRightSidebarMode("review_list");
                        setRightSidebarData(prev => ({
                          ...prev!,
                          actionType: "create_note",
                          path: "",
                        }));
                      } else {
                        setRightSidebarMode(null);
                      }
                      showToast("Changes cancelled.");
                    }}
                  >
                    Cancel
                  </button>
                  
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={async () => {
                      const action = rightSidebarData.actionIndex !== undefined
                        ? rightSidebarData.actions?.[rightSidebarData.actionIndex]
                        : { 
                            type: rightSidebarData.actionType, 
                            title: rightSidebarData.title, 
                            path: rightSidebarData.path, 
                            content: rightSidebarData.content,
                            changes: { before: rightSidebarData.before, after: rightSidebarData.after }
                          };
                      
                      const actualAction = { 
                        ...action, 
                        content: sidebarEditText,
                        changes: { 
                          before: rightSidebarData.before || "", 
                          after: sidebarEditText 
                        } 
                      };
                      
                      const ok = await handleApplySingleAction(actualAction, rightSidebarData.msgId, rightSidebarData.actionIndex);
                      if (ok) {
                        if (rightSidebarData.actionIndex === undefined) {
                          setAppliedActions(prev => ({ ...prev, [rightSidebarData.msgId]: true }));
                          setRightSidebarMode(null);
                        } else {
                          const key = `${rightSidebarData.msgId}-${rightSidebarData.actionIndex}`;
                          setAppliedActions(prev => {
                            const updated = { ...prev, [key]: true };
                            const actions = rightSidebarData.actions || [];
                            const allApplied = actions.every((_, idx) => 
                              idx === rightSidebarData.actionIndex || updated[`${rightSidebarData.msgId}-${idx}`]
                            );
                            if (allApplied) {
                              updated[rightSidebarData.msgId] = true;
                            }
                            return updated;
                          });
                          
                          setRightSidebarMode("review_list");
                          setRightSidebarData(prev => ({
                            ...prev!,
                            actionType: "create_note",
                            path: "",
                          }));
                        }
                      }
                    }}
                  >
                    {rightSidebarData.actionType === "create_note" ? "Confirm & Create" : "Apply Changes"}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

      </div>

      {showChangePasswordModal && (
        <div className="modal-overlay" onClick={() => setShowChangePasswordModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h3>Change E2EE Password</h3>
              <button className="modal-close" onClick={() => setShowChangePasswordModal(false)}>
                <X size={15} />
              </button>
            </div>
            <form onSubmit={handleChangePasswordSubmit} style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="space-form-field">
                <label>Current Password</label>
                <input
                  type="password"
                  className="space-form-input"
                  placeholder="Enter current password..."
                  value={changePasswordCurrent}
                  onChange={(e) => setChangePasswordCurrent(e.target.value)}
                  required
                />
              </div>
              <div className="space-form-field">
                <label>New Password (Min 8 characters)</label>
                <input
                  type="password"
                  className="space-form-input"
                  placeholder="Enter new password..."
                  value={changePasswordNew}
                  onChange={(e) => setChangePasswordNew(e.target.value)}
                  required
                />
              </div>
              <div className="space-form-field">
                <label>Confirm New Password</label>
                <input
                  type="password"
                  className="space-form-input"
                  placeholder="Confirm new password..."
                  value={changePasswordConfirm}
                  onChange={(e) => setChangePasswordConfirm(e.target.value)}
                  required
                />
              </div>
              
              {changePasswordError && (
                <div style={{ fontSize: '12px', color: '#ef4444', fontWeight: 500 }}>
                  {changePasswordError}
                </div>
              )}

              <div className="space-form-actions" style={{ marginTop: 8 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowChangePasswordModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm">
                  Update Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => {
            setShowAuthModal(false);
            refreshSpaces();
          }}
          message={authMessage}
        />
      )}
    </div>
  );
}

export default SpacesPage;
