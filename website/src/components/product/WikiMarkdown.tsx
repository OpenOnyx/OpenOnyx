import { Fragment, type ReactNode } from "react";
import { noteByTitle } from "../../data/vault";

type Props = {
  source: string;
  onOpen: (id: string) => void;
};

function inline(text: string, onOpen: (id: string) => void): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]|`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("[[")) {
      const target = match[2].trim();
      const label = (match[3] || target).trim();
      const note = noteByTitle(target);
      if (note) {
        parts.push(
          <button key={key++} type="button" className="wiki" onClick={() => onOpen(note.id)}>
            {label}
          </button>,
        );
      } else {
        parts.push(
          <span key={key++} className="wiki is-missing">
            {label}
          </span>,
        );
      }
    } else if (token.startsWith("`")) {
      parts.push(<code key={key++}>{token.slice(1, -1)}</code>);
    } else {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function parseTable(rows: string[]) {
  const cells = rows
    .filter((row) => !/^\|?\s*:?-{3,}/.test(row.replace(/\|/g, "")))
    .map((row) =>
      row
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => cell.trim()),
    );
  if (cells.length === 0) return null;
  const [head, ...body] = cells;
  return { head, body };
}

export function WikiMarkdown({ source, onOpen }: Props) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push(
        <pre key={key++}>
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (line.trim().startsWith("|") && i + 1 < lines.length && /\|/.test(lines[i + 1])) {
      const rows = [line];
      i += 1;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(lines[i]);
        i += 1;
      }
      const table = parseTable(rows);
      if (table) {
        blocks.push(
          <table key={key++}>
            <thead>
              <tr>
                {table.head.map((cell) => (
                  <th key={cell}>{inline(cell, onOpen)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.body.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>{inline(cell, onOpen)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>,
        );
      }
      continue;
    }

    if (/^#{1,3} /.test(line)) {
      const level = line.match(/^#+/)![0].length;
      const Tag = (`h${level}` as "h1" | "h2" | "h3");
      blocks.push(<Tag key={key++}>{inline(line.replace(/^#{1,3} /, ""), onOpen)}</Tag>);
      i += 1;
      continue;
    }

    if (line.startsWith("> ")) {
      const buf = [line.slice(2)];
      i += 1;
      while (i < lines.length && lines[i].startsWith("> ")) {
        buf.push(lines[i].slice(2));
        i += 1;
      }
      blocks.push(<blockquote key={key++}>{inline(buf.join(" "), onOpen)}</blockquote>);
      continue;
    }

    if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(lines[i].replace(/^[-*] /, ""));
        i += 1;
      }
      blocks.push(
        <ul key={key++}>
          {items.map((item, idx) => {
            const todo = item.match(/^\[([ xX])\]\s+(.*)$/);
            if (todo) {
              return (
                <li key={idx} className="todo">
                  <span className={todo[1] !== " " ? "box is-on" : "box"} />
                  {inline(todo[2], onOpen)}
                </li>
              );
            }
            return <li key={idx}>{inline(item, onOpen)}</li>;
          })}
        </ul>,
      );
      continue;
    }

    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\. /, ""));
        i += 1;
      }
      blocks.push(
        <ol key={key++}>
          {items.map((item, idx) => (
            <li key={idx}>{inline(item, onOpen)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const buf = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^#{1,3} |^[-*] |^\d+\. |^> |^\||^```/.test(lines[i])) {
      buf.push(lines[i]);
      i += 1;
    }
    blocks.push(<p key={key++}>{inline(buf.join(" "), onOpen)}</p>);
  }

  return <Fragment>{blocks}</Fragment>;
}
