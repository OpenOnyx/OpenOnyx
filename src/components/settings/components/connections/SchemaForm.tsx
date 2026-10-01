import type { McpFormField } from "../../../../utils/mcpSchema";

interface SchemaFormProps {
  fields: McpFormField[];
  values: Record<string, string | boolean>;
  disabled?: boolean;
  onChange: (values: Record<string, string | boolean>) => void;
}

function valueForField(field: McpFormField, values: Record<string, string | boolean>): string | boolean {
  if (values[field.name] !== undefined) return values[field.name];
  if (field.type === "boolean") return Boolean(field.defaultValue);
  if (Array.isArray(field.defaultValue)) return field.defaultValue.join("\n");
  return field.defaultValue === undefined ? "" : String(field.defaultValue);
}

export function SchemaForm({ fields, values, disabled, onChange }: SchemaFormProps) {
  if (fields.length === 0) {
    return <p className="text-[12px] text-[var(--text-muted)]">This tool does not require inputs.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {fields.map((field) => {
        const value = valueForField(field, values);
        const update = (next: string | boolean) => onChange({ ...values, [field.name]: next });
        const label = `${field.label}${field.required ? " *" : ""}`;
        const describedBy = field.description ? `tool-input-${field.name}-help` : undefined;

        return (
          <label key={field.name} className="flex flex-col gap-1.5 text-[12px] text-[var(--text-secondary)]">
            <span className="font-semibold text-[var(--text-primary)]">{label}</span>
            {field.type === "boolean" ? (
              <span className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={value === true}
                  disabled={disabled}
                  onChange={(event) => update(event.target.checked)}
                  className="h-4 w-4 rounded border border-[var(--border-medium)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
                />
                <span className="text-[11px] text-[var(--text-muted)]">{value === true ? "Enabled" : "Disabled"}</span>
              </span>
            ) : field.type === "enum" ? (
              <select
                value={String(value ?? "")}
                disabled={disabled}
                aria-describedby={describedBy}
                onChange={(event) => update(event.target.value)}
                className="h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--border-medium)] focus:ring-2 focus:ring-[var(--accent-primary)]/30"
              >
                <option value="">Select</option>
                {field.enumValues?.map((enumValue) => (
                  <option key={String(enumValue)} value={String(enumValue)}>{String(enumValue)}</option>
                ))}
              </select>
            ) : field.type === "array" || field.multiline ? (
              <textarea
                value={String(value ?? "")}
                disabled={disabled}
                aria-describedby={describedBy}
                placeholder={field.type === "array" ? "One value per line" : undefined}
                onChange={(event) => update(event.target.value)}
                className="min-h-20 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--border-medium)] focus:ring-2 focus:ring-[var(--accent-primary)]/30"
              />
            ) : (
              <input
                type={field.type === "number" || field.type === "integer" ? "number" : "text"}
                min={field.minimum}
                max={field.maximum}
                value={String(value ?? "")}
                disabled={disabled}
                aria-describedby={describedBy}
                onChange={(event) => update(event.target.value)}
                className="h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--border-medium)] focus:ring-2 focus:ring-[var(--accent-primary)]/30"
              />
            )}
            {field.description && (
              <span id={describedBy} className="text-[11px] text-[var(--text-muted)]">{field.description}</span>
            )}
          </label>
        );
      })}
    </div>
  );
}
