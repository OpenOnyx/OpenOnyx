/**
 * Command Palette
 *
 * VS Code-style command launcher with fuzzy filtering.
 * Provides quick access to all application commands.
 */

import React, { useState, useEffect, useRef, useMemo } from "react";
import { Command } from "../../types";

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

  const filteredCommands = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        (cmd.category && cmd.category.toLowerCase().includes(q)),
    );
  }, [query, commands]);

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
    <div className="oo-host-modal-overlay fixed inset-0 z-[9999] flex items-start justify-center bg-black/55 pt-[15vh] backdrop-blur-[2px]" onClick={onClose}>
      <div className="oo-command-palette w-full max-w-[520px] overflow-hidden rounded-xl border border-[var(--oo-border-medium,var(--border-medium))] bg-[var(--oo-surface-float,var(--bg-primary))] shadow-[0_20px_48px_rgba(0,0,0,0.4)]" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="flex items-center gap-3 border-b border-[var(--oo-border-subtle,var(--border-subtle))] px-4 py-3">
          <span className="shrink-0 text-lg text-[var(--oo-text-muted,var(--text-muted))]">{'\u2318'}</span>
          <input
            ref={inputRef}
            className="flex-1 border-none bg-transparent text-base text-[var(--oo-text-primary,var(--text-primary))] outline-none placeholder:text-[var(--oo-text-muted,var(--text-muted))]"
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
              className={`w-full flex items-center justify-between gap-3 border-none px-4 py-2.5 text-left cursor-pointer transition-colors duration-100 ${index === selectedIndex ? "bg-[var(--oo-accent-muted,var(--bg-active))] text-[var(--oo-text-primary,var(--text-primary))]" : "bg-transparent text-[var(--oo-text-primary,var(--text-primary))] hover:bg-[var(--bg-hover)]"}`}
              onClick={() => {
                cmd.action();
                onClose();
              }}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="text-[13px]">
                {cmd.category && (
                  <span className="mr-2 text-[var(--oo-text-muted,var(--text-muted))]">
                    {cmd.category} {'\u203A'}
                  </span>
                )}
                {cmd.label}
              </span>
              {cmd.shortcut && (
                <span className="shrink-0 rounded bg-[var(--oo-surface-3,var(--bg-active))] px-1.5 py-0.5 font-mono text-[11px] text-[var(--oo-text-muted,var(--text-muted))]">{cmd.shortcut}</span>
              )}
            </button>
          ))}

          {filteredCommands.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <div className="text-xs text-[var(--oo-text-muted,var(--text-muted))]">No commands found</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
