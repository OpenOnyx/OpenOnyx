/**
 * Tag Pane - Browse and Filter by Tags
 *
 * Shows all tags in the vault with counts,
 * allows clicking to filter/search by tag.
 */

import React, { useState, useEffect } from "react";
import { Hash, ChevronRight, ChevronDown } from "lucide-react";
import { getAPI } from "../../utils/api";

interface TagPaneProps {
  visible: boolean;
  onTagClick: (tag: string) => void;
}

interface TagData {
  name: string;
  count: number;
  files: string[];
}

export function TagPane({ visible, onTagClick }: TagPaneProps) {
  const [tags, setTags] = useState<TagData[]>([]);
  const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadTags = async () => {
      try {
        const api = getAPI();
        const tagMap = await api.getAllTags();

        const tagList: TagData[] = Object.entries(tagMap).map(
          ([name, files]) => ({
            name,
            count: files.length,
            files,
          }),
        );

        // Sort by count descending, then alphabetically
        tagList.sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          return a.name.localeCompare(b.name);
        });

        setTags(tagList);
      } catch (err) {
        console.error("Failed to load tags:", err);
      } finally {
        setLoading(false);
      }
    };

    if (visible) {
      loadTags();
    }
  }, [visible]);

  const toggleExpand = (tagName: string) => {
    setExpandedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tagName)) {
        next.delete(tagName);
      } else {
        next.add(tagName);
      }
      return next;
    });
  };

  if (!visible) return null;

  return (
    <div className="flex flex-col h-full border-l border-(--border-subtle) bg-(--bg-secondary)">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-(--border-subtle)">
        <Hash size={14} strokeWidth={2} className="text-(--text-muted)" />
        <span className="text-xs font-semibold uppercase tracking-wider text-(--text-muted)">Tags</span>
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-(--bg-active) text-(--text-secondary) ml-auto">{tags.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="px-4 py-6 text-center text-xs text-(--text-muted)">Loading tags...</div>
        ) : tags.length === 0 ? (
          <div className="mx-3 my-2 rounded-lg border border-dashed border-[var(--oo-border-subtle,var(--border-subtle))] px-4 py-6 text-center text-xs text-[var(--oo-text-muted,var(--text-muted))]">No tags in this vault yet</div>
        ) : (
          tags.map((tag) => (
            <div key={tag.name}>
              <button
                className="w-full flex items-center gap-1.5 px-3 py-1.5 border-none bg-transparent text-left cursor-pointer transition-colors duration-100 hover:bg-(--bg-hover) text-(--text-secondary)"
                onClick={() => toggleExpand(tag.name)}
              >
                <span className="text-(--text-muted) shrink-0">
                  {expandedTags.has(tag.name) ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                </span>
                <Hash size={12} className="text-(--text-muted) shrink-0 opacity-60" />
                <span className="text-[12.5px] truncate flex-1">{tag.name}</span>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-(--bg-active) text-(--text-muted)">{tag.count}</span>
              </button>

              {expandedTags.has(tag.name) && (
                <div className="pl-8 pb-1">
                  {tag.files.map((file) => (
                    <button
                      key={file}
                      className="w-full text-left px-3 py-1 text-[11.5px] text-(--text-muted) bg-transparent border-none cursor-pointer truncate hover:text-(--text-primary) hover:bg-(--bg-hover) rounded transition-colors duration-100"
                      onClick={() => onTagClick(file)}
                    >
                      {file.replace(".md", "")}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
