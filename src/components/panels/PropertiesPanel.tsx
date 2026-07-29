/**
 * Properties Panel - Frontmatter/Metadata Editor
 *
 * Displays and allows editing of YAML frontmatter properties.
 * Supports common property types: text, list, date, tags.
 */

import React, { useMemo, useState, useCallback } from "react";
import {
  Settings,
  Plus,
  Trash2,
  Calendar,
  Tag,
  FileText,
  List,
} from "lucide-react";

interface PropertiesPanelProps {
  content: string;
  onContentChange: (content: string) => void;
  visible: boolean;
}

interface Property {
  key: string;
  value: string | string[];
  type: "text" | "list" | "date" | "tags";
}

// Parse YAML frontmatter
function parseFrontmatter(content: string): {
  properties: Property[];
  bodyStart: number;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { properties: [], bodyStart: 0 };
  }

  const yaml = match[1];
  const bodyStart = match[0].length;
  const properties: Property[] = [];

  // Simple YAML parser for common cases
  const lines = yaml.split("\n");
  let currentKey = "";
  let currentList: string[] = [];
  let inList = false;

  for (const line of lines) {
    // List item
    if (inList && line.match(/^\s+-\s+(.+)/)) {
      const itemMatch = line.match(/^\s+-\s+(.+)/);
      if (itemMatch) {
        currentList.push(itemMatch[1].trim());
      }
      continue;
    }

    // If we were in a list, save it
    if (inList && currentKey) {
      properties.push({
        key: currentKey,
        value: currentList,
        type: currentKey === "tags" ? "tags" : "list",
      });
      inList = false;
      currentList = [];
    }

    // Key-value pair
    const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const value = kvMatch[2].trim();

      if (!value) {
        // Could be start of a list
        inList = true;
        currentList = [];
      } else if (value.startsWith("[") && value.endsWith("]")) {
        // Inline array
        const items = value
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""));
        properties.push({
          key: currentKey,
          value: items,
          type: currentKey === "tags" ? "tags" : "list",
        });
      } else {
        // Detect type
        let type: Property["type"] = "text";
        if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
          type = "date";
        }
        properties.push({
          key: currentKey,
          value: value.replace(/^["']|["']$/g, ""),
          type,
        });
      }
    }
  }

  // Handle trailing list
  if (inList && currentKey) {
    properties.push({
      key: currentKey,
      value: currentList,
      type: currentKey === "tags" ? "tags" : "list",
    });
  }

  return { properties, bodyStart };
}

// Serialize properties back to YAML frontmatter
function serializeFrontmatter(properties: Property[]): string {
  if (properties.length === 0) return "";

  let yaml = "---\n";
  for (const prop of properties) {
    if (Array.isArray(prop.value)) {
      if (prop.value.length === 0) {
        yaml += `${prop.key}: []\n`;
      } else if (
        prop.value.length <= 3 &&
        prop.value.every((v) => !v.includes(","))
      ) {
        // Inline array for short lists
        yaml += `${prop.key}: [${prop.value.join(", ")}]\n`;
      } else {
        // Multi-line list
        yaml += `${prop.key}:\n`;
        for (const item of prop.value) {
          yaml += `  - ${item}\n`;
        }
      }
    } else {
      yaml += `${prop.key}: ${prop.value}\n`;
    }
  }
  yaml += "---\n";
  return yaml;
}

export function PropertiesPanel({
  content,
  onContentChange,
  visible,
}: PropertiesPanelProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const [showAddProperty, setShowAddProperty] = useState(false);

  const { properties, bodyStart } = useMemo(
    () => parseFrontmatter(content),
    [content],
  );
  const body = content.slice(bodyStart);

  const updateProperty = useCallback(
    (key: string, value: string | string[]) => {
      const newProps = properties.map((p) =>
        p.key === key ? { ...p, value } : p,
      );
      const newFrontmatter = serializeFrontmatter(newProps);
      onContentChange(newFrontmatter + body);
    },
    [properties, body, onContentChange],
  );

  const deleteProperty = useCallback(
    (key: string) => {
      const newProps = properties.filter((p) => p.key !== key);
      const newFrontmatter = serializeFrontmatter(newProps);
      onContentChange(newFrontmatter + body);
    },
    [properties, body, onContentChange],
  );

  const addProperty = useCallback(
    (key: string, type: Property["type"]) => {
      if (!key.trim()) return;

      const newProp: Property = {
        key: key.trim(),
        value: type === "list" || type === "tags" ? [] : "",
        type,
      };
      const newProps = [...properties, newProp];
      const newFrontmatter = serializeFrontmatter(newProps);
      onContentChange(newFrontmatter + body);
      setNewKey("");
      setShowAddProperty(false);
    },
    [properties, body, onContentChange],
  );

  if (!visible) return null;

  return (
    <div className="border-b border-(--border-subtle) bg-(--bg-secondary)">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <Settings size={14} strokeWidth={2} className="text-(--text-muted)" />
        <span className="text-xs font-semibold uppercase tracking-wider text-(--text-muted) flex-1">Properties</span>
        <button
          className="bg-transparent border-none text-(--text-muted) cursor-pointer p-1 rounded hover:bg-(--bg-hover) hover:text-(--text-primary) transition-colors duration-150"
          onClick={() => setShowAddProperty(!showAddProperty)}
          title="Add property"
        >
          <Plus size={14} />
        </button>
      </div>

      {showAddProperty && (
        <div className="flex items-center gap-2 px-4 py-2 border-t border-(--border-subtle)">
          <input
            type="text"
            placeholder="Property name"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            className="flex-1 bg-(--bg-primary) border border-(--border-subtle) rounded px-2 py-1 text-xs text-(--text-primary) outline-none focus:border-(--border-strong)"
          />
          <div className="flex gap-1">
            <button className="bg-transparent border-none text-(--text-muted) cursor-pointer p-1 rounded hover:bg-(--bg-hover) hover:text-(--text-primary)" onClick={() => addProperty(newKey, "text")} title="Text">
              <FileText size={12} />
            </button>
            <button className="bg-transparent border-none text-(--text-muted) cursor-pointer p-1 rounded hover:bg-(--bg-hover) hover:text-(--text-primary)" onClick={() => addProperty(newKey, "date")} title="Date">
              <Calendar size={12} />
            </button>
            <button className="bg-transparent border-none text-(--text-muted) cursor-pointer p-1 rounded hover:bg-(--bg-hover) hover:text-(--text-primary)" onClick={() => addProperty(newKey, "list")} title="List">
              <List size={12} />
            </button>
            <button className="bg-transparent border-none text-(--text-muted) cursor-pointer p-1 rounded hover:bg-(--bg-hover) hover:text-(--text-primary)" onClick={() => addProperty(newKey, "tags")} title="Tags">
              <Tag size={12} />
            </button>
          </div>
        </div>
      )}

      <div className="px-4 pb-2">
        {properties.length === 0 ? (
          <div className="py-4 text-center text-xs text-(--text-muted) leading-relaxed">
            No properties on this note yet.
            <br />
            <small>Add YAML frontmatter to define properties.</small>
          </div>
        ) : (
          properties.map((prop) => (
            <div key={prop.key} className="flex items-start gap-2 py-1.5 border-b border-(--border-subtle) last:border-b-0">
              <div className="flex items-center gap-1.5 min-w-[80px] shrink-0 pt-1">
                {prop.type === "date" && (
                  <Calendar size={12} className="text-(--text-muted) opacity-60" />
                )}
                {prop.type === "tags" && (
                  <Tag size={12} className="text-(--text-muted) opacity-60" />
                )}
                {prop.type === "list" && (
                  <List size={12} className="text-(--text-muted) opacity-60" />
                )}
                {prop.type === "text" && (
                  <FileText size={12} className="text-(--text-muted) opacity-60" />
                )}
                <span className="text-[11px] font-medium text-(--text-secondary)">{prop.key}</span>
              </div>
              <div className="flex-1 min-w-0">
                {Array.isArray(prop.value) ? (
                  <div className="flex flex-wrap gap-1 items-center">
                    {prop.value.map((v, i) => (
                      <span key={i} className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-(--bg-active) text-(--text-secondary)">
                        {v}
                        <button
                          className="bg-transparent border-none text-(--text-muted) cursor-pointer p-0 text-[10px] leading-none hover:text-red-400"
                          onClick={() => {
                            const arr = prop.value as string[];
                            updateProperty(
                              prop.key,
                              arr.filter((_: string, j: number) => j !== i),
                            );
                          }}
                        >
                          {'\u00D7'}
                        </button>
                      </span>
                    ))}
                    <input
                      type="text"
                      className="bg-transparent border-none outline-none text-[11px] text-(--text-primary) w-16 placeholder:text-(--text-muted)"
                      placeholder="Add..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && e.currentTarget.value) {
                          updateProperty(prop.key, [
                            ...(prop.value as string[]),
                            e.currentTarget.value,
                          ]);
                          e.currentTarget.value = "";
                        }
                      }}
                    />
                  </div>
                ) : prop.type === "date" ? (
                  <input
                    type="date"
                    value={prop.value as string}
                    onChange={(e) => updateProperty(prop.key, e.target.value)}
                    className="bg-(--bg-primary) border border-(--border-subtle) rounded px-2 py-0.5 text-[11px] text-(--text-primary) outline-none focus:border-(--border-strong)"
                  />
                ) : (
                  <input
                    type="text"
                    value={prop.value as string}
                    onChange={(e) => updateProperty(prop.key, e.target.value)}
                    className="w-full bg-(--bg-primary) border border-(--border-subtle) rounded px-2 py-0.5 text-[11px] text-(--text-primary) outline-none focus:border-(--border-strong)"
                  />
                )}
              </div>
              <button
                className="bg-transparent border-none text-(--text-muted) cursor-pointer p-1 rounded opacity-0 hover:opacity-100 focus:opacity-100 hover:bg-red-500/10 hover:text-red-400 transition-all duration-150 shrink-0 mt-0.5"
                onClick={() => deleteProperty(prop.key)}
                title="Delete property"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
