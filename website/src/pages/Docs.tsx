import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { DOC_GROUPS, DOC_PAGES, docBySlug, neighbors } from '../data/docs';
import { PRODUCT } from '../data/facts';
import { renderManual } from '../lib/manual';
import { usePageMeta } from '../lib/meta';

export function Docs({ serverHtml, serverSourceUrl }: { serverHtml?: string; serverSourceUrl?: string } = {}) {
  const { slug = 'start' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const page = docBySlug(slug);
  const { prev, next } = neighbors(page.slug);
  const [query, setQuery] = useState('');
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [active, setActive] = useState('');
  const [progress, setProgress] = useState(0);
  const [copyStatus, setCopyStatus] = useState('');
  const article = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const rendered = useMemo(() => renderManual(page.markdown), [page.markdown]);
  const html = useMemo(() => serverHtml ?? DOMPurify.sanitize(rendered.html), [rendered.html, serverHtml]);
  const visible = DOC_PAGES.filter(entry => `${entry.title} ${entry.group} ${entry.markdown}`.toLowerCase().includes(query.trim().toLowerCase()));
  const sourcePath = `docs/manual/${encodeURIComponent(page.filename)}`;
  usePageMeta(`${page.title} — OpenOnyx`, page.summary);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const typing = (event.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"]');
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault(); search.current?.focus();
      }
      if (event.key === 'Escape' && document.activeElement === search.current) { setQuery(''); search.current?.blur(); }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView({ behavior: 'instant' });
    else window.scrollTo({ top: 0, behavior: 'instant' });
  }, [page.slug, location.hash]);

  useEffect(() => {
    const node = article.current;
    if (!node) return;
    let frame = 0;
    const update = () => {
      const rect = node.getBoundingClientRect();
      const total = Math.max(1, rect.height - window.innerHeight + 100);
      setProgress(Math.min(100, Math.max(0, (100 - rect.top) / total * 100)));
      let current = rendered.headings[0]?.id ?? '';
      for (const heading of rendered.headings) {
        if ((document.getElementById(heading.id)?.getBoundingClientRect().top ?? Infinity) <= 160) current = heading.id;
      }
      setActive(current);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    update();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); };
  }, [rendered]);

  if (slug === 'features') return <Navigate to='/docs/reference' replace />;
  if (!DOC_PAGES.some(entry => entry.slug === slug)) return <Navigate to='/docs/start' replace />;

  return <div className='docs-reader'>
    <aside className='manual-sidebar' aria-label='Manual'>
      <div className='manual-brand'><Link to='/docs/start'>OpenOnyx <span>/ Manual</span></Link><a href={PRODUCT.releases} target='_blank' rel='noreferrer' title='View release history'>v{PRODUCT.version}</a></div>
      <label className='manual-search'><span className='sr-only'>Search the manual</span><input ref={search} type='search' value={query} onChange={event => setQuery(event.target.value)} placeholder='Search the manual…' /><kbd>/</kbd></label>
      <p className='sr-only' role='status'>{query ? `${visible.length} pages found` : ''}</p>
      <button type='button' className='manual-mobile-toggle' aria-expanded={navigationOpen || !!query} aria-controls='manual-navigation' onClick={() => setNavigationOpen(open => !open)}>{navigationOpen ? 'Hide pages' : 'Browse pages'}</button>
      <nav id='manual-navigation' className={navigationOpen || query ? 'is-expanded' : undefined} aria-label='Documentation'>
        {DOC_GROUPS.map(group => {
          const entries = visible.filter(entry => entry.group === group);
          return entries.length > 0 && <section key={group}><h2>{group}</h2>{entries.map(entry => <Link key={entry.slug} to={`/docs/${entry.slug}`} aria-current={entry.slug === page.slug ? 'page' : undefined}>{entry.title}</Link>)}</section>;
        })}
        {visible.length === 0 && <p className='manual-empty'>No pages match “{query}”. Try a feature name or a shorter phrase.</p>}
      </nav>
    </aside>
    <div className='manual-main'>
      <div className='manual-document'>
        <nav className='manual-breadcrumb' aria-label='Breadcrumb'><Link to='/docs/start'>Manual</Link><span aria-hidden='true'>/</span><span>{page.group}</span></nav>
        <article ref={article} className='manual-markdown markdown-preview' aria-label={page.title} onClick={async event => {
          const copyButton = (event.target as HTMLElement).closest('.manual-copy');
          if (copyButton) {
            const code = copyButton.closest('pre')?.querySelector('code')?.textContent ?? '';
            try { await navigator.clipboard.writeText(code); setCopyStatus('Code copied.'); }
            catch { setCopyStatus('Copy unavailable. Select the code to copy it.'); }
            return;
          }
          const anchor = (event.target as HTMLElement).closest('a');
          if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          const href = anchor.getAttribute('href');
          if (href?.startsWith('/docs/')) { event.preventDefault(); navigate(href); }
        }} dangerouslySetInnerHTML={{ __html: html }} />
        <p role='status' className='manual-copy-status'>{copyStatus}</p>
        <nav className='manual-pagination' aria-label='Previous and next pages'>
          {prev ? <Link to={`/docs/${prev.slug}`}><small>Previous</small>{prev.title}</Link> : <span />}
          {next && <Link to={`/docs/${next.slug}`}><small>Next</small>{next.title}</Link>}
        </nav>
      </div>
      <aside className='manual-rail' aria-label='Page navigation'>
        <div className='manual-progress'><span>{String(DOC_PAGES.indexOf(page) + 1).padStart(2, '0')} / {DOC_PAGES.length}</span><span>{Math.round(progress)}% read</span><progress max='100' value={progress} aria-label='Reading progress' /></div>
        <nav aria-label='On this page'><h2>On this page</h2>{rendered.headings.map(heading => <a key={heading.id} href={`#${heading.id}`} data-level={heading.level} aria-current={active === heading.id ? 'location' : undefined}>{heading.level === 1 ? 'Introduction' : heading.text}</a>)}</nav>
        <div className='manual-tools'><a href={serverSourceUrl ?? page.sourceUrl} download={page.filename}>Download Markdown</a><a href={`${PRODUCT.repo}/edit/main/${sourcePath}`} target='_blank' rel='noreferrer'>Edit this page</a><a href={`${PRODUCT.repo}/issues/new?title=${encodeURIComponent(`Docs: ${page.title}`)}`} target='_blank' rel='noreferrer'>Report an issue</a><a href={`${PRODUCT.repo}/blob/main/${sourcePath}`} target='_blank' rel='noreferrer'>View source</a></div>
      </aside>
    </div>
  </div>;
}
