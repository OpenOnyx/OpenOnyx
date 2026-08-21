// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { shouldHandleEvent } from "../src/keybindings/globalKeys";

function keyEvent(target: Element): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: " ", bubbles: true });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

describe("global key handling", () => {
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

  it("currently handles Space inside CodeMirror, including insert mode", () => {
    const wrap = document.createElement("div");
    wrap.className = "cm-editor";
    const content = document.createElement("div");
    content.className = "cm-content";
    wrap.append(content);
    document.body.append(wrap);
    expect(shouldHandleEvent(keyEvent(content))).toBe(true);
  });

  it("handles keys on the document chrome", () => {
    const button = document.createElement("button");
    document.body.append(button);
    expect(shouldHandleEvent(keyEvent(button))).toBe(true);
  });
});
