/**
 * Template System
 *
 * Handles template insertion and variable substitution.
 * Supports template variables like {{date}}, {{title}}, {{time}}.
 */

import React, { useState, useEffect } from "react";
import { FileText, Clock, Calendar, User, Hash } from "lucide-react";
import { getAPI } from "../../utils/api";

interface TemplateModalProps {
  onClose: () => void;
  onInsert: (content: string) => void;
  currentNoteName?: string;
  templatesFolder?: string;
  dateFormat?: string;
  timeFormat?: string;
}

interface Template {
  name: string;
  path: string;
  content: string;
}

// Template variable substitutions
function processTemplateVariables(
  content: string,
  noteName?: string,
  dateFormat = "YYYY-MM-DD",
  timeFormat = "HH:mm",
): string {
  const now = new Date();

  const variables: Record<string, string> = {
    // Date variables
    "{{date}}": formatDate(now, dateFormat),
    "{{date:YYYY-MM-DD}}": now.toISOString().split("T")[0],
    "{{date:DD-MM-YYYY}}": `${String(now.getDate()).padStart(2, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${now.getFullYear()}`,
    "{{date:MMMM D, YYYY}}": now.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),

    // Time variables
    "{{time}}": formatDate(now, timeFormat),
    "{{time:HH:mm}}": now.toTimeString().split(" ")[0].slice(0, 5),
    "{{time:HH:mm:ss}}": now.toTimeString().split(" ")[0],

    // Title/name
    "{{title}}": noteName || "Untitled",
    "{{name}}": noteName || "Untitled",

    // Day of week
    "{{day}}": now.toLocaleDateString("en-US", { weekday: "long" }),
    "{{weekday}}": now.toLocaleDateString("en-US", { weekday: "long" }),

    // ISO timestamp
    "{{timestamp}}": now.toISOString(),

    // Random ID
    "{{uuid}}": crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2),
  };

  let result = content;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(
      new RegExp(key.replace(/[{}]/g, "\\$&"), "g"),
      value,
    );
  }

  // Handle custom date formats: {{date:format}}
  result = result.replace(/\{\{date:([^}]+)\}\}/g, (match, format) => {
    return formatDate(now, format);
  });

  return result;
}

// Simple date formatter
function formatDate(date: Date, format: string): string {
  const tokens: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    YY: String(date.getFullYear()).slice(-2),
    MMMM: date.toLocaleDateString("en-US", { month: "long" }),
    MMM: date.toLocaleDateString("en-US", { month: "short" }),
    MM: String(date.getMonth() + 1).padStart(2, "0"),
    M: String(date.getMonth() + 1),
    DD: String(date.getDate()).padStart(2, "0"),
    D: String(date.getDate()),
    dddd: date.toLocaleDateString("en-US", { weekday: "long" }),
    ddd: date.toLocaleDateString("en-US", { weekday: "short" }),
    HH: String(date.getHours()).padStart(2, "0"),
    H: String(date.getHours()),
    mm: String(date.getMinutes()).padStart(2, "0"),
    m: String(date.getMinutes()),
    ss: String(date.getSeconds()).padStart(2, "0"),
    s: String(date.getSeconds()),
  };

  let result = format;
  // Sort by length descending to replace longer tokens first
  const sortedTokens = Object.keys(tokens).sort((a, b) => b.length - a.length);
  for (const token of sortedTokens) {
    result = result.replace(new RegExp(token, "g"), tokens[token]);
  }
  return result;
}

export function TemplateModal({
  onClose,
  onInsert,
  currentNoteName,
  templatesFolder = "templates",
  dateFormat = "YYYY-MM-DD",
  timeFormat = "HH:mm",
}: TemplateModalProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(
    null,
  );
  const [preview, setPreview] = useState("");

  useEffect(() => {
    const loadTemplates = async () => {
      try {
        const api = getAPI();
        const tree = await api.getFileTree();

        // Look for templates folder
        const findTemplates = (entries: any[], path = ""): Template[] => {
          const results: Template[] = [];
          for (const entry of entries) {
            if (entry.isDirectory) {
              if (entry.path.toLowerCase() === templatesFolder.trim().toLowerCase().replace(/^\/+|\/+$/g, "")) {
                // Found templates folder, load all .md files
                if (entry.children) {
                  for (const child of entry.children) {
                    if (!child.isDirectory && child.extension === ".md") {
                      results.push({
                        name: child.name.replace(".md", ""),
                        path: child.path,
                        content: "", // Will load on selection
                      });
                    }
                  }
                }
              } else if (entry.children) {
                results.push(...findTemplates(entry.children, entry.path));
              }
            }
          }
          return results;
        };

        const found = findTemplates(tree);
        setTemplates(found);
      } catch (err) {
        console.error("Failed to load templates:", err);
      } finally {
        setLoading(false);
      }
    };

    loadTemplates();
  }, [templatesFolder]);

  const handleSelectTemplate = async (template: Template) => {
    try {
      const api = getAPI();
      const content = await api.readFile(template.path);
      const processed = processTemplateVariables(content, currentNoteName, dateFormat, timeFormat);
      setSelectedTemplate({ ...template, content });
      setPreview(processed);
    } catch (err) {
      console.error("Failed to load template:", err);
    }
  };

  const handleInsert = () => {
    if (preview) {
      onInsert(preview);
      onClose();
    }
  };

  return (
    <div className="oo-host-modal-overlay fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 backdrop-blur-[2px]" onClick={onClose}>
      <div className="oo-host-modal w-full max-w-[640px] overflow-hidden rounded-xl border border-[var(--oo-border-medium,var(--border-medium))] bg-[var(--oo-surface-0,var(--bg-primary))] shadow-[0_20px_48px_rgba(0,0,0,0.4)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--oo-border-subtle,var(--border-subtle))] bg-[var(--oo-surface-1,var(--bg-secondary))] px-5 py-4">
          <h3 className="m-0 text-sm font-semibold text-[var(--oo-text-primary,var(--text-primary))]">Insert template</h3>
          <button className="flex cursor-pointer rounded-md border-none bg-transparent p-1 text-lg text-[var(--oo-text-muted,var(--text-muted))] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--oo-text-primary,var(--text-primary))]" onClick={onClose} aria-label="Close">
            {'\u00D7'}
          </button>
        </div>

        <div className="flex h-[360px]">
          <div className="w-[200px] border-r border-(--border-subtle) overflow-y-auto p-2">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-xs text-(--text-muted)">Loading templates...</div>
            ) : templates.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-center px-4">
                <FileText size={32} className="text-(--text-muted) opacity-30" />
                <p className="text-xs text-(--text-muted)">No templates found.</p>
                <small className="text-[11px] text-(--text-muted) leading-relaxed">
                  Create a "Templates" folder in your vault and add .md files.
                </small>
              </div>
            ) : (
              templates.map((template) => (
                <button
                  key={template.path}
                  className={`flex w-full cursor-pointer items-center gap-2 rounded-md border-none px-3 py-2 text-[13px] transition-colors duration-100 ${selectedTemplate?.path === template.path ? "bg-[var(--oo-accent-muted,var(--bg-active))] text-[var(--oo-text-primary,var(--text-primary))]" : "bg-transparent text-[var(--oo-text-secondary,var(--text-secondary))] hover:bg-[var(--bg-hover)]"}`}
                  onClick={() => handleSelectTemplate(template)}
                >
                  <FileText size={16} className="shrink-0 text-(--text-muted)" />
                  <span className="truncate">{template.name}</span>
                </button>
              ))
            )}
          </div>

          <div className="flex-1 flex flex-col overflow-hidden">
            {selectedTemplate ? (
              <>
                <div className="px-4 py-2 border-b border-(--border-subtle) text-[11px] font-semibold uppercase tracking-wider text-(--text-muted)">
                  <span>Preview</span>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  <pre className="text-xs text-(--text-secondary) whitespace-pre-wrap font-mono leading-relaxed m-0">{preview}</pre>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-(--text-muted)">
                Select a template to preview
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-(--border-subtle) bg-(--bg-secondary)">
          <div className="text-[11px] text-(--text-muted)">
            <strong>Variables:</strong> {"{{date}}"}, {"{{time}}"},{" "}
            {"{{title}}"}, {"{{day}}"}, {"{{timestamp}}"}
          </div>
          <div className="flex gap-2">
            <button className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded border border-(--border-subtle) bg-transparent text-(--text-primary) cursor-pointer transition-all duration-150 hover:bg-(--bg-active)" onClick={onClose}>
              Cancel
            </button>
            <button
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-(--accent-primary) text-(--text-on-accent) border border-(--accent-primary) cursor-pointer transition-all duration-150 hover:bg-(--accent-secondary) disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleInsert}
              disabled={!preview}
            >
              Insert
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Export the variable processor for use elsewhere
export { processTemplateVariables };
