import React, { useState, useEffect, useMemo } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { getAPI } from "../../utils/api";
import { getNoteName } from "../../utils/helpers";

const api = getAPI();

interface UnlinkedMention {
  path: string;
  name: string;
  line: number;
  context: string;
  matchStart: number;
  matchEnd: number;
}

interface UnlinkedMentionsPanelProps {
  currentNotePath: string | null;
  currentNoteName: string;
  visible: boolean;
  onNavigate: (path: string, line?: number) => void;
}

export function UnlinkedMentionsPanel({
  currentNotePath,
  currentNoteName,
  visible,
  onNavigate,
}: UnlinkedMentionsPanelProps) {
  const [mentions, setMentions] = useState<UnlinkedMention[]>([]);
  const [loading, setLoading] = useState(false);
  const [panelExpanded, setPanelExpanded] = useState(false); // Collapsed by default to match screenshots
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Search for unlinked mentions when note changes
  useEffect(() => {
    if (!visible || !currentNoteName || currentNoteName.length < 2) {
      setMentions([]);
      return;
    }

    let active = true;
    const searchMentions = async () => {
      setLoading(true);
      try {
        const results = await api.search(currentNoteName);
        if (!active) return;

        const foundMentions: UnlinkedMention[] = [];

        for (const result of results) {
          if (result.path === currentNotePath) continue;

          const content = await api.readFile(result.path);
          if (!active) return;

          const lines = content.split("\n");
          const escapedName = currentNoteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const namePattern = new RegExp(
            `(?<!\\[\\[)\\b${escapedName}\\b(?!\\]\\])`,
            "gi"
          );

          lines.forEach((line, lineIndex) => {
            let match;
            while ((match = namePattern.exec(line)) !== null) {
              const beforeMatch = line.substring(0, match.index);
              const afterMatch = line.substring(match.index + match[0].length);

              if (beforeMatch.includes("[[") && !beforeMatch.includes("]]"))
                continue;
              if (afterMatch.includes("]]") && !afterMatch.includes("[["))
                continue;

              const contextStart = Math.max(0, match.index - 30);
              const contextEnd = Math.min(
                line.length,
                match.index + match[0].length + 30
              );
              const contextText = line.substring(contextStart, contextEnd);

              foundMentions.push({
                path: result.path,
                name: getNoteName(result.path),
                line: lineIndex + 1,
                context:
                  (contextStart > 0 ? "..." : "") +
                  contextText +
                  (contextEnd < line.length ? "..." : ""),
                matchStart:
                  match.index - contextStart + (contextStart > 0 ? 3 : 0),
                matchEnd:
                  match.index -
                  contextStart +
                  match[0].length +
                  (contextStart > 0 ? 3 : 0),
              });
            }
          });
        }

        if (active) {
          setMentions(foundMentions);
          setExpandedGroups(new Set(foundMentions.map((m) => m.path)));
        }
      } catch (err) {
        console.error("Error searching for unlinked mentions:", err);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void searchMentions();

    return () => {
      active = false;
    };
  }, [currentNotePath, currentNoteName, visible]);

  // Group by file
  const groupedMentions = useMemo(() => {
    const groups = new Map<string, UnlinkedMention[]>();
    mentions.forEach((m) => {
      if (!groups.has(m.path)) groups.set(m.path, []);
      groups.get(m.path)!.push(m);
    });
    return groups;
  }, [mentions]);

  if (!visible) return null;

  const toggleGroup = (path: string) => {
    const next = new Set(expandedGroups);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    setExpandedGroups(next);
  };

  return (
    <div className="flex flex-col bg-(--bg-secondary) select-none">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 cursor-pointer hover:bg-(--bg-hover) transition-colors duration-100"
        onClick={() => setPanelExpanded(!panelExpanded)}
      >
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-(--text-primary)">
          {panelExpanded ? (
            <ChevronDown size={14} className="text-(--text-muted) shrink-0" />
          ) : (
            <ChevronRight size={14} className="text-(--text-muted) shrink-0" />
          )}
          Unlinked mentions
        </span>
        <span className="text-[12px] text-(--text-muted)">
          {mentions.length > 0 ? mentions.length : 0}
        </span>
      </div>

      {/* Collapsible Content */}
      {panelExpanded && (
        <div className="flex flex-col pb-2">
          {loading ? (
            <div className="px-8 py-3 text-xs text-(--text-muted) italic">Searching...</div>
          ) : mentions.length === 0 ? (
            <div className="px-8 py-3 text-xs text-(--text-muted) italic">
              No unlinked mentions
            </div>
          ) : (
            Array.from(groupedMentions.entries()).map(([path, fileMentions]) => {
              const isExpanded = expandedGroups.has(path);
              return (
                <div key={path} className="flex flex-col">
                  {/* File group row */}
                  <div
                    className="flex items-center justify-between px-6 py-1.5 cursor-pointer hover:bg-(--bg-hover) transition-colors duration-100"
                    onClick={() => toggleGroup(path)}
                  >
                    <span className="flex items-center gap-1 text-[12.5px] font-medium text-(--text-primary) truncate">
                      {isExpanded ? (
                        <ChevronDown size={12} className="text-(--text-muted) shrink-0" />
                      ) : (
                        <ChevronRight size={12} className="text-(--text-muted) shrink-0" />
                      )}
                      {getNoteName(path)}
                    </span>
                    <span className="text-[11px] text-(--text-muted)">
                      {fileMentions.length}
                    </span>
                  </div>

                  {/* Snippets list */}
                  {isExpanded && (
                    <div className="flex flex-col pl-10 pr-4 pb-1">
                      {fileMentions.map((mention, i) => (
                        <button
                          key={i}
                          className="w-full text-[11px] text-(--text-muted) hover:text-(--text-primary) leading-normal py-0.5 border-none bg-transparent text-left cursor-pointer select-text truncate hover:bg-(--bg-hover) rounded px-1.5 transition-colors duration-100"
                          onClick={() => onNavigate(mention.path, mention.line)}
                          title={`Line ${mention.line}: ${mention.context}`}
                        >
                          {mention.context.substring(0, mention.matchStart)}
                          <mark className="bg-amber-500/20 text-amber-300 rounded-sm px-0.5">
                            {mention.context.substring(
                              mention.matchStart,
                              mention.matchEnd
                            )}
                          </mark>
                          {mention.context.substring(mention.matchEnd)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
