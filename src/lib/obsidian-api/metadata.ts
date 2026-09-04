/**
 * Obsidian API Compatibility — MetadataCache
 * Provides cached file metadata (frontmatter, headings, links, tags).
 */

import { Events } from './components';
import { TFile } from './files';

export interface CachedMetadata {
  frontmatter?: Record<string, any>;
  frontmatterPosition?: { start: { line: number; col: number; offset: number }; end: { line: number; col: number; offset: number } };
  headings?: Array<{ heading: string; level: number; position: any }>;
  links?: Array<{ link: string; original: string; displayText?: string; position: any }>;
  embeds?: Array<{ link: string; original: string; displayText?: string; position: any }>;
  tags?: Array<{ tag: string; position: any }>;
  sections?: Array<{ type: string; position: any; id?: string }>;
  listItems?: Array<{ position: any; parent: number; task?: string }>;
  frontmatterLinks?: Array<{ key: string; link: string; original: string; displayText?: string }>;
}

export class OOMetadataCache extends Events {
  private _cache: Map<string, CachedMetadata> = new Map();
  private _blocks: Map<string, any[]> = new Map();
  resolvedLinks: Record<string, Record<string, number>> = {};
  unresolvedLinks: Record<string, Record<string, number>> = {};
  blockCache = {
    getForFile: (_token: any, file: TFile) => ({
      blocks: this._blocks.get(file?.path) || [],
    }),
  };

  getFileCache(file: TFile): CachedMetadata | null {
    return this._cache.get(file.path) || null;
  }

  getCache(path: string): CachedMetadata | null {
    return this._cache.get(path) || null;
  }

  getCachedFiles(): string[] {
    return Array.from(this._cache.keys());
  }

  getLinks(): Record<string, CachedMetadata['links']> {
    return Object.fromEntries(Array.from(this._cache, ([path, cache]) => [path, cache.links || []]));
  }

  getTags(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const cache of this._cache.values()) {
      for (const tag of cache.tags || []) result[tag.tag] = (result[tag.tag] || 0) + 1;
      for (const tag of this._frontmatterTags(cache.frontmatter?.tags)) {
        result[tag] = (result[tag] || 0) + 1;
      }
    }
    return result;
  }

  getAllProperties(): Record<string, { name: string; widget: string }> {
    const properties: Record<string, { name: string; widget: string }> = {};
    for (const cache of this._cache.values()) {
      for (const [name, value] of Object.entries(cache.frontmatter || {})) {
        if (properties[name]) continue;
        properties[name] = {
          name,
          widget: typeof value === 'boolean' ? 'checkbox' : typeof value === 'number' ? 'number' : 'text',
        };
      }
    }
    return properties;
  }

  getLinkSuggestions(): Array<{ path: string; file: TFile | null }> {
    const app = (window as any).__oo_app;
    return this.getCachedFiles().map((path) => ({ path, file: app?.vault?.getFileByPath(path) || null }));
  }

  async updateFileCache(file: TFile): Promise<void> {
    const app = (window as any).__oo_app;
    if (!app?.vault || !file) return;
    const content = await app.vault.read(file);
    const metadata = this._parseMetadata(content);
    this._cache.set(file.path, metadata);
    this._blocks.set(file.path, this._parseBlocks(content));
    this.trigger('changed', file, content, metadata);
    this.trigger('resolved');
  }

  deletePath(path: string): void {
    this._cache.delete(path);
    this._blocks.delete(path);
    delete this.resolvedLinks[path];
    delete this.unresolvedLinks[path];
  }

  isSupportedFile(file: TFile): boolean {
    return file?.extension === 'md' || file?.extension === 'excalidraw';
  }

  getBacklinksForFile(file: TFile): { data: Map<TFile, any[]> } {
    const app = (window as any).__oo_app;
    const data = new Map<TFile, any[]>();
    for (const [sourcePath, cache] of this._cache) {
      const matches = (cache.links || []).filter((link) =>
        this.getFirstLinkpathDest(link.link.split('#')[0], sourcePath)?.path === file.path,
      );
      const source = app?.vault?.getFileByPath(sourcePath);
      if (source && matches.length > 0) data.set(source, matches);
    }
    return { data };
  }

  iterateRefsForFile(file: TFile, callback: (ref: any) => any): void {
    const cache = this.getFileCache(file);
    for (const ref of [...(cache?.links || []), ...(cache?.embeds || []), ...(cache?.frontmatterLinks || [])]) {
      callback(ref);
    }
  }

  getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null {
    const app = (window as any).__oo_app;
    if (!app?.vault) return null;
    // Try exact path
    let file = app.vault.getFileByPath(linkpath);
    if (file) return file;
    // Try with .md extension
    file = app.vault.getFileByPath(linkpath + '.md');
    if (file) return file;
    // Try basename match
    const allFiles = app.vault.getMarkdownFiles();
    return allFiles.find((f: TFile) => f.basename.toLowerCase() === linkpath.toLowerCase()) || null;
  }

  fileToLinktext(file: TFile, sourcePath: string, omitMdExtension?: boolean): string {
    if (!file) return '';
    if (omitMdExtension && file.extension === 'md') return file.path.slice(0, -3);
    return file.path;
  }

  /** Build cache from vault content */
  async buildCache(vault: any): Promise<void> {
    this._cache.clear();
    this._blocks.clear();
    this.resolvedLinks = {};
    this.unresolvedLinks = {};
    const files = vault.getFiles().filter((file: TFile) =>
      file.extension === 'md' || file.extension === 'excalidraw',
    );
    for (const file of files) {
      try {
        const content = await vault.read(file);
        const metadata = this._parseMetadata(content);
        this._cache.set(file.path, metadata);
        this._blocks.set(file.path, this._parseBlocks(content));
        for (const link of metadata.links || []) {
          const target = this.getFirstLinkpathDest(link.link.split('#')[0], file.path);
          const index = target ? this.resolvedLinks : this.unresolvedLinks;
          const targetPath = target?.path || link.link;
          index[file.path] ||= {};
          index[file.path][targetPath] = (index[file.path][targetPath] || 0) + 1;
        }
      } catch { /* skip errored files */ }
    }
    this.trigger('resolved');
  }

  private _frontmatterTags(value: unknown): string[] {
    const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,]+/) : [];
    return values.filter(Boolean).map((tag) => String(tag).startsWith('#') ? String(tag) : `#${tag}`);
  }

  private _parseBlocks(content: string): any[] {
    const lines = content.split('\n');
    const offsets: number[] = [];
    let offset = 0;
    for (const line of lines) {
      offsets.push(offset);
      offset += line.length + 1;
    }
    return lines.flatMap((line, lineNumber) => {
      const trimmed = line.trim();
      if (!trimmed) return [];
      const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
      const blockRef = trimmed.match(/\s\^([A-Za-z0-9-]+)\s*$/);
      const nodeType = heading ? 'heading'
        : /^> \[![^\]]+\]/.test(trimmed) ? 'callout'
        : /^>/.test(trimmed) ? 'blockquote'
        : /^([-*+]|\d+\.)\s+/.test(trimmed) ? 'listItem'
        : /^\|.*\|$/.test(trimmed) ? 'table'
        : /^```/.test(trimmed) ? 'codeblock'
        : /^%%/.test(trimmed) ? 'comment'
        : 'paragraph';
      const display = heading ? heading[2] : trimmed.replace(/\s\^[A-Za-z0-9-]+\s*$/, '');
      return [{
        display,
        position: {
          start: { line: lineNumber, col: 0, offset: offsets[lineNumber] },
          end: { line: lineNumber, col: line.length, offset: offsets[lineNumber] + line.length },
        },
        node: {
          type: nodeType,
          ...(heading ? { level: heading[1].length } : {}),
          ...(blockRef ? { id: blockRef[1] } : {}),
        },
      }];
    });
  }

  private _parseMetadata(content: string): CachedMetadata {
    const metadata: CachedMetadata = {};
    const lines = content.split('\n');

    // Parse frontmatter
    if (lines[0]?.trim() === '---') {
      const endIdx = lines.indexOf('---', 1);
      if (endIdx > 0) {
        const yamlStr = lines.slice(1, endIdx).join('\n');
        try {
          const fm: Record<string, any> = {};
          for (const line of yamlStr.split('\n')) {
            const ci = line.indexOf(':');
            if (ci < 0) continue;
            const k = line.substring(0, ci).trim();
            let v: any = line.substring(ci + 1).trim();
            if (v === 'true') v = true;
            else if (v === 'false') v = false;
            else if (/^\d+$/.test(v)) v = parseInt(v);
            if (k) fm[k] = v;
          }
          metadata.frontmatter = fm;
        } catch { /* skip */ }
      }
    }

    // Parse headings
    const headings: CachedMetadata['headings'] = [];
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(#{1,6})\s+(.+)/);
      if (match) {
        headings.push({
          heading: match[2].trim(),
          level: match[1].length,
          position: { start: { line: i, col: 0, offset: 0 }, end: { line: i, col: lines[i].length, offset: 0 } },
        });
      }
    }
    if (headings.length) metadata.headings = headings;

    // Parse links
    const links: CachedMetadata['links'] = [];
    const linkRegex = /\[\[([^\]]+)\]\]/g;
    let match;
    for (let i = 0; i < lines.length; i++) {
      while ((match = linkRegex.exec(lines[i])) !== null) {
        const parts = match[1].split('|');
        links.push({
          link: parts[0].trim(),
          original: match[0],
          displayText: parts[1]?.trim(),
          position: { start: { line: i, col: match.index, offset: 0 }, end: { line: i, col: match.index + match[0].length, offset: 0 } },
        });
      }
    }
    if (links.length) metadata.links = links;

    // Parse tags
    const tags: CachedMetadata['tags'] = [];
    const tagRegex = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_/-]*)/g;
    for (let i = 0; i < lines.length; i++) {
      while ((match = tagRegex.exec(lines[i])) !== null) {
        tags.push({
          tag: '#' + match[1],
          position: { start: { line: i, col: match.index, offset: 0 }, end: { line: i, col: match.index + match[0].length, offset: 0 } },
        });
      }
    }
    if (tags.length) metadata.tags = tags;

    // Parse sections
    const sections: NonNullable<CachedMetadata['sections']> = [];
    let lineIdx = 0;
    if (lines[0]?.trim() === '---') {
      const endIdx = lines.indexOf('---', 1);
      if (endIdx > 0) {
        sections.push({
          type: 'yaml',
          position: {
            start: { line: 0, col: 0, offset: 0 },
            end: { line: endIdx, col: lines[endIdx].length, offset: 0 },
          },
        });
        lineIdx = endIdx + 1;
      }
    }

    while (lineIdx < lines.length) {
      const currentLine = lines[lineIdx];
      const trimmed = currentLine.trim();
      if (!trimmed) {
        lineIdx++;
        continue;
      }

      // Heading
      if (/^(#{1,6})\s+/.test(trimmed)) {
        sections.push({
          type: 'heading',
          position: {
            start: { line: lineIdx, col: 0, offset: 0 },
            end: { line: lineIdx, col: currentLine.length, offset: 0 },
          },
        });
        lineIdx++;
        continue;
      }

      // Code block
      if (/^```/.test(trimmed)) {
        const start = lineIdx;
        lineIdx++;
        while (lineIdx < lines.length && !/^```/.test(lines[lineIdx].trim())) {
          lineIdx++;
        }
        const end = Math.min(lineIdx, lines.length - 1);
        sections.push({
          type: 'code',
          position: {
            start: { line: start, col: 0, offset: 0 },
            end: { line: end, col: lines[end].length, offset: 0 },
          },
        });
        lineIdx = end + 1;
        continue;
      }

      // Table
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        const start = lineIdx;
        while (lineIdx + 1 < lines.length && lines[lineIdx + 1].trim().startsWith('|') && lines[lineIdx + 1].trim().endsWith('|')) {
          lineIdx++;
        }
        const end = lineIdx;
        sections.push({
          type: 'table',
          position: {
            start: { line: start, col: 0, offset: 0 },
            end: { line: end, col: lines[end].length, offset: 0 },
          },
        });
        lineIdx = end + 1;
        continue;
      }

      // List item
      if (/^([-*+]|\d+\.)\s+/.test(trimmed)) {
        const start = lineIdx;
        while (lineIdx + 1 < lines.length && (/^([-*+]|\d+\.)\s+/.test(lines[lineIdx + 1].trim()) || /^\s{2,}/.test(lines[lineIdx + 1]))) {
          lineIdx++;
        }
        const end = lineIdx;
        sections.push({
          type: 'list',
          position: {
            start: { line: start, col: 0, offset: 0 },
            end: { line: end, col: lines[end].length, offset: 0 },
          },
        });
        lineIdx = end + 1;
        continue;
      }

      // Callout or blockquote
      if (trimmed.startsWith('>')) {
        const start = lineIdx;
        while (lineIdx + 1 < lines.length && lines[lineIdx + 1].trim().startsWith('>')) {
          lineIdx++;
        }
        const end = lineIdx;
        sections.push({
          type: /^>+\s*\[!\w+\]/i.test(trimmed) ? 'callout' : 'blockquote',
          position: {
            start: { line: start, col: 0, offset: 0 },
            end: { line: end, col: lines[end].length, offset: 0 },
          },
        });
        lineIdx = end + 1;
        continue;
      }

      // Regular paragraph
      const start = lineIdx;
      while (
        lineIdx + 1 < lines.length &&
        lines[lineIdx + 1].trim() &&
        !/^(#{1,6})\s+/.test(lines[lineIdx + 1].trim()) &&
        !lines[lineIdx + 1].trim().startsWith('```') &&
        !(lines[lineIdx + 1].trim().startsWith('|') && lines[lineIdx + 1].trim().endsWith('|')) &&
        !/^([-*+]|\d+\.)\s+/.test(lines[lineIdx + 1].trim()) &&
        !lines[lineIdx + 1].trim().startsWith('>')
      ) {
        lineIdx++;
      }
      const end = lineIdx;
      sections.push({
        type: 'paragraph',
        position: {
          start: { line: start, col: 0, offset: 0 },
          end: { line: end, col: lines[end].length, offset: 0 },
        },
      });
      lineIdx = end + 1;
    }

    if (sections.length) metadata.sections = sections;

    return metadata;
  }
}
