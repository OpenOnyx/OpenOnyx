import React, { useEffect, useId, useRef, useState } from "react";
import type { ExternalResourceIdentity } from "../../utils/appRegistry";
import { ResourceDialog } from "./ResourceDialog";

export interface ResourceBrowser<Resource extends ExternalResourceIdentity> {
  name: string;
  searchHint?: string;
  searchPlaceholder?: string;
  filters: Array<{ id: string; label: string }>;
  recent: Resource[];
  search: (query: string, filter: string, scope?: string) => Promise<Resource[]>;
  matchesFilter: (resource: Resource, filter: string) => boolean;
  row: (resource: Resource) => { title: string; subtitle: string; icon: React.ReactNode };
  scope?: { label: string; searchFilter?: string; emptyHint?: string; value: (resource: Resource) => string };
  error: (error: unknown) => string;
}

export function ExternalResourcePicker<Resource extends ExternalResourceIdentity>({ browser, initialFilter = "everything", onClose, onSelect, connectionControl }: {
  browser: ResourceBrowser<Resource>; initialFilter?: string; connectionControl?: React.ReactNode; onClose: () => void; onSelect: (resource: Resource) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(initialFilter);
  const [scope, setScope] = useState("");
  const [choosingScope, setChoosingScope] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [results, setResults] = useState<Resource[]>([]);
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  const [searchedFilter, setSearchedFilter] = useState(initialFilter);
  const [selected, setSelected] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const request = useRef(0);
  const queryBeforeScope = useRef("");
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current++; }; }, []);
  const reset = () => { request.current++; setResults([]); setLastQuery(null); setSelected(-1); setError(""); };
  const currentFilter = choosingScope ? browser.scope!.searchFilter! : filter;
  const rows = (lastQuery !== null ? results : browser.recent).filter((resource) => (lastQuery !== null && !choosingScope && searchedFilter === currentFilter || browser.matchesFilter(resource, currentFilter))
    && (!scope || choosingScope || browser.scope?.value(resource) === scope)
    && (lastQuery !== null || `${browser.row(resource).title} ${browser.row(resource).subtitle}`.toLowerCase().includes(query.toLowerCase())));
  const choose = (resource: Resource) => {
    if (choosingScope && browser.scope) {
      setScope(browser.scope.value(resource)); setChoosingScope(false); setQuery(queryBeforeScope.current); reset(); searchRef.current?.focus();
    } else onSelect(resource);
  };
  const search = async () => {
    if (busy || !query.trim()) return;
    const attempt = ++request.current;
    setBusy(true); setError(""); setSelected(-1); setResults([]); setLastQuery(null);
    try {
      const found = await browser.search(query.trim(), currentFilter, choosingScope ? undefined : scope || undefined);
      if (alive.current && request.current === attempt) { setResults(found); setSearchedFilter(currentFilter); setLastQuery(query.trim()); setSelected(found.length ? 0 : -1); }
    } catch (failure) {
      if (alive.current && request.current === attempt) setError(browser.error(failure));
    } finally { if (alive.current) setBusy(false); }
  };
  const navigate = (direction: number) => {
    if (!rows.length || busy) return;
    const index = selected < 0 ? (direction > 0 ? 0 : rows.length - 1) : (selected + direction + rows.length) % rows.length;
    setSelected(index);
    document.getElementById(`${listId}-${index}`)?.scrollIntoView?.({ block: "nearest" });
  };
  const scopeOptions = [...new Set(browser.scope ? [...browser.recent, ...results].map(browser.scope.value) : [])];
  return <ResourceDialog title={browser.name} onClose={onClose} className="resource-browser">
    {connectionControl}
    <form onSubmit={(event) => { event.preventDefault(); if (selected >= 0 && rows[selected] && !busy) choose(rows[selected]); else void search(); }}>
      <div className="resource-browser-search">
        <span aria-hidden="true">⌕</span>
        <input ref={searchRef} autoFocus role="combobox" aria-label={`Search ${browser.name}`} aria-expanded={rows.length > 0}
          aria-controls={listId} aria-autocomplete="list" aria-activedescendant={selected >= 0 && rows[selected] ? `${listId}-${selected}` : undefined}
          value={query} readOnly={busy} placeholder={choosingScope ? `Find a ${browser.scope!.label.toLowerCase()}…` : browser.searchPlaceholder || `Search ${browser.name}…`}
          onChange={(event) => { setQuery(event.target.value); reset(); }} onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); navigate(event.key === "ArrowDown" ? 1 : -1); }
          }} />
        <button type="button" disabled={busy || !query.trim()} onClick={() => void search()} aria-label={`Search ${browser.name}`} title="Search (Enter)">↵</button>
      </div>
    </form>
    {!choosingScope && <div className="resource-browser-tabs" aria-label="Resource type">
      {browser.filters.map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} disabled={busy} onClick={() => { setFilter(item.id); setSelected(-1); setError(""); searchRef.current?.focus(); }}>{item.label}</button>)}
    </div>}
    {browser.scope && <div className="resource-browser-filters">
      <button type="button" disabled={busy} aria-expanded={filterOpen} onClick={() => setFilterOpen(!filterOpen)}>Filters</button>
      {scope && <button type="button" disabled={busy} onClick={() => { setScope(""); setSelected(-1); setError(""); }} aria-label={`Remove ${browser.scope.label.toLowerCase()} filter`}>{scope} ×</button>}
      {choosingScope && <button type="button" disabled={busy} onClick={() => { setChoosingScope(false); setQuery(queryBeforeScope.current); reset(); }}>Cancel filter selection</button>}
      {filterOpen && <div className="resource-browser-filter-menu">
        <p>{browser.scope.label}</p>
        {scopeOptions.map((value) => <button key={value} type="button" onClick={() => { setScope(value); setFilterOpen(false); setSelected(-1); setError(""); searchRef.current?.focus(); }}>{value}</button>)}
        {browser.scope.searchFilter ? <button type="button" onClick={() => { queryBeforeScope.current = query; setChoosingScope(true); setFilterOpen(false); setQuery(""); reset(); searchRef.current?.focus(); }}>Find {browser.scope.label.toLowerCase()}…</button> : !scopeOptions.length && <p>{browser.scope.emptyHint || "Choose a filter from your recent resources or search results."}</p>}
      </div>}
    </div>}
    <div className="resource-browser-results" aria-busy={busy}>
      {busy ? <div role="status" aria-label={`Searching ${browser.name}`} className="resource-browser-loading"><span className="sr-only">Searching {browser.name}…</span>{[0, 1, 2].map((row) => <div key={row} className="resource-browser-skeleton" aria-hidden="true"><span /><div><span /><span /></div></div>)}</div>
        : error ? <div role="alert" className="resource-browser-state"><p>{error}</p><button type="button" onClick={() => void search()}>Retry</button></div>
        : <>
          <p className="resource-browser-section">{choosingScope ? `Choose ${browser.scope!.label.toLowerCase()}` : lastQuery !== null ? "Results" : "Recent"}</p>
          <div id={listId} role="listbox" aria-label={`${browser.name} resources`}>
            {rows.map((resource, index) => { const row = browser.row(resource); return <button type="button" id={`${listId}-${index}`} key={resource.url || resource.externalId}
              role="option" aria-selected={selected === index} tabIndex={-1} className="resource-browser-row"
              onMouseMove={() => setSelected(index)} onClick={() => choose(resource)}>
              <span aria-hidden="true" className="resource-browser-icon">{row.icon}</span>
              <span className="resource-browser-row-content"><span>{row.title}</span><small>{row.subtitle}</small></span>
            </button>; })}
          </div>
          {!rows.length && <div className="resource-browser-state">
            <p>{lastQuery !== null ? `No ${browser.name} results for “${lastQuery}”` : choosingScope ? `Search for a ${browser.scope!.label.toLowerCase()} to narrow your results.` : `Find a ${browser.name} resource for your note.`}</p>
            <small>{lastQuery !== null ? "Try another search or change your filters." : browser.searchHint || "Enter a name, then press Enter to search."}</small>
            {scope && <button type="button" onClick={() => { setScope(""); setSelected(-1); setError(""); }}>Remove filter</button>}
          </div>}
        </>}
    </div>
    <footer className="resource-browser-footer"><span>↑ ↓ navigate · Enter {selected >= 0 ? "insert" : "search"}</span><span>Esc close</span></footer>
  </ResourceDialog>;
}
