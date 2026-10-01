import type { DiscoverableApp } from "../../../../utils/appRegistry";
import { DISCOVERABLE_APPS } from "../../../../utils/appRegistry";
import { AppIcon } from "./AppIcon";

interface AddConnectionDialogProps {
  onChoose: (appId: DiscoverableApp["id"]) => void;
  onCancel: () => void;
}

export function AddConnectionDialog({ onChoose, onCancel }: AddConnectionDialogProps) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-[var(--text-primary)]">Add app</h3>
          <p className="mt-1 text-[12px] text-[var(--text-muted)]">Choose a real MCP-backed app integration to configure.</p>
        </div>
        <button type="button" onClick={onCancel} className="rounded px-2 py-1 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)]">Cancel</button>
      </div>
      <div className="mt-4 divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
        {DISCOVERABLE_APPS.map((app) => (
          <button
            key={app.id}
            type="button"
            onClick={() => onChoose(app.id)}
            className="flex w-full items-center justify-between gap-4 py-4 text-left outline-none transition-colors hover:bg-[var(--bg-hover)] focus:bg-[var(--bg-hover)]"
          >
            <span className="flex min-w-0 items-center gap-3">
              <AppIcon icon={app.icon} />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-[var(--text-primary)]">{app.displayName}</span>
                <span className="mt-1 block text-[12px] text-[var(--text-muted)]">{app.description}</span>
              </span>
            </span>
            <span className="shrink-0 text-[12px] text-[var(--text-muted)]">{app.actionLabel} →</span>
          </button>
        ))}
      </div>
    </div>
  );
}
