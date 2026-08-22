import { type ReactNode } from "react";
import { noteByTitle } from "../../data/vault";

type Props = {
  source: string;
  onOpen: (id: string) => void;
};

function colorize(line: string, onOpen: (id: string) => void): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]|`[^`]+`|\*\*[^*]+\*\*|#{1,3}(?=\s)|-\s\[[ xX]\])/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(line))) {
    if (match.index > last) parts.push(line.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("[[")) {
      const target = match[2].trim();
      const label = token;
      const note = noteByTitle(target);
      parts.push(
        note ? (
          <button key={key++} type="button" className="src-wiki" onClick={() => onOpen(note.id)}>
            {label}
          </button>
        ) : (
          <span key={key++} className="src-wiki is-missing">
            {label}
          </span>
        ),
      );
    } else if (token.startsWith("`")) {
      parts.push(
        <span key={key++} className="src-code">
          {token}
        </span>,
      );
    } else if (token.startsWith("**")) {
      parts.push(
        <span key={key++} className="src-bold">
          {token}
        </span>,
      );
    } else if (token.startsWith("#")) {
      parts.push(
        <span key={key++} className="src-hash">
          {token}
        </span>,
      );
    } else {
      parts.push(
        <span key={key++} className="src-box">
          {token}
        </span>,
      );
    }
    last = match.index + token.length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

function kind(line: string) {
  if (/^#{1,3} /.test(line)) return "is-h";
  if (line.startsWith("> ")) return "is-q";
  if (line.startsWith("```")) return "is-fence";
  if (line.trim().startsWith("|")) return "is-table";
  return "";
}

export function SourceView({ source, onOpen }: Props) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  return (
    <div className="src" role="textbox" aria-readonly="true" aria-label="Markdown source">
      {lines.map((line, index) => (
        <div key={index} className={`src-line ${kind(line)}`.trim()}>
          <span className="src-n">{index + 1}</span>
          <span className="src-c">{line.length ? colorize(line, onOpen) : "\u00a0"}</span>
        </div>
      ))}
    </div>
  );
}
