import { renderMcpResult } from "../../../../utils/mcpSchema";

interface ToolResultProps {
  result: unknown;
  rawVisible: boolean;
  onToggleRaw: () => void;
}

function formatRaw(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

export function ToolResult({ result, rawVisible, onToggleRaw }: ToolResultProps) {
  const rendered = renderMcpResult(result);

  return (
    <div className="mt-5 border-t border-[var(--border-subtle)] pt-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Result</p>
      {rendered.kind === "list" && (
        <div className="mt-3">
          {rendered.title && <p className="mb-3 text-[12px] font-semibold text-[var(--text-primary)]">{rendered.title}</p>}
          <div className="divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
            {rendered.items?.map((item, index) => (
              <div key={`${item.title}-${index}`} className="py-3">
                <p className="break-words text-[13px] font-semibold text-[var(--text-primary)]">{item.title}</p>
                {item.description && <p className="mt-1 break-words text-[12px] text-[var(--text-secondary)]">{item.description}</p>}
                {item.meta && <p className="mt-1 text-[11px] text-[var(--text-muted)]">{item.meta}</p>}
                {item.url && <p className="mt-1 truncate font-mono text-[10px] text-[var(--text-muted)]">{item.url}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
      {rendered.kind === "table" && (
        <div className="mt-3 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-[12px]">
          {rendered.rows?.map(([label, value]) => (
            <div key={label} className="contents">
              <span className="text-[var(--text-muted)]">{label}</span>
              <span className="break-words text-[var(--text-primary)]">{value}</span>
            </div>
          ))}
        </div>
      )}
      {(rendered.kind === "text" || rendered.kind === "json") && (
        <p className="mt-3 whitespace-pre-wrap break-words text-[12px] text-[var(--text-primary)]">{rendered.text}</p>
      )}
      <button
        type="button"
        onClick={onToggleRaw}
        className="mt-3 rounded text-[11px] font-semibold text-[var(--text-secondary)] outline-none hover:text-[var(--text-primary)] focus:ring-2 focus:ring-[var(--accent-primary)]/30"
      >
        {rawVisible ? "Hide raw response" : "View raw response"}
      </button>
      {rawVisible && (
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3 font-mono text-[10px] text-[var(--text-primary)]">
          {formatRaw(result)}
        </pre>
      )}
    </div>
  );
}
