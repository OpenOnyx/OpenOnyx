/**
 * Outline Pane - Document Structure Navigation
 *
 * Displays a hierarchical view of headings in the current note,
 * allowing quick navigation to any section.
 */

import React, { useMemo, useState, useEffect, useRef } from "react";
import { Search, ChevronDown, ChevronRight, ChevronsUpDown, ListCollapse } from "lucide-react";

interface Heading {
  level: number;
  text: string;
  line: number;
}

interface HeadingNode {
  id: string;
  level: number;
  text: string;
  line: number;
  children: HeadingNode[];
}

interface OutlinePaneProps {
  content: string;
  onHeadingClick: (line: number) => void;
  visible: boolean;
}

export function OutlinePane({
  content,
  onHeadingClick,
  visible,
}: OutlinePaneProps) {
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [activeLine, setActiveLine] = useState<number>(1);
  const activeElementRef = useRef<HTMLDivElement | null>(null);

  // Extract headings from markdown content
  const headings = useMemo(() => {
    if (!content) return [];

    const lines = content.split("\n");
    const result: Heading[] = [];

    lines.forEach((line, index) => {
      // Match ATX headings (# Heading)
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        result.push({
          level: match[1].length,
          text: match[2].replace(/[#*_`\[\]]/g, "").trim(),
          line: index + 1,
        });
      }
    });

    return result;
  }, [content]);

  // Build hierarchical tree from headings list
  const headingTree = useMemo(() => {
    const root: HeadingNode[] = [];
    const stack: HeadingNode[] = [];

    headings.forEach((h, index) => {
      const node: HeadingNode = {
        id: `${h.line}-${index}`,
        level: h.level,
        text: h.text,
        line: h.line,
        children: [],
      };

      // Pop from stack until we find a parent with a level strictly smaller than the current node's level
      while (stack.length > 0 && stack[stack.length - 1].level >= h.level) {
        stack.pop();
      }

      if (stack.length === 0) {
        root.push(node);
      } else {
        stack[stack.length - 1].children.push(node);
      }

      stack.push(node);
    });

    return root;
  }, [headings]);

  // Filter tree based on search query
  const filteredTree = useMemo(() => {
    if (!searchQuery) return headingTree;

    const filterNodes = (nodes: HeadingNode[]): HeadingNode[] => {
      const query = searchQuery.toLowerCase();
      return nodes
        .map((node) => {
          const childrenMatched = filterNodes(node.children);
          const nodeMatches = node.text.toLowerCase().includes(query);
          if (nodeMatches || childrenMatched.length > 0) {
            return {
              ...node,
              children: childrenMatched,
            };
          }
          return null;
        })
        .filter((n): n is HeadingNode => n !== null);
    };

    return filterNodes(headingTree);
  }, [headingTree, searchQuery]);

  // Synchronize cursor line with the active editor
  useEffect(() => {
    const app = (window as any).__oo_app;
    const activeEditor = app?.workspace?.activeEditor?.editor;
    if (activeEditor && typeof activeEditor.getCursor === "function") {
      try {
        const cursor = activeEditor.getCursor();
        if (cursor && typeof cursor.line === "number") {
          setActiveLine(cursor.line + 1);
        }
      } catch (err) {
        console.warn("Failed to get initial cursor line:", err);
      }
    }

    const handleCursorLine = (e: Event) => {
      const customEvent = e as CustomEvent<{ line: number; path: string }>;
      if (customEvent.detail && typeof customEvent.detail.line === "number") {
        setActiveLine(customEvent.detail.line);
      }
    };

    document.addEventListener("editor:cursor-line", handleCursorLine as EventListener);
    return () => {
      document.removeEventListener("editor:cursor-line", handleCursorLine as EventListener);
    };
  }, []);

  // Determine which heading is currently active based on editor cursor line
  const activeHeading = useMemo(() => {
    let active: Heading | null = null;
    for (const h of headings) {
      if (h.line <= activeLine) {
        active = h;
      } else {
        break;
      }
    }
    return active;
  }, [headings, activeLine]);

  const activeNodeId = useMemo(() => {
    if (!activeHeading) return null;
    const index = headings.findIndex(
      (h) => h.line === activeHeading.line && h.text === activeHeading.text
    );
    return index !== -1 ? `${activeHeading.line}-${index}` : null;
  }, [activeHeading, headings]);

  // Scroll active heading into view smoothly
  useEffect(() => {
    if (activeElementRef.current) {
      activeElementRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [activeNodeId]);

  // Collapse / Expand handlers
  const toggleCollapse = (nodeId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const getExpandableIds = (nodes: HeadingNode[]): string[] => {
    const ids: string[] = [];
    const traverse = (ns: HeadingNode[]) => {
      ns.forEach((n) => {
        if (n.children.length > 0) {
          ids.push(n.id);
          traverse(n.children);
        }
      });
    };
    traverse(nodes);
    return ids;
  };

  const handleCollapseAll = () => {
    const ids = getExpandableIds(headingTree);
    setCollapsedIds(new Set(ids));
  };

  const handleExpandAll = () => {
    setCollapsedIds(new Set());
  };

  if (!visible) return null;

  // Recursive Tree Node Renderer
  const renderTreeNode = (node: HeadingNode, activeId: string | null) => {
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsedIds.has(node.id);
    const isActive = activeId === node.id;

    return (
      <div key={node.id} className="flex flex-col">
        {/* Row Container */}
        <div
          ref={isActive ? activeElementRef : null}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer transition-colors duration-100 select-none group relative
            ${
              isActive
                ? "bg-[var(--oo-accent-muted,var(--bg-active))] font-medium text-[var(--oo-text-primary,var(--text-primary))]"
                : "text-[var(--oo-text-secondary,var(--text-secondary))] hover:bg-[var(--bg-hover)] hover:text-[var(--oo-text-primary,var(--text-primary))]"
            }`}
          onClick={() => {
            setActiveLine(node.line);
            onHeadingClick(node.line);
          }}
        >
          {/* Collapse/Expand Chevron */}
          <span
            className={`flex h-4 w-4 items-center justify-center rounded text-[var(--oo-text-muted,var(--text-muted))] transition-colors hover:bg-[var(--bg-hover)] group-hover:text-[var(--oo-text-secondary,var(--text-secondary))] ${
              hasChildren ? "cursor-pointer" : "pointer-events-none opacity-0"
            }`}
            onClick={(e) => {
              if (!hasChildren) return;
              e.stopPropagation();
              toggleCollapse(node.id);
            }}
          >
            {isCollapsed ? (
              <ChevronRight size={12} strokeWidth={2.5} />
            ) : (
              <ChevronDown size={12} strokeWidth={2.5} />
            )}
          </span>

          {/* Heading Text */}
          <span className="text-[13px] truncate flex-1 leading-normal">
            {node.text}
          </span>
        </div>

        {/* Children (Indented with a vertical guide line aligned with the parent chevron) */}
        {!isCollapsed && hasChildren && (
          <div className="ml-[7.5px] border-l border-neutral-700/30 dark:border-neutral-800/80 pl-[11.5px] flex flex-col gap-0.5 mt-0.5">
            {node.children.map((child) => renderTreeNode(child, activeId))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col bg-[var(--oo-surface-1,var(--bg-secondary))]">
      <div className="shrink-0 border-b border-[var(--oo-border-subtle,var(--border-subtle))] px-3 py-2">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--oo-text-muted,var(--text-muted))]">
          Outline
        </div>
        <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => {
            setShowSearch(!showSearch);
            if (showSearch) setSearchQuery("");
          }}
          className={`rounded p-1 text-[var(--oo-text-muted,var(--text-muted))] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--oo-text-primary,var(--text-primary))] ${
            showSearch ? "bg-[var(--bg-hover)] text-[var(--oo-text-primary,var(--text-primary))]" : ""
          }`}
          title="Search headings"
        >
          <Search size={16} strokeWidth={1.5} />
        </button>
        <button
          onClick={handleCollapseAll}
          className="rounded p-1 text-[var(--oo-text-muted,var(--text-muted))] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--oo-text-primary,var(--text-primary))]"
          title="Collapse all"
        >
          <ListCollapse size={16} strokeWidth={1.5} />
        </button>
        <button
          onClick={handleExpandAll}
          className="rounded p-1 text-[var(--oo-text-muted,var(--text-muted))] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--oo-text-primary,var(--text-primary))]"
          title="Expand all"
        >
          <ChevronsUpDown size={16} strokeWidth={1.5} />
        </button>
        </div>
      </div>

      {/* Dynamic Search Bar */}
      {showSearch && (
        <div className="shrink-0 border-b border-[var(--oo-border-subtle,var(--border-subtle))] px-3 py-1.5">
          <input
            type="text"
            placeholder="Filter headings…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-[var(--oo-border-subtle,var(--border-subtle))] bg-[var(--oo-surface-0,var(--bg-primary))] px-2.5 py-1 text-xs text-[var(--oo-text-primary,var(--text-primary))] outline-none transition-colors placeholder:text-[var(--oo-text-muted,var(--text-muted))] focus:border-[var(--oo-accent,var(--border-strong))]"
            autoFocus
          />
        </div>
      )}

      {/* Heading Tree Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {filteredTree.length === 0 ? (
          <div className="mx-2 my-2 rounded-lg border border-dashed border-[var(--oo-border-subtle,var(--border-subtle))] px-4 py-6 text-center text-xs text-[var(--oo-text-muted,var(--text-muted))]">
            {searchQuery ? "No headings match this filter" : "No headings in this note yet"}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {filteredTree.map((node) => renderTreeNode(node, activeNodeId))}
          </div>
        )}
      </div>
    </div>
  );
}
