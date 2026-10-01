import type { McpServerSnapshot } from "./types";
import { humanizeDiagnostic, transportLabel } from "./ui";

interface DiagnosticsPanelProps {
  server: McpServerSnapshot;
  onRetry: () => void;
}

export function DiagnosticsPanel({ server, onRetry }: DiagnosticsPanelProps) {
  const diagnostic = server.runtime.lastError;
  const command = server.config.transport.transport === "stdio"
    ? `${server.config.transport.command} ${server.config.transport.args.join(" ")}`
    : server.config.transport.url;

  return (
    <details className="mt-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
      <summary className="cursor-pointer text-[12px] font-semibold text-[var(--text-primary)]">Diagnostics</summary>
      <div className="mt-3 grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-[11px]">
        <span className="text-[var(--text-muted)]">Summary</span>
        <span className="text-[var(--text-primary)]">{humanizeDiagnostic(diagnostic?.message)}</span>
        <span className="text-[var(--text-muted)]">Raw error</span>
        <span className="break-words font-mono text-[var(--text-primary)]">{diagnostic?.message || "None"}</span>
        <span className="text-[var(--text-muted)]">Operation</span>
        <span className="text-[var(--text-primary)]">{diagnostic?.operation || "None"}</span>
        <span className="text-[var(--text-muted)]">Transport</span>
        <span className="text-[var(--text-primary)]">{transportLabel(server)}</span>
        <span className="text-[var(--text-muted)]">Command</span>
        <span className="truncate font-mono text-[var(--text-primary)]" title={command}>{command}</span>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 h-7 rounded border border-[var(--border-medium)] px-3 text-[11px] font-semibold text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/30"
      >
        Retry
      </button>
    </details>
  );
}
