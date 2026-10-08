import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export function ResourceDialog({ title, onClose, children, className = "", headerActions }: { title: string; onClose: () => void; children: React.ReactNode; className?: string; headerActions?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    const targets = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || []);
    (dialog?.querySelector<HTMLElement>("input:not(:disabled), textarea:not(:disabled)") || targets()[0])?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
      if (event.key === "Tab") {
        const items = targets();
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    dialog?.addEventListener("keydown", keydown);
    return () => { dialog?.removeEventListener("keydown", keydown); previous?.focus(); };
  }, [onClose]);
  return createPortal(<div className="fixed inset-0 z-[10001] flex items-start justify-center bg-black/50 px-4 pt-[8vh]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`app-resource-dialog max-h-[84vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[var(--border-medium)] bg-[var(--bg-primary)] p-6 text-[var(--text-primary)] ${className}`}>
      <header className="mb-5 flex items-center justify-between gap-4"><h2 className="text-lg font-semibold">{title}</h2><div className="flex shrink-0 items-center gap-3">{headerActions}<button type="button" onClick={onClose} aria-label="Close" className="rounded px-2 py-1 text-[var(--text-muted)]">×</button></div></header>
      {children}
    </div>
  </div>, document.body);
}
