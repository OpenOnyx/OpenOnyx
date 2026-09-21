// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import {
  shouldHandleEvent,
  initGlobalKeybindings,
  setGlobalKeybindingsEnabled,
  setVimMode,
} from "../src/keybindings/globalKeys";

function keyEvent(target: Element): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

describe("global key handling", () => {
  beforeEach(() => {
    initGlobalKeybindings();
    setGlobalKeybindingsEnabled(true);
    setVimMode("normal");
  });

  it("ignores events with no target", () => {
    const event = new KeyboardEvent("keydown", { key: " " });
    expect(shouldHandleEvent(event)).toBe(false);
  });

  it("does not steal keys from inputs and textareas", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    document.body.append(input, textarea);
    expect(shouldHandleEvent(keyEvent(input))).toBe(false);
    expect(shouldHandleEvent(keyEvent(textarea))).toBe(false);
  });

  it("handles Space inside CodeMirror in normal mode", () => {
    const wrap = document.createElement("div");
    wrap.className = "cm-editor";
    const content = document.createElement("div");
    content.className = "cm-content";
    wrap.append(content);
    document.body.append(wrap);

    setVimMode("normal");
    const event = keyEvent(content);
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("allows Space inside CodeMirror in insert mode without preventing default", () => {
    const wrap = document.createElement("div");
    wrap.className = "cm-editor";
    const content = document.createElement("div");
    content.className = "cm-content";
    wrap.append(content);
    document.body.append(wrap);

    setVimMode("insert");
    const event = keyEvent(content);
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("handles keys on the document chrome", () => {
    const button = document.createElement("button");
    document.body.append(button);
    expect(shouldHandleEvent(keyEvent(button))).toBe(true);
  });
});
