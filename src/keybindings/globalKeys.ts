type LeaderKey =
  | "f"
  | "g"
  | "c"
  | "n"
  | "d"
  | "b"
  | "s"
  | "/"
  | "p";

const LEADER_TIMEOUT_MS = 1000;

let initialized = false;
let enabled = true;
let leaderPending = false;
let leaderTimer: number | null = null;
let currentVimMode = "normal";

const LEADER_EVENT_MAP: Record<LeaderKey, string> = {
  f: "oo:fuzzy-search",
  g: "oo:open-graph",
  c: "oo:open-chat",
  n: "oo:new-note",
  d: "oo:daily-note",
  b: "oo:toggle-backlinks",
  s: "oo:split-view",
  "/": "oo:global-search",
  p: "oo:command-palette",
};

export function setVimMode(mode: string): void {
  currentVimMode = mode ? mode.toLowerCase() : "normal";
}

export function getVimMode(): string {
  return currentVimMode;
}

function handleVimModeChange(event: Event): void {
  const customEvent = event as CustomEvent<{ mode?: string }>;
  if (customEvent.detail?.mode) {
    setVimMode(customEvent.detail.mode);
  }
}

function clearLeaderState(): void {
  leaderPending = false;
  if (leaderTimer !== null) {
    window.clearTimeout(leaderTimer);
    leaderTimer = null;
  }
}

function dispatchOOEvent(name: string): void {
  window.dispatchEvent(new CustomEvent(name));
}

export function shouldHandleEvent(event: KeyboardEvent): boolean {
  const target = event.target as Element | null;
  if (!target) return false;

  const htmlElement = target as HTMLElement;
  const withinCodeMirror = !!htmlElement.closest(".cm-editor");
  if (withinCodeMirror) return true;

  const tagName = htmlElement.tagName;
  const isInput = tagName === "INPUT" || tagName === "TEXTAREA";
  const isContentEditable = htmlElement.isContentEditable;
  if (isInput || isContentEditable) return false;

  return true;
}

function onGlobalKeydown(event: KeyboardEvent): void {
  if (!enabled) return;
  if (!shouldHandleEvent(event)) return;

  const key = event.key;

  // Alt+t / Alt+Shift+t (Alt+T)
  if (event.altKey && !event.ctrlKey && !event.metaKey) {
    if (key.toLowerCase() === "t") {
      event.preventDefault();
      if (event.shiftKey) {
        dispatchOOEvent("oo:prev-tab");
      } else {
        dispatchOOEvent("oo:next-tab");
      }
      clearLeaderState();
      return;
    }
  }

  // Start leader sequence with Space
  if (
    key === " " &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  ) {
    const target = event.target as Element | null;
    const withinCodeMirror = !!(target as HTMLElement | null)?.closest(".cm-editor");
    if (withinCodeMirror && currentVimMode === "insert") {
      return;
    }

    event.preventDefault();
    leaderPending = true;
    if (leaderTimer !== null) {
      window.clearTimeout(leaderTimer);
    }
    leaderTimer = window.setTimeout(() => {
      clearLeaderState();
    }, LEADER_TIMEOUT_MS);
    return;
  }

  if (!leaderPending) return;

  // Ignore modifier-only follow-up keys during leader window
  if (["Shift", "Control", "Alt", "Meta"].includes(key)) {
    return;
  }

  const normalized = key.length === 1 ? key.toLowerCase() : key;
  if (normalized in LEADER_EVENT_MAP) {
    event.preventDefault();
    dispatchOOEvent(LEADER_EVENT_MAP[normalized as LeaderKey]);
  }

  clearLeaderState();
}

export function initGlobalKeybindings(): void {
  enabled = true;
  if (initialized) return;

  window.addEventListener("keydown", onGlobalKeydown);
  window.addEventListener("oo:vim-mode-change", handleVimModeChange);
  initialized = true;
}

export function setGlobalKeybindingsEnabled(nextEnabled: boolean): void {
  enabled = nextEnabled;
  if (!enabled) {
    clearLeaderState();
    setVimMode("normal");
  }
}
