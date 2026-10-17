/** Trailing coalescing with a maximum wait keeps continuous indexing useful. */
export function createSuggestionRefresh(run: () => void, delay = 300, maxWait = 1000) {
  let trailing: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { clearTimeout(trailing); clearTimeout(deadline); trailing = undefined; deadline = undefined; };
  const flush = () => { cancel(); run(); };
  return {
    schedule() { clearTimeout(trailing); trailing = setTimeout(flush, delay); deadline ||= setTimeout(flush, maxWait); },
    cancel,
  };
}

export class SuggestionContentCache {
  private entries = new Map<string, { text: string; time: number }>();
  private bytes = 0;
  get(path: string): string | undefined {
    const entry = this.entries.get(path);
    if (!entry || Date.now() - entry.time > 5000) { this.delete(path); return undefined; }
    return entry.text;
  }
  set(path: string, text: string): void {
    this.delete(path);
    if (text.length > 256000) return;
    this.entries.set(path, { text, time: Date.now() }); this.bytes += text.length * 2;
    while (this.entries.size > 48 || this.bytes > 2 * 1024 * 1024) this.delete(this.entries.keys().next().value!);
  }
  delete(path: string): void { const entry = this.entries.get(path); if (entry) this.bytes -= entry.text.length * 2; this.entries.delete(path); }
  clear(): void { this.entries.clear(); this.bytes = 0; }
}
