import { Children, cloneElement, isValidElement, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { DOC_GROUPS, DOC_PAGES, docBySlug, neighbors } from "../data/docs";
import { PRODUCT } from "../data/facts";
import { usePageMeta } from "../lib/meta";

function flattenText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (isValidElement(node)) return flattenText((node.props as { children?: ReactNode }).children);
  return "";
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function collectHeadings(node: ReactNode, out: Array<{ id: string; text: string }> = []) {
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as { children?: ReactNode };
    if (child.type === "h2") {
      const text = flattenText(props.children);
      if (text) out.push({ id: slugify(text), text });
    }
    collectHeadings(props.children, out);
  });
  return out;
}

function withHeadingIds(node: ReactNode): ReactNode {
  return Children.map(node, (child) => {
    if (!isValidElement(child)) return child;
    const props = child.props as { children?: ReactNode };
    if (child.type === "h2") {
      const text = flattenText(props.children);
      return <h2 id={slugify(text)}>{props.children}</h2>;
    }
    const kids = props.children;
    if (kids) {
      return cloneElement(child, undefined, withHeadingIds(kids));
    }
    return child;
  });
}

export function Docs() {
  const { slug = "start" } = useParams();
  const [filter, setFilter] = useState("");
  const known = DOC_PAGES.some((entry) => entry.slug === slug);
  const page = docBySlug(known ? slug : "start");
  const { prev, next } = neighbors(page.slug);
  const q = filter.trim().toLowerCase();
  const visible = useMemo(
    () =>
      DOC_PAGES.filter(
        (entry) =>
          !q ||
          entry.title.toLowerCase().includes(q) ||
          entry.summary.toLowerCase().includes(q) ||
          entry.group.toLowerCase().includes(q),
      ),
    [q],
  );
  const toc = useMemo(() => collectHeadings(page.body), [page.body]);
  const [activeHeading, setActiveHeading] = useState("");
  usePageMeta(`${page.title} — OpenOnyx Docs`, page.summary);

  useEffect(() => {
    const nodes = toc
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (nodes.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) setActiveHeading(visible.target.id);
      },
      { rootMargin: "-20% 0px -65% 0px", threshold: [0, 0.25, 0.6] },
    );
    nodes.forEach((node) => io.observe(node));
    return () => io.disconnect();
  }, [toc, page.slug]);

  if (!known) {
    return <Navigate to="/docs/start" replace />;
  }

  return (
    <div className="docs">
      <aside className="docs-side">
        <input
          className="docs-filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter docs…"
          aria-label="Filter docs"
        />
        {DOC_GROUPS.map((group) => {
          const entries = visible.filter((entry) => entry.group === group);
          if (entries.length === 0) return null;
          return (
            <div key={group}>
              <h4>{group}</h4>
              {entries.map((entry) => (
                <Link
                  key={entry.slug}
                  to={`/docs/${entry.slug}`}
                  className={entry.slug === page.slug ? "active" : ""}
                >
                  {entry.title}
                </Link>
              ))}
            </div>
          );
        })}
      </aside>

      <div className="docs-main">
        <article className="docs-body" key={page.slug}>
          <div className="kicker">{page.group}</div>
          <h1>{page.title}</h1>
          <p className="docs-lede">{page.summary}</p>
          {withHeadingIds(page.body)}
          <div className="doc-nav">
            {prev ? <Link to={`/docs/${prev.slug}`}>← {prev.title}</Link> : <span />}
            {next ? <Link to={`/docs/${next.slug}`}>{next.title} →</Link> : <span />}
          </div>
        </article>

        <aside className="docs-rail">
          {toc.length > 0 && (
            <div>
              <h4>On this page</h4>
              {toc.map((item) => (
                <a key={item.id} href={`#${item.id}`} className={activeHeading === item.id ? "active" : ""}>
                  {item.text}
                </a>
              ))}
            </div>
          )}
          <div>
            <h4>Continue</h4>
            {next && <Link to={`/docs/${next.slug}`}>{next.title}</Link>}
            {prev && <Link to={`/docs/${prev.slug}`}>{prev.title}</Link>}
            <Link to="/download">Download</Link>
            <a href={PRODUCT.repo} target="_blank" rel="noreferrer">
              Source on GitHub
            </a>
          </div>
        </aside>
      </div>
    </div>
  );
}
