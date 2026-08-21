/**
 * Command Palette
 *
 * VS Code-style command launcher with fuzzy filtering.
 * Provides quick access to all application commands.
 */

import React, { useState, useEffect, useRef, useMemo } from "react";
import { Command } from "../../types";
import { filterCommands } from "../../utils/commandFilter";

interface CommandPaletteProps {
  commands: Command[];
  onClose: () => void;
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filteredCommands = useMemo(
    () => filterCommands(commands, query),
    [query, commands],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredCommands[selectedIndex]) {
        filteredCommands[selectedIndex].action();
        onClose();
      }
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center pt-[15vh] z-[9999]" onClick={onClose}>
      <div className="w-full max-w-[520px] bg-(--bg-primary) border border-(--border-medium) rounded-xl shadow-none overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-(--border-subtle)">
          <span className="text-(--text-muted) text-lg shrink-0">{'\u2318'}</span>
          <input
            ref={inputRef}
            className="flex-1 bg-transparent border-none outline-none text-(--text-primary) text-base placeholder:text-(--text-muted)"
            type="text"
            placeholder="Type a command..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {filteredCommands.map((cmd, index) => (
            <button
              key={cmd.id}
              className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 border-none text-left cursor-pointer transition-colors duration-100 ${index === selectedIndex ? "bg-(--bg-active) text-(--text-primary)" : "bg-transparent text-(--text-primary) hover:bg-(--bg-hover)"}`}
              onClick={() => {
                cmd.action();
                onClose();
              }}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="text-[13px]">
                {cmd.category && (
                  <span className="text-(--text-muted) mr-2">
                    {cmd.category} {'\u203A'}
                  </span>
                )}
                {cmd.label}
              </span>
              {cmd.shortcut && (
                <span className="text-[11px] text-(--text-muted) font-mono px-1.5 py-0.5 rounded bg-(--bg-active) shrink-0">{cmd.shortcut}</span>
              )}
            </button>
          ))}

          {filteredCommands.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <div className="text-xs text-(--text-muted)">No commands found</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
