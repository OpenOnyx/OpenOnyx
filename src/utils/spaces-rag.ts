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

import { embedText } from "./embeddings";
import { loadVectorIndex, getSpace } from "./spaces-store";
import { loadAIConfig, getBaseUrl, getProviderHeaders, parseProviderError } from "./ai-settings";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import type { SpaceChunk, SpaceChatMessage } from "../types/spaces";

// ── Constants ────────────────────────────────────────────────────────────────

const TOP_K = 6;
const MIN_SIMILARITY = 0.15;

// ── Space Metadata (passed from UI) ──────────────────────────────────────────

export interface SpaceMetadata {
  title: string;
  description: string;
  helpsWith: string[];
  explicitNotes?: { path: string; title: string; content: string }[];
}

// ── System Prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(meta: SpaceMetadata): string {
  const helpsWith = meta.helpsWith || [];
  const helpsLine = helpsWith.length > 0
    ? `\n  helps_with: ${helpsWith.join(", ")}`
    : "";

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
Example: "A recurring pattern in this space is…"

---

RESPONSE FORMAT:
- Start directly with the answer (no fluff)
- Use clean markdown sections if helpful
- Be concise but insightful
- Avoid long paragraphs
- No emojis, no filler

8. KNOWLEDGE OPERATOR ACTIONS PROTOCOL (CRITICAL)
If the user's intent is to create a new note, update/improve an existing note, or perform multiple vault actions, you MUST output a structured JSON payload enclosed in a \`\`\`json ... \`\`\` block. Never use emojis in titles, paths, or contents.

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

If you are only responding conversationally without proposing any note creation, edits, or multi-actions, do not output any JSON block. Prioritize returning a structured action payload over a passive text reply if the user's prompt suggests any note creation, editing, restructuring, or link suggestion.

9. PREMIUM MARKDOWN LAYOUT AND STRUCTURING RULES (CRITICAL)
Your generated note contents must look stunning, highly professional, and extremely well-organized. Follow these formatting rules strictly:
- No emojis are allowed in any note titles, paths, contents, or headers (Strict project rule).
- Use a clear and beautiful heading hierarchy (e.g., # Main Title, ## Section, ### Sub-section) for logical structure.
- Always bold important terms, keys, and definitions using **double asterisks** to make sections easily scannable.
- Use task list checkboxes (e.g., - [ ] uncompleted task, - [x] completed task) for action items and roadmaps.
- Use nested, bulleted list items for breakdown and detail.
- Use Obsidian-style Callout blocks to highlight key definitions, tips, warnings, or notes. Format them as:
  > [!NOTE]
  > Important note content here.
  
  > [!TIP]
  > Pro tip or recommended approach.
  
  > [!IMPORTANT]
  > Critical instructions or key takeaways.
  
  > [!WARNING]
  > Potential risks or caveats.
- Use beautifully formatted Markdown Tables for comparisons, structural data, and side-by-side analyses. Ensure clean spacing and proper header separation (e.g., | Topic | Pros | Cons |).
- Make sure notes feel like premium wiki entries, rich with deep structure, summaries, and logical layout. Avoid long walls of unstructured text.

10. EXPLICIT FILE MENTIONS & EDITS PROTOCOL (CRITICAL)
- The user can explicitly mention files in their input using [[Note Title]].
- If a note is explicitly mentioned, its full path and content will be provided in the user prompt under "EXPLICITLY MENTIONED FILE CONTEXTS".
- If the user asks to modify, rewrite, expand, simplify, add to, or rewrite/synthesize the mentioned note, you MUST choose the "update_note" action.
- You MUST use the EXACT file path of that note as provided in the "EXPLICITLY MENTIONED FILE CONTEXTS" (e.g. "Folder/Subfolder/Note.md" or "MyNotes/Note.md").
- Do NOT create a new note at the root (like "Note.md" or "Summary.md") if the user is asking to update or edit a note that is already in their vault. Always preserve the original file path.
- In "update_note", you must output the COMPLETE, beautifully structured markdown content of the updated note.

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

  // 1. Handle complete or incomplete code block starting with ```json or ```
  const codeBlockIndex = cleaned.indexOf("```");
  if (codeBlockIndex !== -1) {
    const nextCodeBlockIndex = cleaned.indexOf("```", codeBlockIndex + 3);
    if (nextCodeBlockIndex !== -1) {
      cleaned = cleaned.substring(0, codeBlockIndex) + cleaned.substring(nextCodeBlockIndex + 3);
      return stripJSONBlock(cleaned);
    } else {
      cleaned = cleaned.substring(0, codeBlockIndex);
    }
  }

  // 2. Also handle any raw JSON block { "action": ... } or { "intent": ... } complete or incomplete
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

// ── Retrieval ────────────────────────────────────────────────────────────────

export interface RetrievedChunk {
  chunk: SpaceChunk;
  similarity: number;
}

export async function retrieveChunks(
  spaceId: string,
  query: string,
  topK: number = TOP_K,
): Promise<RetrievedChunk[]> {
  const queryVector = await embedText(query);
  const results: RetrievedChunk[] = [];

  // 1. If cloud is available, try it first (unless it is a private E2EE space)
  let bypassCloud = false;
  try {
    const space = await getSpace(spaceId);
    if (space && space.visibility === "private") {
      bypassCloud = true;
    }
  } catch (err) {
    console.warn("[SpacesRAG] Failed to check space visibility:", err);
  }

  if (isSupabaseConfigured && !bypassCloud) {
    try {
      const { data: cloudChunks, error } = await supabase.rpc("match_note_chunks", {
        filter_space_id: spaceId,
        query_embedding: `[${queryVector.join(",")}]`,
        match_threshold: MIN_SIMILARITY,
        match_count: topK,
      });

      if (error) throw error;

      if (cloudChunks && cloudChunks.length > 0) {
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
        // If we got cloud results, we return them (they are more authoritative for shared spaces)
        if (results.length > 0) return results;
      }
    } catch (err) {
      console.warn("[SpacesRAG] Cloud retrieval failed, falling back to local:", err);
    }
  }

  // 2. Local Fallback (for local spaces or when offline)
  const index = await loadVectorIndex(spaceId);
  if (index && index.chunks.length > 0) {
    for (const chunk of index.chunks) {
      if (chunk.vector.length !== queryVector.length) continue;
      const sim = cosineSimilarity(queryVector, chunk.vector);
      if (sim > MIN_SIMILARITY) {
        results.push({ chunk, similarity: sim });
      }
    }
  }

  return results.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
}

// ── Prompt Construction ──────────────────────────────────────────────────────

function buildUserPrompt(
  query: string,
  chunks: RetrievedChunk[],
  explicitNotes?: { path: string; title: string; content: string }[],
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

  return `USER INPUT:\n${query}\n\nCONTEXT:\n${contextBlock}${explicitBlock}`;
}

// ── Query Result ─────────────────────────────────────────────────────────────

export interface RAGResult {
  answer: string;
  sources: { notePath: string; noteTitle: string; chunkText: string; similarity: number }[];
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
  const retrieved = await retrieveChunks(spaceId, cleanQuery);

  if (retrieved.length === 0 && (!meta.explicitNotes || meta.explicitNotes.length === 0)) {
    return {
      answer: "No relevant content found in this space. Try rephrasing or adding more notes to your vault.",
      sources: [],
    };
  }

  const systemPrompt = buildSystemPrompt(meta);
  const userPrompt = buildUserPrompt(query, retrieved, meta.explicitNotes);

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
    sources: retrieved.map((r) => ({
      notePath: r.chunk.notePath,
      noteTitle: r.chunk.noteTitle,
      chunkText: r.chunk.chunkText.substring(0, 200),
      similarity: r.similarity,
    })),
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
  const retrieved = await retrieveChunks(spaceId, cleanQuery);

  if (retrieved.length === 0 && (!meta.explicitNotes || meta.explicitNotes.length === 0)) {
    const msg = "No relevant content found in this space. Try rephrasing or adding more notes to your vault.";
    onChunk(msg);
    return { answer: msg, sources: [] };
  }

  const systemPrompt = buildSystemPrompt(meta);
  const userPrompt = buildUserPrompt(query, retrieved, meta.explicitNotes);

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

  const makeSources = () =>
    retrieved.map((r) => ({
      notePath: r.chunk.notePath,
      noteTitle: r.chunk.noteTitle,
      chunkText: r.chunk.chunkText.substring(0, 200),
      similarity: r.similarity,
    }));

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
