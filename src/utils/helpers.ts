import { Theme } from "../types";

/**
 * Utility helpers for OpenOnyx
 */

/** Extract the display name from a file path (without extension) */
export function getNoteName(filePath: string): string {
  const name = filePath.split("/").pop() || filePath;
  return name.replace(/\.md$/, "");
}

/** Format file size for display */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Format date for display */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return date.toLocaleDateString();
}

/** Count words in text */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Count characters in text */
export function countCharacters(text: string): number {
  return text.length;
}

/** Debounce a function */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/** Generate a unique ID */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

/** Process wiki links in markdown for preview */
export function processWikiLinks(content: string): string {
  return content.replace(
    /\[\[([^\]]+)\]\]/g,
    '<span class="wiki-link" data-link="$1">$1</span>',
  );
}


/** Process tags in markdown for preview */
export function processTags(content: string): string {
  return content.replace(
    /(?:^|\s)(#[a-zA-Z][a-zA-Z0-9_-]*)/g,
    ' <span class="tag" data-tag="$1">$1</span>',
  );
}

/** Determine if a theme is a dark theme */
export function isDarkTheme(theme: string | Theme, settings?: any): boolean {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  
  if (theme === "custom") {
    return settings?.customThemeType === "dark";
  }

  const darkThemes = ["dark", "dark-plus", "blue-night", "oceanic", "ember-night", "aurora-grove"];
  return darkThemes.includes(theme as string);
}

/** Extract the vault name from a path */
export function vaultName(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() || path;
}
