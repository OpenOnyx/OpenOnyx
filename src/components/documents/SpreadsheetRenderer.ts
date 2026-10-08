import { notifyResourceViewState, subscribeResourceViewState, type ResourceViewState } from './ResourceViewState';
import { createElement, ArrowUp, ArrowDown } from 'lucide';
import JSZip from 'jszip';

const color = (node: Element | null): string | undefined => {
  const rgb = node?.getAttribute('rgb'); return rgb && /^(?:[a-f\d]{6}|[a-f\d]{8})$/i.test(rgb) ? `#${rgb.slice(-6)}` : undefined;
};
export async function renderSpreadsheet(bytes: Uint8Array, state: ResourceViewState = {}) {
  const XLSX = await import('xlsx');
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files);
  const sizes = entries.map(entry => (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize || 0);
  if (entries.length > 4000 || sizes.some(size => size > 25 * 1024 * 1024) || sizes.reduce((sum, size) => sum + size, 0) > 80 * 1024 * 1024) throw new Error('Workbook too large');
  const workbook = XLSX.read(bytes, { type: 'array', cellFormula: true, cellHTML: false, cellNF: true, cellStyles: true, sheetRows: 501 });
  if (!workbook.SheetNames.length) throw new Error('No worksheets');
  const stylesXml = await zip.file('xl/styles.xml')?.async('text');
  const styles = stylesXml ? new DOMParser().parseFromString(stylesXml, 'application/xml') : null;
  const fonts = Array.from(styles?.querySelectorAll('fonts > font') || []), fills = Array.from(styles?.querySelectorAll('fills > fill') || []), formats = Array.from(styles?.querySelectorAll('cellXfs > xf') || []);
  const workbookXml = await zip.file('xl/workbook.xml')?.async('text');
  const relationshipsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('text');
  const workbookDocument = new DOMParser().parseFromString(workbookXml || '<workbook/>', 'application/xml');
  const relationshipsDocument = new DOMParser().parseFromString(relationshipsXml || '<Relationships/>', 'application/xml');
  const sheetPaths = Array.from(workbookDocument.querySelectorAll('sheet')).map(sheet => {
    const id = sheet.getAttribute('r:id');
    const rel = Array.from(relationshipsDocument.querySelectorAll('Relationship')).find(item => item.getAttribute('Id') === id);
    const target = rel?.getAttribute('Target') || '';
    return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  });
  const element = document.createElement('section'); element.className = 'file-preview-spreadsheet';
  const scroller = document.createElement('div'); scroller.className = 'file-preview-sheet-scroll'; scroller.tabIndex = 0;
  const tabs = document.createElement('div'); tabs.className = 'file-preview-sheet-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Worksheets');
  const note = document.createElement('small'); note.className = 'file-preview-sheet-limit';
  const search = document.createElement('div'); search.className = 'file-preview-sheet-search';
  const input = document.createElement('input'); input.type = 'search'; input.placeholder = 'Search sheet...'; input.setAttribute('aria-label', 'Search current sheet');
  const matchesLabel = document.createElement('span'); matchesLabel.setAttribute('aria-live', 'polite');
  const previous = document.createElement('button'), next = document.createElement('button');
  previous.type = next.type = 'button'; previous.append(createElement(ArrowUp, { width: 16, height: 16, 'stroke-width': 2.5 })); next.append(createElement(ArrowDown, { width: 16, height: 16, 'stroke-width': 2.5 })); previous.setAttribute('aria-label', 'Previous match'); next.setAttribute('aria-label', 'Next match');
  search.append(input, matchesLabel, previous, next);
  const details = document.createElement('div'); details.className = 'file-preview-cell-details'; details.hidden = true; details.setAttribute('role', 'status');
  element.append(search, scroller, details, tabs, note);
  state.count = workbook.SheetNames.length;
  state.sheetPositions ||= {};
  let active = Math.max(0, Math.min(state.sheet || 0, workbook.SheetNames.length - 1)), disposed = false, revision = 0;
  const buttons: HTMLButtonElement[] = [];
  const sourceCache = new Map<number, Document | null>();
  const tables = new Map<number, HTMLTableElement>();
  let selected: HTMLTableCellElement | null = null, matches: HTMLTableCellElement[] = [], matchIndex = -1;
  const savePosition = () => { state.sheetPositions![workbook.SheetNames[active]] = { top: scroller.scrollTop, left: scroller.scrollLeft, cell: selected?.dataset.address }; };
  const select = (cell: HTMLTableCellElement, focus = false) => {
    selected?.classList.remove('file-preview-cell-selected'); selected = cell; selected.classList.add('file-preview-cell-selected');
    const address = cell.dataset.address!, source = workbook.Sheets[workbook.SheetNames[active]][address];
    details.replaceChildren(); details.hidden = false;
    const label = document.createElement('strong'); label.textContent = address;
    const value = document.createElement('span'); value.textContent = `Full value: ${cell.textContent || '(empty)'}`;
    details.append(label, value);
    if (source?.f) { const formula = document.createElement('span'); formula.textContent = `Formula: =${source.f}`; details.append(formula); }
    if (focus) cell.focus({ preventScroll: true }); savePosition();
  };
  const find = () => {
    matches.forEach(cell => cell.classList.remove('file-preview-cell-match'));
    const query = input.value.trim().toLocaleLowerCase();
    matches = query ? Array.from(scroller.querySelectorAll<HTMLTableCellElement>('td')).filter(cell => (cell.textContent || '').toLocaleLowerCase().includes(query)) : [];
    matches.forEach(cell => cell.classList.add('file-preview-cell-match')); matchIndex = -1;
    matchesLabel.textContent = query ? `${matches.length} matches` : ''; previous.disabled = next.disabled = !matches.length;
  };
  const goMatch = (direction: number) => {
    if (!matches.length) return;
    matchIndex = (matchIndex + direction + matches.length) % matches.length;
    select(matches[matchIndex]); matches[matchIndex].scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    matchesLabel.textContent = `${matchIndex + 1} / ${matches.length} matches`;
  };
  input.oninput = find; previous.onclick = () => goMatch(-1); next.onclick = () => goMatch(1);
  input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); goMatch(event.shiftKey ? -1 : 1); } };
  element.addEventListener('click', event => event.stopPropagation());
  element.addEventListener('pointerdown', event => { if ((event.target as HTMLElement).closest('td, input, button')) event.stopPropagation(); });
  scroller.addEventListener('scroll', savePosition);
  scroller.addEventListener('click', event => { const cell = (event.target as HTMLElement).closest<HTMLTableCellElement>('td'); if (cell) select(cell, true); });
  scroller.addEventListener('keydown', event => {
    if (!selected && ['Enter', ' ', 'ArrowDown', 'ArrowRight'].includes(event.key)) {
      const first = scroller.querySelector<HTMLTableCellElement>('td');
      if (first) { event.preventDefault(); select(first, true); } return;
    }
    if (!selected || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); const position = XLSX.utils.decode_cell(selected.dataset.address!);
    position.r = Math.max(0, position.r + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0));
    position.c = Math.max(0, position.c + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0));
    const cell = scroller.querySelector<HTMLTableCellElement>(`[data-address="${XLSX.utils.encode_cell(position)}"]`);
    if (cell) { select(cell, true); cell.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }
  });
  const mountTable = (table: HTMLTableElement) => {
    const position = state.sheetPositions![workbook.SheetNames[active]];
    scroller.replaceChildren(table); selected = null; details.hidden = true;
    scroller.scrollTop = position?.top || 0; scroller.scrollLeft = position?.left || 0;
    const cell = position?.cell ? table.querySelector<HTMLTableCellElement>(`[data-address="${position.cell}"]`) : null;
    if (cell) select(cell);
    const range = XLSX.utils.decode_range(workbook.Sheets[workbook.SheetNames[active]]['!ref'] || 'A1');
    note.textContent = range.e.r > 499 || range.e.c > 79 ? 'Preview limited to 500 rows and 80 columns. Open the original for the full sheet.' : '';
    find();
  };
  const draw = async () => {
    const attempt = ++revision, name = workbook.SheetNames[active], sheet = workbook.Sheets[name];
    state.sheet = active;
    buttons.forEach((button, index) => { button.setAttribute('aria-selected', String(index === active)); button.tabIndex = index === active ? 0 : -1; });
    const existing = tables.get(active); if (existing) { mountTable(existing); return; }
    const xml = sourceCache.has(active) ? undefined : await zip.file(sheetPaths[active] || `xl/worksheets/sheet${active + 1}.xml`)?.async('text');
    if (disposed || attempt !== revision) return;
    const source = sourceCache.get(active) || (xml ? new DOMParser().parseFromString(xml, 'application/xml') : null); if (!sourceCache.has(active) && sourceCache.size >= 3) sourceCache.delete(sourceCache.keys().next().value!); sourceCache.set(active, source);
    const cells = new Map(Array.from(source?.querySelectorAll('c') || []).map(cell => [cell.getAttribute('r'), Number(cell.getAttribute('s') || 0)]));
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    const lastRow = Math.min(range.e.r, 499), lastColumn = Math.min(range.e.c, 79);
    const merges = sheet['!merges'] || [];
    const table = document.createElement('table'); table.setAttribute('aria-label', name);
    const header = document.createElement('tr'); header.append(document.createElement('th'));
    for (let column = 0; column <= lastColumn; column++) { const th = document.createElement('th'); th.textContent = XLSX.utils.encode_col(column); header.append(th); }
    const head = document.createElement('thead'); head.append(header); table.append(head);
    const body = document.createElement('tbody');
    for (let row = 0; row <= lastRow; row++) {
      if (row % 50 === 49) { await new Promise(resolve => setTimeout(resolve, 0)); if (disposed || attempt !== revision) return; }
      const tr = document.createElement('tr');
      const rowHeader = document.createElement('th'); rowHeader.textContent = String(row + 1); rowHeader.scope = 'row'; tr.append(rowHeader);
      const rowHeight = sheet['!rows']?.[row]?.hpt; if (rowHeight) tr.style.height = `${Math.min(rowHeight, 200)}pt`;
      for (let column = 0; column <= lastColumn; column++) {
        const merge = merges.find(m => row >= m.s.r && row <= m.e.r && column >= m.s.c && column <= m.e.c);
        if (merge && (row !== merge.s.r || column !== merge.s.c)) continue;
        const address = XLSX.utils.encode_cell({ r: row, c: column }), cell = sheet[address];
        const td = document.createElement('td'); td.dataset.address = address; td.tabIndex = -1; td.setAttribute('aria-label', `${address}: ${cell ? XLSX.utils.format_cell(cell) : 'empty'}`);
        if (merge) { td.rowSpan = Math.min(merge.e.r, lastRow) - row + 1; td.colSpan = Math.min(merge.e.c, lastColumn) - column + 1; }
        td.textContent = cell ? XLSX.utils.format_cell(cell) : ''; td.title = td.textContent;
        if (cell?.t === 'n') td.style.textAlign = 'right';
        const format = formats[cells.get(address) || 0], font = fonts[Number(format?.getAttribute('fontId') || 0)], fill = fills[Number(format?.getAttribute('fillId') || 0)];
        if (font?.querySelector('b')) td.style.fontWeight = '700'; if (font?.querySelector('i')) td.style.fontStyle = 'italic';
        const size = Number(font?.querySelector('sz')?.getAttribute('val')); if (size > 0) td.style.fontSize = `${Math.min(size, 40)}pt`;
        const foreground = color(font?.querySelector('color') || null), background = color(fill?.querySelector('fgColor') || null);
        if (foreground) td.style.color = foreground; if (background) td.style.backgroundColor = background;
        const alignment = format?.querySelector('alignment');
        const align = alignment?.getAttribute('horizontal'); if (['left', 'center', 'right', 'justify'].includes(align || '')) td.style.textAlign = align!;
        if (alignment?.getAttribute('wrapText') === '1') td.style.whiteSpace = 'normal';
        const width = sheet['!cols']?.[column]?.wpx; if (width) td.style.minWidth = `${Math.min(width, 400)}px`;
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(body); if (tables.size >= 3) tables.delete(tables.keys().next().value!); tables.set(active, table); mountTable(table);
  };
  workbook.SheetNames.forEach((name, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = name; button.setAttribute('role', 'tab');
    button.onclick = () => { savePosition(); active = index; state.sheet = active; notifyResourceViewState(state); void draw(); };
    button.onkeydown = event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const target = (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length; buttons[target].click(); buttons[target].focus(); } }; buttons.push(button); tabs.append(button);
  });
  const unsubscribe = subscribeResourceViewState(state, () => { if (!disposed && state.sheet !== active) { active = Math.max(0, Math.min(state.sheet || 0, workbook.SheetNames.length - 1)); void draw(); } });
  await draw();
  return { element, destroy() { savePosition(); disposed = true; unsubscribe(); revision++; scroller.replaceChildren(); tables.clear(); sourceCache.clear(); } };
}
