/**
 * Tab/file group create-edit modal — Onyx Studio host chrome.
 */

import React, { useState, useEffect, useRef } from "react";

export const GROUP_COLORS = [
  { name: "Amber", value: "#E8A84A" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Teal", value: "#06b6d4" },
  { name: "Green", value: "#22c55e" },
  { name: "Yellow", value: "#eab308" },
  { name: "Orange", value: "#f97316" },
  { name: "Red", value: "#ef4444" },
  { name: "Pink", value: "#ec4899" },
  { name: "Purple", value: "#8b5cf6" },
  { name: "Slate", value: "#64748b" },
];

interface GroupModalProps {
  title: string;
  initialName?: string;
  initialColor?: string;
  onClose: (result: { name: string; color: string } | null) => void;
}

export function GroupModal({
  title,
  initialName = "",
  initialColor = "#E8A84A",
  onClose,
}: GroupModalProps) {
  const [name, setName] = useState(initialName);
  const [selectedColor, setSelectedColor] = useState(initialColor);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const handleConfirm = () => {
    if (!name.trim()) return;
    onClose({ name: name.trim(), color: selectedColor });
  };

  const handleCancel = () => {
    onClose(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      handleCancel();
    } else if (e.key === "Enter" && name.trim()) {
      handleConfirm();
    }
  };

  return (
    <div
      className="oo-host-modal-overlay fixed inset-0 z-[1000] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
      onClick={handleCancel}
    >
      <div
        className="oo-host-modal flex w-[320px] flex-col rounded-xl border border-[var(--oo-border-medium,var(--border-medium))] bg-[var(--oo-surface-float,var(--bg-secondary))] p-6 text-[var(--oo-text-primary,var(--text-primary))] shadow-[0_20px_48px_rgba(0,0,0,0.4)]"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="m-0 mb-4 text-lg font-semibold tracking-tight">{title}</h2>

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-[var(--oo-text-muted,var(--text-secondary))]">
            Group name
          </label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            className="box-border w-full rounded-md border border-[var(--oo-border-medium,var(--border-medium))] bg-[var(--oo-surface-3,var(--bg-tertiary))] px-3 py-2.5 text-sm text-[var(--oo-text-primary,var(--text-primary))] outline-none focus:border-[var(--oo-accent,var(--accent-primary))]"
            placeholder="e.g. Research, Writing"
            autoFocus
          />
        </div>

        <div className="mb-5">
          <label className="mb-2 block text-xs font-medium text-[var(--oo-text-muted,var(--text-secondary))]">
            Group color
          </label>
          <div className="flex flex-wrap gap-2">
            {GROUP_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setSelectedColor(c.value)}
                className="h-7 w-7 cursor-pointer rounded-full border-2 p-0 transition-transform"
                style={{
                  backgroundColor: c.value,
                  borderColor:
                    selectedColor === c.value
                      ? "var(--oo-text-primary, #ffffff)"
                      : "transparent",
                  boxShadow:
                    selectedColor === c.value
                      ? "0 0 0 2px var(--oo-surface-float, var(--bg-secondary))"
                      : "none",
                  transform: selectedColor === c.value ? "scale(1.1)" : "scale(1)",
                }}
                title={c.name}
              />
            ))}
          </div>
        </div>

        <div className="mt-1 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={handleCancel}
            className="cursor-pointer rounded-md border border-[var(--oo-border-medium,var(--border-medium))] bg-[var(--oo-surface-3,var(--bg-tertiary))] px-4 py-2 text-sm text-[var(--oo-text-secondary,var(--text-secondary))] hover:bg-[var(--bg-hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!name.trim()}
            className="cursor-pointer rounded-md border border-transparent bg-[var(--oo-accent,var(--accent-primary))] px-4 py-2 text-sm font-medium text-[var(--oo-accent-on,var(--text-on-accent))] hover:bg-[var(--oo-accent-hover,var(--accent-secondary))] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
