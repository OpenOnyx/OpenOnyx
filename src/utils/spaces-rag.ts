/**
 * Spaces RAG — Retrieval-Augmented Generation for Space queries
 *
 * Pipeline:
 *  1. Embed user query
 *  2. Retrieve top-K relevant chunks from vector index
 *  3. Construct prompt with retrieved context + space identity
 *  4. Stream LLM response
 *
 * The system prompt makes the LLM behave as the SPACE's thinking layer —
 * not a generic assistant. It reasons using the space's content, infers
 * the creator's perspective, and refuses generic answers.
 */

import { embedText, isModelLoaded } from "./embeddings";
import { loadVectorIndex } from "./spaces-store";
import { loadAIConfig, getBaseUrl, getProviderHeaders, parseProviderError } from "./ai-settings";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { privateCrypto } from "../lib/privateCrypto";
import type { SpaceChunk, SpaceChatMessage } from "../types/spaces";

// ── Constants ────────────────────────────────────────────────────────────────

const TOP_K = 6;
const MIN_SIMILARITY = 0.15;
const OVERVIEW_MIN_SIMILARITY = -1;
const OVERVIEW_TOP_K = 160;
const OVERVIEW_MAX_CHUNKS_PER_NOTE = 1;
const OVERVIEW_MAX_CHUNKS_PER_FOLDER = 12;
const DISPLAY_SOURCE_LIMIT = 8;

// ── Space Metadata (passed from UI) ──────────────────────────────────────────

export interface SpaceMetadata {
  title: string;
  description: string;
  helpsWith: string[];
  explicitNotes?: { path: string; title: string; content: string }[];
  allowLocalNoteCreation?: boolean;
  readOnly?: boolean;
}

// ── System Prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(meta: SpaceMetadata): string {
  const helpsWith = meta.helpsWith || [];
  const helpsLine = helpsWith.length > 0
    ? `\n  helps_with: ${helpsWith.join(", ")}`
    : "";
  const isReadOnly = meta.readOnly === true;

  // Build the read-only enforcement block or the full actions protocol
  let actionsBlock: string;
  if (isReadOnly) {
    actionsBlock = `8. READ-ONLY MODE (STRICTLY ENFORCED)
The source space is READ-ONLY. This includes public spaces even when the current user is the owner.
- You MUST NOT update, rename, move, merge, delete, link, restructure, or otherwise modify source-space notes.
- You MUST NOT output update_note, suggest_structure, suggest_links, or any action that changes existing source notes.
- If the user asks to directly edit a source note, you MUST still produce a visible markdown reply. Say clearly that public/read-only spaces cannot be edited directly. Then stay useful: explain what can be done, offer to draft the change, offer to create a new local note from the public-space context, and suggest Remix/Fork if they want editable ownership.
- If the user asks to summarize/export/save/create a NEW note in the current local vault based on this public/read-only space, you MAY output a create_note JSON action block only. The new note must be derived from the provided context and must not claim to edit the source space.
- For normal questions, respond with conversational markdown only and no JSON action block.
- Never return an empty response. If refusing a source edit, include 2-4 query-specific next actions under wording like "You can ask me to:", not a literal "follow-ups" label.
- DEFAULT: if intent is ambiguous, answer only.`;
  } else {
    actionsBlock = `8. QUERY CLASSIFICATION (CRITICAL — Apply BEFORE responding)
Before generating your response, classify the user's intent:

A) KNOWLEDGE QUERY — The user is asking a question to learn, understand, compare, explain, or explore a concept.
   Examples: "what are deadlocks?", "explain event loops", "how does X relate to Y?", "what is the difference between A and B?"
   Response: Pure conversational markdown. NO JSON action block. Just answer the question clearly.
   You may include code examples, tables, callouts, and rich formatting in your markdown response.

B) ACTION QUERY — The user EXPLICITLY asks to create, write, update, edit, rewrite, expand, simplify, link, organize, restructure, or summarize notes INTO their vault.
   Examples: "create a note about X", "rewrite [[MyNote]]", "link orphan notes", "organize my vault", "add this to my notes"
   Response: Output a structured JSON action block (see schema below).

DEFAULT RULE: If the intent is ambiguous or unclear, ALWAYS treat it as a KNOWLEDGE QUERY.
Never propose file edits unless the user explicitly requests vault modification.
Asking about a topic is NOT the same as asking to create a note about that topic.

For ACTION QUERIES ONLY, output a structured JSON payload enclosed in a \`\`\`json ... \`\`\` block. Never use emojis in titles, paths, or contents.

Always follow this exact schema for action payloads:
{
  "intent": "create_note" | "update_note" | "multi_action",
  "summary": "Short explanation of what you plan to do",
  "actions": [
    // Array of actions. For create_note:
    {
      "type": "create_note",
      "title": "Title of Note",
      "path": "folder/path/", // folder path or file path (e.g. "/Systems/")
      "content": "Full markdown content of the new note"
    },
    // For update_note (you can either propose a full content change, or a search-and-replace patch for lightweight token-efficient updates):
    {
      "type": "update_note",
      "file_path": "folder/path/Note.md", // exact file path
      "changes": {
        // Option A: Full content update (use for major edits):
        "before": "Original full content of the file, exactly as provided in contextual prompt",
        "after": "New proposed full content of the file"
        // OR Option B: Search-and-replace patch (RECOMMENDED for minor edits/linking notes, as it allows updating many files in a single turn without hitting token limits):
        "search": "Exact text block in the original file to replace",
        "replace": "Replacement text block (e.g. adding a [[Wiki Link]])"
      }
    }
  ],
  "sources": [
    { "note": "Note Name Reference", "chunk": "precise text excerpt from the notes context that you used" }
  ]
}

If you are only responding conversationally (KNOWLEDGE QUERY), do NOT output any JSON block.`;
  }

  // The explicit file edits protocol is only relevant for non-read-only spaces
  const explicitFileBlock = isReadOnly ? "" : `
10. EXPLICIT FILE MENTIONS & EDITS PROTOCOL (CRITICAL)
- The user can explicitly mention files in their input using [[Note Title]].
- If a note is explicitly mentioned, its full path and content will be provided in the user prompt under "EXPLICITLY MENTIONED FILE CONTEXTS".
- If the user asks to modify, rewrite, expand, simplify, add to, or rewrite/synthesize the mentioned note, you MUST choose the "update_note" action.
- You MUST use the EXACT file path of that note as provided in the "EXPLICITLY MENTIONED FILE CONTEXTS" (e.g. "Folder/Subfolder/Note.md" or "MyNotes/Note.md").
- Do NOT create a new note at the root (like "Note.md" or "Summary.md") if the user is asking to update or edit a note that is already in their vault. Always preserve the original file path.
- In "update_note", you must output the COMPLETE, beautifully structured markdown content of the updated note.`;

  return `You are not an assistant.
You are the thinking layer of this knowledge system.

SPACE IDENTITY:
  title: ${meta.title}
  description: ${meta.description}${helpsLine}

---

CORE RULES:

1. CONTEXT FIRST
- Use ONLY the provided context
- Do NOT rely on general knowledge unless absolutely necessary
- If context is weak, say it clearly

2. NO GENERIC ANSWERS (STRICT)
Never output:
- "it depends"
- "start by defining your goals"
- "break it into steps"
If the answer sounds like something that could apply to ANY topic, it is wrong.

3. THINK LIKE THE SPACE
Infer:
- what the creator believes
- what approach they prefer
- what patterns exist in the notes
Then answer from THAT perspective.

4. BE SPECIFIC TO THE TOPIC
Always anchor the response in:
- the subject of this space
- the actual terms used in the notes

5. STRUCTURE INTELLIGENTLY
Do NOT use fixed templates. Dynamically choose structure based on the query:
- "how to start" → phased plan
- "why am I stuck" → diagnosis + causes
- "what should I do" → prioritized actions
- "compare" → contrast format

6. HANDLE WEAK CONTEXT PROPERLY
If context is insufficient:
- say what's missing
- suggest what kind of notes would improve answers
Example: "This space doesn't yet contain enough detail about X to give a strong answer."

7. REFLECT PATTERNS
Occasionally surface structure:
- recurring ideas
- repeated strategies
- gaps in coverage
Example: "A recurring pattern in this space is..."

---

RESPONSE FORMAT:
- Start directly with the answer (no fluff)
- Use clean markdown sections if helpful
- Be concise but insightful
- Avoid long paragraphs
- No emojis, no filler

${actionsBlock}

9. PREMIUM MARKDOWN LAYOUT AND STRUCTURING RULES (CRITICAL)
Your generated note contents must look stunning, highly professional, and extremely well-organized. Follow these formatting rules strictly:
- No emojis are allowed in any note titles, paths, contents, or headers (Strict project rule).
- Structure note contents like a professional README or a premium wiki landing page:
  - Add a clear main title (\`# Title\`), a brief high-level summary or overview section, and structured main sections (\`## Section Title\`).
  - Always include a beautifully formatted Markdown Table for key structured properties, comparisons, definitions, metadata, or data analysis (e.g., | Topic | Key Idea | Impact |). Ensure clean spacing and proper header separation.
  - Use Markdown callout blocks to highlight key definitions, tips, warnings, or notes. Format them as:
    > [!NOTE]
    > Important note content here.
    
    > [!TIP]
    > Pro tip or recommended approach.
    
    > [!IMPORTANT]
    > Critical instructions or key takeaways.
    
    > [!WARNING]
    > Potential risks or caveats.
  - Always bold important terms, keys, and definitions using **double asterisks** to make sections easily scannable.
  - Use task list checkboxes (e.g., - [ ] uncompleted task, - [x] completed task) for action items, next steps, and roadmaps.
  - Use nested, bulleted list items for breakdowns and detailed sub-points.
  - Avoid writing long, unstructured walls of text. Make the note feel like a rich, scannable, standalone README document.
${explicitFileBlock}

---

QUALITY CHECK (MANDATORY):
Before responding, ensure:
- Is this specific to THIS space?
- Could this answer exist without the context? (if yes, reject it)
- Does it reflect actual content patterns?
- Is it useful immediately?
Only output if all pass.

---

GOAL:
Make the user feel: "This isn't ChatGPT. This is MY system thinking back at me."`;
}

// ── JSON Action Parser ───────────────────────────────────────────────────────

export function parseActionPayload(text: string): any {
  if (!text) return null;
  const trimmed = text.trim();

  // 1. Try Code Block Regex matching
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
  const match = trimmed.match(codeBlockRegex);
  if (match) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed && (parsed.intent || parsed.action)) return parsed;
    } catch {
      // Fall through
    }
  }

  // 2. Try raw JSON matching (searching for first '{' and last '}')
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const rawCandidate = trimmed.substring(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(rawCandidate);
      if (parsed && (parsed.intent || parsed.action)) return parsed;
    } catch {
      // Fall through
    }
  }

  return null;
}

/**
 * Strips JSON code blocks and raw JSON action payloads from LLM context
 * so that conversation memory only includes clean markdown/conversational text.
 */
export function stripJSONBlock(text: string): string {
  if (!text) return "";
  
  let cleaned = text;

  // 1. Strip only fenced code blocks that contain JSON action payloads (intent/action keys).
  //    Preserve legitimate code blocks (python, javascript, etc.)
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
  cleaned = cleaned.replace(codeBlockRegex, (fullMatch, blockContent) => {
    const hasActionKey = blockContent.includes('"intent"') || blockContent.includes('"action"') ||
                         blockContent.includes("'intent'") || blockContent.includes("'action'");
    // Only strip if this is a JSON action payload block
    if (hasActionKey) return "";
    // Preserve non-action code blocks (python examples, etc.)
    return fullMatch;
  });

  // 2. Handle incomplete/streaming JSON action blocks (no closing ```)
  //    Only strip if the open fence is followed by json-like action content
  const incompleteBlockIndex = cleaned.indexOf("```");
  if (incompleteBlockIndex !== -1) {
    const afterFence = cleaned.substring(incompleteBlockIndex + 3);
    // Check if this looks like a json action block being streamed
    const looksLikeActionBlock = /^\s*(?:json)?\s*\{/.test(afterFence) &&
      (afterFence.includes('"intent"') || afterFence.includes('"action"') ||
       afterFence.includes("'intent'") || afterFence.includes("'action'"));
    if (looksLikeActionBlock) {
      cleaned = cleaned.substring(0, incompleteBlockIndex);
    }
  }

  // 3. Also handle any raw JSON block { "action": ... } or { "intent": ... } not inside a code fence
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace !== -1) {
    const candidate = cleaned.substring(firstBrace);
    const hasJSONKey = candidate.includes('"action":') || candidate.includes("'action':") ||
                       candidate.includes('"action"') || candidate.includes("'action'") ||
                       candidate.includes('"intent":') || candidate.includes("'intent':") ||
                       candidate.includes('"intent"') || candidate.includes("'intent'");
    if (hasJSONKey) {
      const lastBrace = cleaned.lastIndexOf("}");
      if (lastBrace !== -1 && lastBrace > firstBrace) {
        cleaned = cleaned.substring(0, firstBrace) + cleaned.substring(lastBrace + 1);
      } else {
        cleaned = cleaned.substring(0, firstBrace);
      }
    }
  }
  
  return cleaned.trim();
}

// ── Cosine Similarity ────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vectors are pre-normalized
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2)
    .filter((token, index, source) => source.indexOf(token) === index)
    .slice(0, 24);
}

function splitTextIntoChunks(text: string, size = 1200, overlap = 200): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const chunkText = text.substring(start, start + size);
    chunks.push(chunkText);
    start += size - overlap;
  }
  return chunks;
}

function lexicalSimilarity(queryTerms: string[], chunk: SpaceChunk): number {
  if (queryTerms.length === 0) return 0;

  const title = `${chunk.noteTitle} ${chunk.notePath}`.toLowerCase();
  const body = chunk.chunkText.toLowerCase();
  let score = 0;

  for (const term of queryTerms) {
    if (title.includes(term)) score += 3;
    if (body.includes(term)) score += 1;
  }

  return score / (queryTerms.length * 4);
}

// ── Retrieval ────────────────────────────────────────────────────────────────

export interface RetrievedChunk {
  chunk: SpaceChunk;
  similarity: number;
}

function isComprehensiveSpaceQuery(query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return false;

  const overviewQuery = /\b(what'?s|what is|tell me|summari[sz]e|overview|about|inside|contain|contents?|vault|space|knowledge base|notes?)\b/.test(normalized) &&
    /\b(vault|space|knowledge base|notes?|contents?|about|overview)\b/.test(normalized);

  const wholeVaultTask = /\b(all|entire|whole|every|everything|full|complete|comprehensive|vault-wide|space-wide|huge|large)\b/.test(normalized) &&
    /\b(vault|space|knowledge base|notes?|files?|folders?|index|organize|summari[sz]e|analy[sz]e|find|review|map|connect|link|merge|cluster)\b/.test(normalized);

  return overviewQuery || wholeVaultTask;
}

function getTopLevelFolder(notePath: string): string {
  const normalized = notePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const firstSegment = normalized.split("/")[0]?.trim();
  if (!firstSegment || firstSegment === normalized) return "(root)";
  return firstSegment;
}

function getChunkBucketKey(chunk: SpaceChunk): string {
  return chunk.notePath || chunk.noteTitle || chunk.id;
}

function diversifyRetrievedChunks(
  ranked: RetrievedChunk[],
  limit: number,
): RetrievedChunk[] {
  const selected: RetrievedChunk[] = [];
  const usedChunkIds = new Set<string>();
  const noteCounts = new Map<string, number>();
  const folderCounts = new Map<string, number>();

  const tryAdd = (
    item: RetrievedChunk,
    maxPerNote: number,
    maxPerFolder: number,
  ) => {
    if (selected.length >= limit || usedChunkIds.has(item.chunk.id)) return;
    const noteKey = getChunkBucketKey(item.chunk);
    const folderKey = getTopLevelFolder(item.chunk.notePath);
    if ((noteCounts.get(noteKey) || 0) >= maxPerNote) return;
    if ((folderCounts.get(folderKey) || 0) >= maxPerFolder) return;

    selected.push(item);
    usedChunkIds.add(item.chunk.id);
    noteCounts.set(noteKey, (noteCounts.get(noteKey) || 0) + 1);
    folderCounts.set(folderKey, (folderCounts.get(folderKey) || 0) + 1);
  };

  for (const item of ranked) {
    tryAdd(item, OVERVIEW_MAX_CHUNKS_PER_NOTE, OVERVIEW_MAX_CHUNKS_PER_FOLDER);
  }

  for (const item of ranked) {
    tryAdd(item, 2, Math.max(OVERVIEW_MAX_CHUNKS_PER_FOLDER, Math.ceil(limit / 3)));
  }

  for (const item of ranked) {
    if (selected.length >= limit || usedChunkIds.has(item.chunk.id)) continue;
    selected.push(item);
    usedChunkIds.add(item.chunk.id);
  }

  return selected;
}

function buildVaultCoverageMap(chunks: RetrievedChunk[]): string {
  const notesByPath = new Map<string, { title: string; folder: string }>();

  for (const { chunk } of chunks) {
    const noteKey = getChunkBucketKey(chunk);
    if (notesByPath.has(noteKey)) continue;
    notesByPath.set(noteKey, {
      title: chunk.noteTitle || noteKey,
      folder: getTopLevelFolder(chunk.notePath),
    });
  }

  if (notesByPath.size === 0) return "";

  const folders = new Map<string, string[]>();
  for (const note of notesByPath.values()) {
    if (!folders.has(note.folder)) folders.set(note.folder, []);
    folders.get(note.folder)!.push(note.title);
  }

  const folderLines = Array.from(folders.entries())
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 16)
    .map(([folder, titles]) => {
      const samples = titles.slice(0, 5).join(", ");
      const remaining = titles.length > 5 ? `, +${titles.length - 5} more` : "";
      return `- ${folder}: ${titles.length} retrieved notes (${samples}${remaining})`;
    })
    .join("\n");

  return `\n\nVAULT COVERAGE MAP:\nRetrieved context was intentionally diversified across ${notesByPath.size} notes and ${folders.size} top-level folders.\n${folderLines}`;
}

export async function retrieveChunks(
  spaceId: string,
  query: string,
  topK: number = TOP_K,
  minSimilarity: number = MIN_SIMILARITY,
  options?: { diversify?: boolean },
): Promise<RetrievedChunk[]> {
  console.log("[SpacesRAG] retrieveChunks called for space:", spaceId, "query:", query);
  
  let queryVector: number[] | null = null;
  try {
    const embedded = await embedText(query);
    if (isModelLoaded()) {
      queryVector = embedded.some((value) => value !== 0) ? embedded : null;
      console.log("[SpacesRAG] Generated semantic query vector. Length:", queryVector?.length);
    } else {
      console.log("[SpacesRAG] Local model not loaded, skipping semantic query vector generation.");
    }
  } catch (err) {
    console.warn("[SpacesRAG] Embedding query failed, using lexical retrieval fallback:", err);
  }
  const results: RetrievedChunk[] = [];

  // 1. If cloud is available and we have a semantic query vector, try semantic cloud search first
  if (isSupabaseConfigured && queryVector) {
    try {
      console.log("[SpacesRAG] Attempting semantic cloud search...");
      const { data: cloudChunks, error } = await supabase.rpc("match_note_chunks", {
        filter_space_id: spaceId,
        query_embedding: `[${queryVector.join(",")}]`,
        match_threshold: Math.max(0, minSimilarity),
        match_count: topK,
      });

      if (error) throw error;

      if (cloudChunks && cloudChunks.length > 0) {
        console.log(`[SpacesRAG] Semantic cloud search returned ${cloudChunks.length} chunks.`);
        for (const rc of cloudChunks) {
          results.push({
            chunk: {
              id: rc.id,
              spaceId,
              notePath: "", // Cloud notes don't have local paths
              noteTitle: rc.note_title || "Unknown Note",
              chunkText: rc.content,
              vector: [],
              startOffset: 0,
              endOffset: 0,
            },
            similarity: rc.similarity,
          });
        }
        
        return options?.diversify
          ? diversifyRetrievedChunks(results, topK)
          : results;
      } else {
        console.log("[SpacesRAG] Semantic cloud search returned 0 chunks.");
      }
    } catch (err) {
      console.warn("[SpacesRAG] Cloud semantic search failed:", err);
    }
  }

  // 2. Try Local Fallback (for local spaces or cached cloud spaces)
  const index = await loadVectorIndex(spaceId);
  if (index && index.chunks.length > 0) {
    console.log(`[SpacesRAG] Found local vector index with ${index.chunks.length} chunks. Performing search.`);
    const queryTerms = queryVector ? [] : tokenizeQuery(query);
    for (const chunk of index.chunks) {
      const sim = queryVector
        ? (chunk.vector.length === queryVector.length ? cosineSimilarity(queryVector, chunk.vector) : 0)
        : lexicalSimilarity(queryTerms, chunk);
      const effectiveMinSimilarity = queryVector ? minSimilarity : 0;
      if (sim > effectiveMinSimilarity) {
        results.push({ chunk, similarity: sim });
      }
    }
    console.log(`[SpacesRAG] Local fallback matched ${results.length} chunks.`);
  } else {
    console.log("[SpacesRAG] No local vector index found on disk.");
  }

  // 3. Try Cloud Lexical Fallback if we didn't find any results but we have Supabase configured
  if (results.length === 0 && isSupabaseConfigured) {
    try {
      console.log("[SpacesRAG] Attempting cloud database lexical fallback for space:", spaceId);
      
      // First, fetch notes in this space (including encrypted and mapping columns for private spaces)
      const { data: notesData, error: notesErr } = await supabase
        .from("notes" as any)
        .select("id, title, path, version, content, content_encrypted, iv, auth_tag, encryption_version")
        .eq("space_id", spaceId)
        .eq("deleted", false);

      if (notesErr) throw notesErr;

      const noteTitleMap: Record<string, string> = {};
      const noteIds: string[] = [];
      const decryptedNotes: { id: string; title: string; content: string }[] = [];

      if (notesData) {
        for (const n of notesData as any[]) {
          noteTitleMap[n.id] = n.title;
          noteIds.push(n.id);

          let decryptedContent = n.content || "";
          if (n.content_encrypted && privateCrypto.isUnlocked(spaceId)) {
            try {
              decryptedContent = await privateCrypto.decryptNoteContent(spaceId, n);
            } catch (decErr) {
              console.warn(`[SpacesRAG] Cloud fallback decryption failed for note: "${n.title}" (id: "${n.id}", path: "${n.path}", version: ${n.version}, iv: "${n.iv}", auth_tag: "${n.auth_tag}")`, decErr);
            }
          }
          decryptedNotes.push({
            id: n.id,
            title: n.title,
            content: decryptedContent,
          });
        }
      }

      if (noteIds.length > 0) {
        console.log(`[SpacesRAG] Cloud lexical fallback: querying note_chunks via inner join on notes...`);
        const { data, error } = await supabase
          .from("note_chunks" as any)
          .select("id, note_id, content, notes!inner(space_id)")
          .eq("notes.space_id", spaceId);

        if (error) throw error;

        const cloudChunks = data as any[] | null;
        if (cloudChunks && cloudChunks.length > 0) {
          console.log(`[SpacesRAG] Cloud database lexical fallback fetched ${cloudChunks.length} chunks. Scoring...`);
          const queryTerms = tokenizeQuery(query);
          for (const rc of cloudChunks) {
            const mockChunk = {
              id: rc.id,
              spaceId,
              notePath: "",
              noteTitle: noteTitleMap[rc.note_id] || "Unknown Note",
              chunkText: rc.content || "",
              vector: [],
              startOffset: 0,
              endOffset: 0,
            };
            const sim = lexicalSimilarity(queryTerms, mockChunk);
            if (sim > 0) {
              results.push({
                chunk: mockChunk,
                similarity: sim,
              });
            }
          }
          console.log(`[SpacesRAG] Cloud database lexical fallback matched ${results.length} chunks.`);
        } else {
          console.log("[SpacesRAG] Cloud note_chunks table empty. Performing in-memory decryption and fallback chunking search...");
          const queryTerms = tokenizeQuery(query);
          for (const n of decryptedNotes) {
            if (!n.content || n.content.trim().length < 5) continue;
            const textChunks = splitTextIntoChunks(n.content);
            textChunks.forEach((chunkText, idx) => {
              const mockChunk = {
                id: `mem-${n.id}-${idx}`,
                spaceId,
                notePath: "",
                noteTitle: n.title,
                chunkText: chunkText,
                vector: [],
                startOffset: 0,
                endOffset: 0,
              };
              const sim = lexicalSimilarity(queryTerms, mockChunk);
              if (sim > 0) {
                results.push({
                  chunk: mockChunk,
                  similarity: sim,
                });
              }
            });
          }
          console.log(`[SpacesRAG] In-memory decryption and fallback chunking matched ${results.length} chunks.`);
        }
      } else {
        console.log("[SpacesRAG] Cloud database lexical fallback: no notes found for this space.");
      }
    } catch (err) {
      console.warn("[SpacesRAG] Cloud database lexical fallback failed:", err);
    }
  }

  const ranked = results.sort((a, b) => b.similarity - a.similarity);
  return options?.diversify
    ? diversifyRetrievedChunks(ranked, topK)
    : ranked.slice(0, topK);
}

// ── Prompt Construction ──────────────────────────────────────────────────────

function buildUserPrompt(
  query: string,
  chunks: RetrievedChunk[],
  explicitNotes?: { path: string; title: string; content: string }[],
  options?: { broadOverview?: boolean },
): string {
  const contextBlock = chunks
    .map(
      (r, i) =>
        `[${i + 1}] from "${r.chunk.noteTitle}" (${Math.round(r.similarity * 100)}% relevance)\n${r.chunk.chunkText}`,
    )
    .join("\n\n---\n\n");

  let explicitBlock = "";
  if (explicitNotes && explicitNotes.length > 0) {
    explicitBlock = "\n\nEXPLICITLY MENTIONED FILE CONTEXTS:\n" + explicitNotes
      .map(
        (n, i) =>
          `[EXPLICIT ${i + 1}] Title: "${n.title}"\nPath: "${n.path}"\nContent:\n${n.content}`
      )
      .join("\n\n---\n\n");
  }

  const overviewInstruction = options?.broadOverview
    ? `\n\nCOMPREHENSIVE VAULT MODE:\nThe user is asking about a whole-space or large vault task. Do not summarize only the first or most repeated folder. Synthesize across the retrieved folders, mention major topic clusters, and explicitly account for cross-folder coverage. Treat the context as a broad working set, not a narrow top-hit answer.${buildVaultCoverageMap(chunks)}`
    : "";

  return `USER INPUT:\n${query}\n\nCONTEXT:\n${contextBlock}${overviewInstruction}${explicitBlock}`;
}

// ── Query Result ─────────────────────────────────────────────────────────────

export interface RAGResult {
  answer: string;
  sources: { notePath: string; noteTitle: string; chunkText: string; similarity: number }[];
}

function buildDisplaySources(
  retrieved: RetrievedChunk[],
): RAGResult["sources"] {
  const byNote = new Map<string, RetrievedChunk>();

  for (const item of retrieved) {
    const noteKey = item.chunk.notePath || item.chunk.noteTitle || item.chunk.id;
    const existing = byNote.get(noteKey);
    if (!existing || item.similarity > existing.similarity) {
      byNote.set(noteKey, item);
    }
  }

  return Array.from(byNote.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, DISPLAY_SOURCE_LIMIT)
    .map((r) => ({
      notePath: r.chunk.notePath,
      noteTitle: r.chunk.noteTitle,
      chunkText: r.chunk.chunkText.substring(0, 200),
      similarity: r.similarity,
    }));
}

// ── Non-streaming Query ──────────────────────────────────────────────────────

export async function querySpace(
  spaceId: string,
  query: string,
  meta: SpaceMetadata,
  history?: SpaceChatMessage[],
): Promise<RAGResult> {
  const config = loadAIConfig();
  if (!config) {
    return {
      answer: "No API key configured. Please add one in AI Settings.",
      sources: [],
    };
  }

  const cleanQuery = query.split("\n\n--- VAULT STRUCTURE")[0].trim();
  const isBroadOverview = isComprehensiveSpaceQuery(cleanQuery);
  const retrieved = await retrieveChunks(
    spaceId,
    cleanQuery,
    isBroadOverview ? OVERVIEW_TOP_K : TOP_K,
    isBroadOverview ? OVERVIEW_MIN_SIMILARITY : MIN_SIMILARITY,
    { diversify: isBroadOverview },
  );

  if (retrieved.length === 0 && (!meta.explicitNotes || meta.explicitNotes.length === 0)) {
    return {
      answer: "No relevant content found in this space. Try rephrasing or adding more notes to your vault.",
      sources: [],
    };
  }

  const systemPrompt = buildSystemPrompt(meta);
  const userPrompt = buildUserPrompt(query, retrieved, meta.explicitNotes, { broadOverview: isBroadOverview });


  // Map conversation history to LLM message format, stripping action blocks
  const historyMessages = (history || [])
    .slice(-10) // Limit to last 10 messages for token efficiency
    .map((msg) => {
      let content = msg.content;
      if (msg.role === "assistant") {
        content = stripJSONBlock(content);
      }
      return { role: msg.role, content };
    });

  const baseUrl = getBaseUrl(config);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: getProviderHeaders(config),
    body: JSON.stringify({
      model: config.modelId,
      max_tokens: 4096,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        ...historyMessages,
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(await parseProviderError(response));
  }

  const data = await response.json();
  const answer = data.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error("Empty response from AI.");

  return {
    answer,
    sources: buildDisplaySources(retrieved),
  };
}

// ── Streaming Query ──────────────────────────────────────────────────────────

export async function querySpaceStreaming(
  spaceId: string,
  query: string,
  meta: SpaceMetadata,
  history: SpaceChatMessage[] | undefined,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<RAGResult> {
  const config = loadAIConfig();
  if (!config) {
    const msg = "No API key configured. Please add one in AI Settings.";
    onChunk(msg);
    return { answer: msg, sources: [] };
  }

  const cleanQuery = query.split("\n\n--- VAULT STRUCTURE")[0].trim();
  const isBroadOverview = isComprehensiveSpaceQuery(cleanQuery);
  const retrieved = await retrieveChunks(
    spaceId,
    cleanQuery,
    isBroadOverview ? OVERVIEW_TOP_K : TOP_K,
    isBroadOverview ? OVERVIEW_MIN_SIMILARITY : MIN_SIMILARITY,
    { diversify: isBroadOverview },
  );

  if (retrieved.length === 0 && (!meta.explicitNotes || meta.explicitNotes.length === 0)) {
    const msg = "No relevant content found in this space. Try rephrasing or adding more notes to your vault.";
    onChunk(msg);
    return { answer: msg, sources: [] };
  }

  const systemPrompt = buildSystemPrompt(meta);
  const userPrompt = buildUserPrompt(query, retrieved, meta.explicitNotes, { broadOverview: isBroadOverview });


  // Map conversation history to LLM message format, stripping action blocks
  const historyMessages = (history || [])
    .slice(-10) // Limit to last 10 messages for token efficiency
    .map((msg) => {
      let content = msg.content;
      if (msg.role === "assistant") {
        content = stripJSONBlock(content);
      }
      return { role: msg.role, content };
    });

  const baseUrl = getBaseUrl(config);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: getProviderHeaders(config),
    signal,
    body: JSON.stringify({
      model: config.modelId,
      max_tokens: 4096,
      temperature: 0.2,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        ...historyMessages,
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(await parseProviderError(response));
  }

  const makeSources = () => buildDisplaySources(retrieved);

  // Parse SSE stream
  let fullAnswer = "";
  const reader = response.body?.getReader();
  if (!reader) {
    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content?.trim() || "";
    onChunk(answer);
    return { answer, sources: makeSources() };
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let isTimedOut = false;

  let watchdog = setTimeout(() => {
    isTimedOut = true;
    reader.cancel("Timeout waiting for stream chunks");
  }, 15000); // 15 seconds watchdog timeout

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (isTimedOut && !fullAnswer) {
          throw new Error("AI provider request timed out (no response was received within 15 seconds). The model might be overloaded. Please try again or switch to a different model in AI Settings.");
        }
        break;
      }

      // Reset watchdog since we got some data
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        isTimedOut = true;
        reader.cancel("Timeout waiting for stream chunks");
      }, 15000);

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") continue;

        try {
          const parsed = JSON.parse(payload);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullAnswer += delta;
            onChunk(delta);
          }
        } catch {
          // Skip malformed chunks
        }
      }
    }
  } finally {
    clearTimeout(watchdog);
  }

  // Flush remaining buffer
  if (buffer.trim()) {
    const trimmed = buffer.trim();
    if (trimmed.startsWith("data: ") && trimmed.slice(6) !== "[DONE]") {
      try {
        const parsed = JSON.parse(trimmed.slice(6));
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          fullAnswer += delta;
          onChunk(delta);
        }
      } catch {
        // Ignore
      }
    }
  }

  return { answer: fullAnswer, sources: makeSources() };
}
