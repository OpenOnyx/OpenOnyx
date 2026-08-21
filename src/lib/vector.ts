import { supabase } from './supabase';
import { localDB } from './localdb';
import { v4 as uuidv4 } from 'uuid';

// ── Embedding Cache ──────────────────────────────────────────────────────────

const embeddingCache = new Map<string, { embedding: number[]; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 30; // 30 minutes

function getCacheKey(text: string): string {
  // Simple hash for cache key
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `emb_${hash}`;
}

/**
 * Serialize embedding arrays into pgvector literal format.
 */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * Generate embedding using the Supabase edge function, with caching.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const key = getCacheKey(text);
  const cached = embeddingCache.get(key);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.embedding;
  }

  const { data, error } = await supabase.functions.invoke('embed', {
    body: { input: text }
  });

  if (error) {
    console.error('Error generating embedding:', error);
    throw error;
  }

  const embedding = data.embedding;
  embeddingCache.set(key, { embedding, timestamp: Date.now() });

  // Evict old entries if cache gets too large
  if (embeddingCache.size > 500) {
    const oldest = [...embeddingCache.entries()]
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
      .slice(0, 100);
    oldest.forEach(([k]) => embeddingCache.delete(k));
  }

  return embedding;
}

/**
 * Split text into chunks of ~300-500 words, respecting paragraph boundaries.
 */
export function chunkText(text: string, maxWords = 400): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentWordCount = 0;

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (currentWordCount + words.length > maxWords && currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n\n'));
      currentChunk = [paragraph];
      currentWordCount = words.length;
    } else {
      currentChunk.push(paragraph);
      currentWordCount += words.length;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n\n'));
  }

  // If any single chunk is still too long, split it by words
  const finalChunks: string[] = [];
  for (const chunk of chunks) {
    const words = chunk.split(/\s+/);
    if (words.length > maxWords * 1.5) {
      for (let i = 0; i < words.length; i += maxWords) {
        finalChunks.push(words.slice(i, i + maxWords).join(' '));
      }
    } else {
      finalChunks.push(chunk);
    }
  }

  return finalChunks.filter(c => c.trim().length > 0);
}

// ── Debouncing ───────────────────────────────────────────────────────────────

const indexDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const INDEX_DEBOUNCE_MS = 2000; // 2 seconds

/**
 * Debounced note indexing. Waits 2s after last call before indexing.
 */
export function debouncedIndexNote(noteId: string, content: string) {
  const existing = indexDebounceTimers.get(noteId);
  if (existing) clearTimeout(existing);

  indexDebounceTimers.set(noteId, setTimeout(async () => {
    indexDebounceTimers.delete(noteId);
    await indexNote(noteId, content);
  }, INDEX_DEBOUNCE_MS));
}

/**
 * Process a note: chunk it, generate embeddings, and batch-save.
 */
export async function indexNote(noteId: string, content: string) {
  if (!content || content.trim().length < 20) return; // Skip trivially small content

  const chunks = chunkText(content);

  // Delete old chunks for this note from local DB
  const existingChunks = await localDB.getChunks(noteId);
  // We'll just overwrite; for cloud, the sync queue handles upserts.

  const batchChunks: any[] = [];

  for (const text of chunks) {
    try {
      const embedding = await generateEmbedding(text);
      batchChunks.push({
        id: uuidv4(),
        note_id: noteId,
        content: text,
        embedding: embedding as any,
        created_at: new Date().toISOString()
      });
    } catch (err) {
      console.error('[Vector] Failed to embed chunk:', err);
    }
  }

  // Batch insert to local DB
  for (const chunk of batchChunks) {
    await localDB.putChunk(chunk);
  }
}

/**
 * Vector search query for notes (cosine similarity via DB function)
 */
export async function searchNotes(query: string, spaceId: string, topK = 5) {
  const queryEmbedding = await generateEmbedding(query);

  const { data, error } = await supabase.rpc('match_note_chunks', {
    query_embedding: toVectorLiteral(queryEmbedding),
    match_threshold: 0.75,
    match_count: topK,
    filter_space_id: spaceId
  });

  if (error) throw error;

  return data;
}

/**
 * RAG Pipeline: Retrieve context → generate answer.
 * Returns the answer text plus source metadata.
 */
export async function askQuestionAboutNotes(
  query: string,
  spaceId: string,
  topK = 5
): Promise<{ answer: string; sources: any[]; chunkCount: number }> {
  // 1. Retrieve relevant chunks
  const results = await searchNotes(query, spaceId, topK);
  const context = (results || []).map((r: any) => r.content).join('\n\n---\n\n');

  // 2. Build system prompt with source info
  const systemPrompt = [
    'You are a helpful knowledge assistant. Answer based on the provided context.',
    `Based on ${(results || []).length} relevant notes.`,
    '',
    'Context:',
    context || '(No relevant context found)',
  ].join('\n');

  // 3. Call LLM via edge function
  const { data, error } = await supabase.functions.invoke('chat', {
    body: {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query }
      ]
    }
  });

  if (error) throw error;

  return {
    answer: data.reply,
    sources: results || [],
    chunkCount: (results || []).length,
  };
}

/**
 * Generate suggested queries based on space content.
 * Uses a few random chunks from the space to generate dynamic suggestions.
 */
export async function generateSuggestedQueries(spaceId: string): Promise<string[]> {
  // Sample a few chunks from the space to derive suggestions
  const { data: sampleChunks, error } = await supabase
    .from('note_chunks')
    .select('content')
    .eq('note_id', spaceId)
    .limit(3);

  if (error || !sampleChunks || sampleChunks.length === 0) {
    return [
      'What are the key concepts?',
      'Summarize the main ideas',
      'What should I focus on first?',
    ];
  }

  const sampleText = sampleChunks.map(c => c.content).join(' ').slice(0, 500);

  try {
    const { data } = await supabase.functions.invoke('chat', {
      body: {
        messages: [
          {
            role: 'system',
            content: 'Generate exactly 4 short questions (max 8 words each) a user might ask about this content. Return them as a JSON array of strings. Only return the JSON, nothing else.'
          },
          { role: 'user', content: sampleText }
        ]
      }
    });

    const parsed = JSON.parse(data.reply);
    if (Array.isArray(parsed)) return parsed.slice(0, 4);
  } catch {
    // fallback
  }

  return [
    'What are the key concepts?',
    'Summarize the main ideas',
    'How do these topics connect?',
  ];
}
