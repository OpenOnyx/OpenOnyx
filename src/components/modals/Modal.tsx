/**
 * Host prompt/confirm modal (Electron-safe).
 * Onyx Studio chrome — not the plugin `.modal` bridge.
 */

import React, { useState, useEffect, useRef } from "react";

interface ModalProps {
  type: "prompt" | "confirm";
  title: string;
  message: string;
  defaultValue?: string;
  onClose: (result: string | boolean) => void;
}

export function Modal({
  type,
  title,
  message,
  defaultValue = "",
  onClose,
}: ModalProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (type === "prompt" && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [type]);

  const handleConfirm = () => {
    onClose(type === "confirm" ? true : value);
  };

  const handleCancel = () => {
    onClose(type === "confirm" ? false : "");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      handleCancel();
    } else if (e.key === "Enter" && type === "prompt") {
      handleConfirm();
    }
  };

  return (
    <div
      className="oo-host-modal-overlay fixed inset-0 z-[1000] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
      onClick={handleCancel}
    >
      <div
        className="oo-host-modal w-full max-w-[400px] min-w-[300px] rounded-xl border border-[var(--oo-border-medium,var(--border-medium))] bg-[var(--oo-surface-float,var(--bg-secondary))] p-6 text-[var(--oo-text-primary,var(--text-primary))] shadow-[0_20px_48px_rgba(0,0,0,0.4)]"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="m-0 mb-3 text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <p className="m-0 mb-5 text-sm leading-relaxed text-[var(--oo-text-secondary,var(--text-secondary))]">
          {message}
        </p>

        {type === "prompt" && (
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="mb-5 w-full rounded-md border border-[var(--oo-border-medium,var(--border-medium))] bg-[var(--oo-surface-3,var(--bg-tertiary))] px-3 py-2.5 text-sm text-[var(--oo-text-primary,var(--text-primary))] outline-none focus:border-[var(--oo-accent,var(--accent-primary))]"
            autoFocus
          />
        )}

        <div className="flex justify-end gap-2.5">
          <button
            type="button"
            onClick={handleCancel}
            className="cursor-pointer rounded-md border border-[var(--oo-border-medium,var(--border-medium))] bg-[var(--oo-surface-3,var(--bg-tertiary))] px-4 py-2 text-sm text-[var(--oo-text-secondary,var(--text-secondary))] hover:bg-[var(--bg-hover)] hover:text-[var(--oo-text-primary,var(--text-primary))]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className={
              type === "confirm"
                ? "cursor-pointer rounded-md border border-transparent bg-[var(--oo-danger,#ef4444)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                : "cursor-pointer rounded-md border border-transparent bg-[var(--oo-accent,var(--accent-primary))] px-4 py-2 text-sm font-medium text-[var(--oo-accent-on,var(--text-on-accent))] hover:bg-[var(--oo-accent-hover,var(--accent-secondary))]"
            }
          >
            {type === "confirm" ? "Delete" : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
