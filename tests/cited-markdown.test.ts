// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { CitedMarkdownAnswer, renderCitedMarkdownHtml } from "../src/components/ai/CitedMarkdownAnswer";
import type { VaultCitation } from "../src/utils/vault-rag";

const citations: VaultCitation[] = [{
  id: 1,
  path: "Computer_Networks/DNS_and_HTTP/DNS_and_HTTP_Overview.md",
  title: "DNS and HTTP Overview",
  heading: "DNS lookup",
  startLine: 12,
  endLine: 20,
  excerpt: "A **DNS resolver** queries the hierarchy.\n\n- Root server\n- TLD server",
  score: 1,
}];

describe("cited Markdown answer rendering", () => {
  it("renders Markdown blocks in reading mode and preserves clickable citations", () => {
    const html = renderCitedMarkdownHtml(
      "## DNS resolution\n\n- Check the **browser cache** [1]\n- Query the resolver",
      citations,
      "citation-marker",
    );
    const container = document.createElement("div");
    container.innerHTML = html;

    expect(container.querySelector("h2")?.textContent).toBe("DNS resolution");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("strong")?.textContent).toBe("browser cache");
    const citation = container.querySelector("button[data-vault-citation='1']");
    expect(citation?.textContent).toBe("DNS and HTTP Overview");
    expect(citation?.getAttribute("title")).toContain("lines 12-20");
  });

  it("sanitizes HTML and does not convert citations inside code", () => {
    const html = renderCitedMarkdownHtml(
      "`lookup[1]`\n\n<script>alert('unsafe')</script>",
      citations,
      "citation-marker",
    );
    const container = document.createElement("div");
    container.innerHTML = html;

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("code")?.textContent).toBe("lookup[1]");
    expect(container.querySelector("button")).toBeNull();
  });

  it("shows a source preview on hover and opens the cited note on click", () => {
    vi.useFakeTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onOpenNote = vi.fn();

    act(() => {
      root.render(
        React.createElement(CitedMarkdownAnswer, {
          answer: "The resolver follows the DNS hierarchy [1].",
          citations,
          className: "answer",
          citationClassName: "citation-marker",
          onOpenNote,
        }),
      );
    });

    const citation = host.querySelector<HTMLButtonElement>("button.citation-marker");
    expect(citation).not.toBeNull();
    act(() => citation?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    const preview = host.querySelector("[role='tooltip']");
    expect(preview?.textContent).toContain("Quoted passage · lines 12–20");
    expect(preview?.textContent).toContain("A DNS resolver queries the hierarchy.");
    expect(preview?.querySelector("strong")?.textContent).toBe("DNS resolver");
    expect(preview?.querySelectorAll("li")).toHaveLength(2);
    expect(host.querySelector("button[aria-label='Copy response as Markdown']")).not.toBeNull();
    expect(preview?.className).toContain("pointer-events-auto");
    act(() => {
      citation?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: preview }));
      preview?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: citation }));
      vi.advanceTimersByTime(250);
    });
    expect(host.querySelector("[role='tooltip']")).not.toBeNull();
    act(() => citation?.click());
    expect(onOpenNote).toHaveBeenCalledWith(citations[0].path);

    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });
});
