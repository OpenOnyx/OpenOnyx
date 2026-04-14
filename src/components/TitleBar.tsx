/**
 * TitleBar - Custom window title bar
 *
 * Provides window controls (minimize, maximize, close) on non-macOS
 * platforms, along with the app branding.
 */

import React, { useState, useRef, useEffect } from "react";
import { Theme, Command } from "../types";
import { getAPI } from "../utils/api";
import { Search, Minus, Square, X as CloseIcon } from "lucide-react";

interface TitleBarProps {
  theme: Theme;
  onCommandPalette?: () => void;
  commands?: Command[];
}

export function TitleBar({
  theme,
  onCommandPalette,
  commands = [],
}: TitleBarProps) {
  const api = getAPI();
  const isMac = navigator.platform.includes("Mac");
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const categories = Array.from(
    new Set(commands.map((cmd) => cmd.category || "Other")),
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setActiveMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="titlebar">
      <div
        className="titlebar-left"
        style={{ display: "flex", alignItems: "center" }}
      >
        <div className="titlebar-title" style={{ marginRight: "16px" }}>
          OpenObsidian
        </div>

        {commands.length > 0 && (
          <div
            className="titlebar-menu"
            ref={menuRef}
            style={{ display: "flex", WebkitAppRegion: "no-drag" } as any}
          >
            {categories.map((category) => (
              <div key={category} style={{ position: "relative" }}>
                <button
                  className={`menu-btn ${activeMenu === category ? "active" : ""}`}
                  onClick={() =>
                    setActiveMenu(activeMenu === category ? null : category)
                  }
                  onMouseEnter={() => {
                    if (activeMenu && activeMenu !== category) {
                      setActiveMenu(category);
                    }
                  }}
                  style={{
                    background:
                      activeMenu === category
                        ? "var(--bg-active)"
                        : "transparent",
                    border: "none",
                    color: "var(--text-secondary)",
                    padding: "6px 10px",
                    fontSize: "13px",
                    cursor: "default",
                    borderRadius: "var(--radius-sm)",
                    fontFamily: "var(--font-sans)",
                  }}
                >
                  {category}
                </button>

                {activeMenu === category && (
                  <div
                    className="menu-dropdown"
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border-medium)",
                      borderRadius: "var(--radius-md)",
                      minWidth: "200px",
                      boxShadow: "var(--shadow-md)",
                      zIndex: 1000,
                      padding: "4px",
                    }}
                  >
                    {commands
                      .filter((cmd) => (cmd.category || "Other") === category)
                      .map((cmd) => (
                        <button
                          key={cmd.id}
                          className="menu-item"
                          onClick={() => {
                            cmd.action();
                            setActiveMenu(null);
                          }}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            width: "100%",
                            padding: "6px 12px",
                            border: "none",
                            background: "transparent",
                            color: "var(--text-primary)",
                            fontSize: "13px",
                            cursor: "pointer",
                            borderRadius: "var(--radius-sm)",
                            textAlign: "left",
                          }}
                          onMouseEnter={(e) =>
                            ((e.target as HTMLElement).style.background =
                              "var(--bg-hover)")
                          }
                          onMouseLeave={(e) =>
                            ((e.target as HTMLElement).style.background =
                              "transparent")
                          }
                        >
                          <span>{cmd.label}</span>
                          {cmd.shortcut && (
                            <span
                              style={{
                                color: "var(--text-muted)",
                                fontSize: "11px",
                              }}
                            >
                              {cmd.shortcut}
                            </span>
                          )}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="titlebar-center">
        {onCommandPalette && (
          <div className="titlebar-command" onClick={onCommandPalette}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Search size={14} />
              <span>Search or type a command...</span>
            </div>
            <div>
              <kbd>Ctrl</kbd> <kbd>P</kbd>
            </div>
          </div>
        )}
      </div>

      {!isMac && (
        <div className="titlebar-controls">
          <button
            className="titlebar-btn"
            onClick={() => api.minimizeWindow()}
            aria-label="Minimize"
          >
            <Minus size={14} />
          </button>
          <button
            className="titlebar-btn"
            onClick={() => api.maximizeWindow()}
            aria-label="Maximize"
          >
            <Square size={12} strokeWidth={1.9} />
          </button>
          <button
            className="titlebar-btn close"
            onClick={() => api.closeWindow()}
            aria-label="Close"
          >
            <CloseIcon size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
