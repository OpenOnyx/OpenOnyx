import { describe, expect, it, vi } from "vitest";
import {
  countCharacters,
  countWords,
  debounce,
  formatFileSize,
  getNoteName,
  isDarkTheme,
  processTags,
  processWikiLinks,
} from "../src/utils/helpers";

describe("helpers", () => {
  it("strips folders and .md from note names", () => {
    expect(getNoteName("Folder/Sub/Note.md")).toBe("Note");
    expect(getNoteName("Note.md")).toBe("Note");
    expect(getNoteName("canvas.canvas")).toBe("canvas.canvas");
  });

  it("formats file sizes", () => {
    expect(formatFileSize(500)).toBe("500 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(2 * 1024 * 1024)).toBe("2.0 MB");
  });

  it("counts words and characters", () => {
    expect(countWords("  hello   world  ")).toBe(2);
    expect(countWords("")).toBe(0);
    expect(countCharacters("ab")).toBe(2);
  });

  it("wraps wiki links and tags for preview", () => {
    expect(processWikiLinks("See [[Other Note]]")).toContain('data-link="Other Note"');
    expect(processTags("hello #project")).toContain('data-tag="#project"');
  });

  it("classifies dark themes", () => {
    expect(isDarkTheme("dark")).toBe(true);
    expect(isDarkTheme("oceanic")).toBe(true);
    expect(isDarkTheme("light")).toBe(false);
    expect(isDarkTheme("custom", { customThemeType: "dark" })).toBe(true);
    expect(isDarkTheme("custom", { customThemeType: "light" })).toBe(false);
  });

  it("debounces repeated calls", async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced("a");
    debounced("b");
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("b");
    vi.useRealTimers();
  });
});
