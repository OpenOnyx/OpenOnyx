/**
 * Custom Modal Component
 *
 * Replaces native prompt() and confirm() which are not supported in Electron.
 * Provides a unified modal interface that works in both browser and Electron environments.
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
    // Focus input on mount for prompt type
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
    <div className="motion-dialog-backdrop" style={styles.overlay} onClick={handleCancel}>
      <div className="motion-dialog" style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 style={styles.title}>{title}</h2>
        <p style={styles.message}>{message}</p>

        {type === "prompt" && (
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            style={styles.input}
            autoFocus
          />
        )}

        <div style={styles.actions}>
          <button onClick={handleCancel} style={styles.cancelBtn}>
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            style={type === "confirm" ? styles.dangerBtn : styles.confirmBtn}
          >
            {type === "confirm" ? "Delete" : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modal: {
    backgroundColor: "var(--bg-secondary, #1e1e2e)",
    borderRadius: "8px",
    padding: "24px",
    minWidth: "300px",
    maxWidth: "400px",
    boxShadow: "none",
    border: "1px solid var(--border, #3e3e50)",
  },
  title: {
    margin: "0 0 16px 0",
    fontSize: "18px",
    color: "var(--text-primary, #ffffff)",
  },
  message: {
    margin: "0 0 20px 0",
    fontSize: "14px",
    color: "var(--text-secondary, #a0a0b0)",
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    marginBottom: "20px",
    borderRadius: "4px",
    border: "1px solid var(--border-medium, #3e3e50)",
    backgroundColor: "var(--bg-tertiary, #14141f)",
    color: "var(--text-primary, #ffffff)",
    fontSize: "14px",
    outline: "none",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px",
  },
  cancelBtn: {
    padding: "8px 16px",
    borderRadius: "4px",
    border: "none",
    backgroundColor: "var(--bg-secondary, #1e1e2e)",
    color: "var(--text-secondary, #a0a0b0)",
    cursor: "pointer",
    fontSize: "14px",
  },
  confirmBtn: {
    padding: "8px 16px",
    borderRadius: "4px",
    border: "none",
    backgroundColor: "var(--accent, #6c63ff)",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "14px",
  },
  dangerBtn: {
    padding: "8px 16px",
    borderRadius: "4px",
    border: "none",
    backgroundColor: "#ef4444",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "14px",
  },
};
