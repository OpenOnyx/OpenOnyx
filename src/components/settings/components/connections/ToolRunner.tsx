import type { McpServerSnapshot, McpTool, ToolRunState } from "./types";
import { buildArgumentsFromForm, buildMcpFormModel, getInitialFormValues } from "../../../../utils/mcpSchema";
import { isToolEnabled, toolKey } from "./ui";
import { SchemaForm } from "./SchemaForm";
import { ToolResult } from "./ToolResult";

interface ToolRunnerProps {
  server: McpServerSnapshot;
  tool: McpTool;
  runState?: ToolRunState;
  onUpdateRun: (key: string, update: Partial<ToolRunState>) => void;
  onRun: (server: McpServerSnapshot, tool: McpTool, args: Record<string, unknown>) => Promise<void>;
}

function parseJsonObject(input: string): Record<string, unknown> {
  const parsed = JSON.parse(input);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Arguments must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export function ToolRunner({ server, tool, runState, onUpdateRun, onRun }: ToolRunnerProps) {
  const key = toolKey(server, tool.name);
  const model = buildMcpFormModel(tool.inputSchema);
  const current = runState ?? {
    input: "{}",
    formValues: model.supported ? getInitialFormValues(model.fields) : {},
  };
  const enabled = isToolEnabled(server, tool.name);
  const canRun = enabled && server.runtime.status === "connected";

  const update = (change: Partial<ToolRunState>) => onUpdateRun(key, change);

  const runWithForm = async () => {
    if (!model.supported) return;
    try {
      const values = current.formValues ?? getInitialFormValues(model.fields);
      const args = buildArgumentsFromForm(model.fields, values);
      await onRun(server, tool, args);
    } catch (error) {
      update({
        error: error instanceof Error ? error.message : "Tool inputs are invalid",
        result: undefined,
      });
    }
  };

  const runWithJson = async () => {
    try {
      await onRun(server, tool, parseJsonObject(current.input || "{}"));
    } catch (error) {
      update({
        error: error instanceof Error ? error.message : "Arguments must be valid JSON",
        result: undefined,
      });
    }
  };

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-2">
        <h4 className="text-[12px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Run tool</h4>
        <span className="text-[11px] text-[var(--text-muted)]">Always ask before running</span>
      </div>

      <div className="mt-4">
        {model.supported ? (
          <SchemaForm
            fields={model.fields}
            values={current.formValues ?? getInitialFormValues(model.fields)}
            disabled={current.running}
            onChange={(formValues) => update({ formValues, error: undefined })}
          />
        ) : (
          <p className="text-[12px] text-[var(--text-muted)]">{model.reason} Use Advanced input.</p>
        )}
      </div>

      {!enabled && <p className="mt-3 text-[11px] text-[var(--text-muted)]">Enable this tool before running it.</p>}
      {enabled && server.runtime.status !== "connected" && <p className="mt-3 text-[11px] text-[var(--text-muted)]">Connect the source before running this tool.</p>}
      {current.error && <p className="mt-3 text-xs text-red-500">{current.error}</p>}

      {model.supported && (
        <button
          type="button"
          disabled={current.running || !canRun}
          onClick={() => void runWithForm()}
          className="mt-4 h-8 rounded-md bg-[var(--text-primary)] px-4 text-xs font-bold text-[var(--bg-primary)] outline-none disabled:opacity-50 focus:ring-2 focus:ring-[var(--accent-primary)]/30"
        >
          {current.running ? "Running..." : "Run"}
        </button>
      )}

      <details className="mt-5 text-[12px] text-[var(--text-muted)]">
        <summary className="cursor-pointer font-semibold text-[var(--text-secondary)]">Advanced input</summary>
        <label className="mt-3 block text-[10px] font-bold uppercase tracking-wider" htmlFor={`mcp-tool-json-${key}`}>Edit JSON</label>
        <textarea
          id={`mcp-tool-json-${key}`}
          value={current.input}
          onChange={(event) => update({ input: event.target.value, error: undefined })}
          spellCheck={false}
          className="mt-2 min-h-20 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--border-medium)] focus:ring-2 focus:ring-[var(--accent-primary)]/30"
        />
        <button
          type="button"
          disabled={current.running || !canRun}
          onClick={() => void runWithJson()}
          className="mt-3 h-8 rounded-md border border-[var(--border-medium)] px-3 text-xs font-semibold text-[var(--text-primary)] outline-none disabled:opacity-50 focus:ring-2 focus:ring-[var(--accent-primary)]/30"
        >
          Run with JSON
        </button>
      </details>

      {current.result !== undefined && (
        <ToolResult
          result={current.result}
          rawVisible={Boolean(current.showRaw)}
          onToggleRaw={() => update({ showRaw: !current.showRaw })}
        />
      )}
    </div>
  );
}
