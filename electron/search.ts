/**
 * Search Engine
 * 
 * Provides full-text search across all vault notes using Fuse.js
 * for fuzzy matching. Maintains an in-memory index that can be
 * rebuilt when files change.
 */

import Fuse from 'fuse.js';
import { FileSystemManager } from './fileSystem.js';

export interface SearchDocument {
  path: string;
  name: string;
  content: string;
  tags: string[];
}

interface SearchResult {
  path: string;
  name: string;
  matches: Array<{
    key: string;
    indices: readonly [number, number][];
    value: string;
  }>;
  score: number;
}

export class SearchEngine {
  private fuse: Fuse<SearchDocument> | null = null;
  private documents: SearchDocument[] = [];

  /** Build/rebuild the search index from all vault files */
  async buildIndex(fsManager: FileSystemManager): Promise<void> {
    const allFiles = await fsManager.getAllMarkdownFiles();
    this.documents = [];

    for (const filePath of allFiles) {
      try {
        const content = await fsManager.readFile(filePath);
        if (content === null) continue;
        const name = filePath.replace(/\.md$/, '');
        const tags = fsManager.extractTags(content);

        this.documents.push({
          path: filePath,
          name,
          content,
          tags,
        });
      } catch (err) {
        // Skip files that can't be read
        console.warn(`Failed to index ${filePath}:`, err);
      }
    }

    // Configure Fuse.js for optimal note search
    this.rebuildFuse();
  }

  loadDocuments(documents: SearchDocument[]): void {
    this.documents = documents.slice();
    this.rebuildFuse();
  }

  upsertDocument(document: SearchDocument): void {
    this.documents = this.documents.filter((item) => item.path !== document.path);
    this.documents.push(document);
    this.rebuildFuse();
  }

  removeDocument(filePath: string): void {
    this.documents = this.documents.filter((item) => item.path !== filePath);
    this.rebuildFuse();
  }

  private rebuildFuse(): void {
    this.fuse = new Fuse(this.documents, {
      keys: [
        { name: 'name', weight: 3 },     // Note name is most important
        { name: 'tags', weight: 2 },      // Tags are second
        { name: 'content', weight: 1 },   // Content has lowest weight
      ],
      includeMatches: true,
      includeScore: true,
      threshold: 0.4,         // Fuzzy matching threshold
      minMatchCharLength: 2,
      ignoreLocation: true,   // Search entire content, not just beginning
      findAllMatches: true,
    });
  }

  /** Search the vault for matching notes */
  search(query: string): SearchResult[] {
    if (!this.fuse || !query.trim()) return [];

    const results = this.fuse.search(query, { limit: 50 });

    return results.map(result => ({
      path: result.item.path,
      name: result.item.name,
      matches: (result.matches || []).map(m => ({
        key: m.key || '',
        indices: m.indices as readonly [number, number][],
        value: (m.value || '').substring(0, 200), // Truncate long content matches
      })),
      score: result.score || 0,
    }));
  }
}
