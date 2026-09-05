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

import { embedText, isModelLoaded, isLexicalFallbackActive } from "./embeddings";
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

// ── Shared Mermaid Formatting Rules ──────────────────────────────────────────
// Exported so that all AI systems (Space RAG, inline vault chat, AI Core) share
// identical Mermaid diagram generation guidance.

export const MERMAID_FORMATTING_RULES = `
MERMAID DIAGRAM RULES & ADVANCED SYNTAX GUIDE (STRICT -- follow every rule exactly):

1. GENERAL SYNTAX RULES:
   - Wrap diagrams in a standard markdown fenced code block with the "mermaid" language identifier (\`\`\`mermaid ... \`\`\`).
   - Use ONLY standard arrow connectors for flowcharts: "-->" for directed edges, "---" for undirected edges. NEVER use "->" in flowcharts.
   - Use actual physical newlines between statements. NEVER output escaped newline strings like literal "\\n".
   - ALWAYS quote ALL node labels using double quotes (e.g. A["Label Text"] or B("Initialize")).
   - NEVER use literal brackets [ ], angle brackets < >, or braces { } INSIDE a node label. Use words or Mermaid entity escapes (#91; for [, #93; for ], #60; for <, #62; for >).
   - Line breaks inside labels MUST use <br/> tag.

2. SUBGRAPHS & LARGE DIAGRAMS:
   - Use simple alphanumeric IDs for subgraphs (e.g. subgraph sub1 ["Category Title"]). NEVER use spaces or special characters in subgraph IDs.
   - Keep total node count under 30 per flowchart. For mindmaps, limit tree depth to 3 levels and a maximum of 35 core topics. For larger sets, group topics into high-level categories or output multiple separate diagrams.

3. ADVANCED DIAGRAM TYPES & TEMPLATES:

   A) FLOWCHARTS (graph TD / graph LR):
      \`\`\`mermaid
      graph TD
        subgraph sub1 ["Input Phase"]
          A["Raw Data"] --> B["Data Cleaner"]
        end
        subgraph sub2 ["Processing Phase"]
          B --> C{"Is Valid?"}
          C -- "Yes" --> D["Process Item"]
          C -- "No" --> E["Log Error"]
        end
      \`\`\`

   B) SEQUENCE DIAGRAMS (sequenceDiagram):
      \`\`\`mermaid
      sequenceDiagram
        autonumber
        actor User as "Client User"
        participant API as "API Gateway"
        participant Auth as "Auth Service"
        participant DB as "Database"

        User->>API: POST /login
        activate API
        API->>Auth: Validate Credentials
        activate Auth
        Auth->>DB: Query User Record
        DB-->>Auth: User Record Found
        Auth-->>API: JWT Token Issued
        deactivate Auth
        API-->>User: 200 OK (Token)
        deactivate API

        opt Refresh Token
          User->>API: POST /refresh
          API-->>User: New Token
        end
      \`\`\`

   C) CLASS DIAGRAMS (classDiagram):
      \`\`\`mermaid
      classDiagram
        class Animal {
          +String name
          +int age
          +makeSound() void
        }
        class Dog {
          +String breed
          +bark() void
        }
        class Owner {
          +String ownerId
          +adopt(Animal a) void
        }
        Animal <|-- Dog : Inherits
        Owner "1" o-- "many" Animal : Owns
      \`\`\`

   D) STATE DIAGRAMS (stateDiagram-v2):
      \`\`\`mermaid
      stateDiagram-v2
        [*] --> Idle
        Idle --> Processing : Event Triggered
        state Processing {
          [*] --> Step1
          Step1 --> Step2 : Complete
          Step2 --> [*]
        }
        Processing --> Success : Done
        Processing --> Failed : Error
        Failed --> Idle : Retry
        Success --> [*]
      \`\`\`

   E) ENTITY RELATIONSHIP DIAGRAMS (erDiagram):
      \`\`\`mermaid
      erDiagram
        CUSTOMER ||--o{ ORDER : places
        ORDER ||--|{ LINE-ITEM : contains
        CUSTOMER {
          string id PK
          string name
          string email
        }
        ORDER {
          int order_id PK
          string customer_id FK
          date order_date
        }
      \`\`\`

   F) MINDMAPS (mindmap):
      \`\`\`mermaid
      mindmap
        root((System Design))
          Architecture
            Monolith
            Microservices
            Event-Driven
          Storage
            SQL Databases
            NoSQL Databases
            Caching Systems
      \`\`\`

   G) GANTT CHARTS (gantt):
      \`\`\`mermaid
      gantt
        title Project Roadmap
        dateFormat YYYY-MM-DD
        section Research
          Literature Review :done, r1, 2024-01-01, 2024-01-15
          Architecture Specs :active, r2, 2024-01-15, 2024-01-31
        section Implementation
          Core API Development :crit, i1, 2024-02-01, 30d
      \`\`\`

   H) PIE CHARTS (pie):
      \`\`\`mermaid
      pie title Memory Allocation
        "Heap Memory" : 45
        "Stack Memory" : 25
        "Cache / Buffers" : 20
        "Reserved" : 10
      \`\`\`

   I) GITGRAPH DIAGRAMS (gitGraph):
      \`\`\`mermaid
      gitGraph
        commit id: "Initial Commit"
        branch feature
        checkout feature
        commit id: "Feature Work 1"
        commit id: "Feature Work 2"
        checkout main
        merge feature id: "Merge Feature"
        commit id: "Release 1.0"
      \`\`\`
`;

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

B) ACTION QUERY — The user EXPLICITLY asks to create, write, generate, update, edit, rewrite, expand, simplify, link, organize, restructure, or summarize notes INTO their vault.
   Examples: "create a note about X", "generate 5 notes about Y", "create a set of journal notes", "rewrite [[MyNote]]", "link orphan notes", "organize my vault", "add this to my notes"
   Response: Output ONLY a structured JSON action block (see schema below) enclosed in a \`\`\`json ... \`\`\` block. Do NOT include any other text, conversational responses, explanations, reasoning, or thoughts before or after the JSON block. Your entire response must be ONLY the JSON block.

DEFAULT RULE: If the intent is ambiguous or unclear, ALWAYS treat it as a KNOWLEDGE QUERY.
Never propose file edits unless the user explicitly requests vault modification.
Asking about a topic is NOT the same as asking to create a note about that topic.

For ACTION QUERIES ONLY, output ONLY a structured JSON payload enclosed in a \`\`\`json ... \`\`\` block. Do NOT include any explanation, conversational text, or thoughts outside the JSON block. Never use emojis in titles, paths, or contents.

Always follow this exact schema for action payloads:
{
  "intent": "create_note" | "update_note" | "multi_action",
  "summary": "Short explanation of what you plan to do",
  "actions": [
    // Array of actions. For single or batch note creation (use "multi_action" intent when creating 2 or more notes):
    {
      "type": "create_note",
      "title": "Title of Note",
      "path": "folder/path/", // folder path or file path (e.g. "Journal/" or "Narratives/People/")
      "content": "Full markdown content of the note"
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

BATCH NOTE CREATION & NARRATIVE JOURNALING RULES:
- When the user asks to create multiple notes (e.g. "create 5 notes", "create a series of journal notes", "create stories and character notes", "generate notes based on X"):
  - Set "intent": "multi_action".
  - Populate "actions" with an entry for EACH note to be created.
  - Specify the appropriate subfolder in "path" (e.g. "Journal/", "Stories/", "Characters/", "Incidents/", or the folder requested by the user).
  - Each note must be complete, detailed, and fully fleshed out with vivid, realistic content. Never write placeholder or truncated text like "...continue here" or "TODO".
  - If generating stories, diaries, or journals, write with authentic, natural voice, grounded dates, realistic human dialogue, and concrete everyday details.
  - Interconnect notes semantically: share characters, recurring locations, themes, and events across the notes so they naturally form meaningful clusters in the knowledge graph.

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
- For "update_note", choose the right option based on scope:
  - Use Option A ("before" + "after" with COMPLETE file content) when adding new content blocks, rewriting sections, adding diagrams, or making changes that span multiple sections of the file. You MUST include the COMPLETE file content in BOTH "before" and "after" — not just the changed sections.
  - Use Option B ("search" + "replace") ONLY for small, targeted edits like adding a wiki link, fixing a typo, or changing a single line.
- You must output ONLY the JSON block. Do NOT include any conversational text or explanations outside the JSON block.`;

  return `You are the intelligent knowledge manager for this space.

CRITICAL DIRECTIVE ON THINKING & REASONING (STRICT):
- Do NOT output your internal chain-of-thought, reasoning steps, or prompt analysis (such as "We are given explicit file context...", "Looking at the context...", "Let me check...", or "Steps...").
- For ACTION QUERIES (creating, updating, or rewriting notes), your output must contain ONLY the JSON action block and NOTHING else.
- For KNOWLEDGE QUERIES, output only the direct conversational response without any meta-commentary or reasoning logs.

SPACE IDENTITY:
  title: ${meta.title}
  description: ${meta.description}${helpsLine}

---

CORE RULES:

0. NO REASONING OR META-TEXT OUTPUT (STRICT)
Never output internal reasoning, step-by-step evaluation, or meta-commentary about the user query or context.

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
  - Use Obsidian-style Callout blocks to highlight key definitions, tips, warnings, or notes. Format them as:
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
${MERMAID_FORMATTING_RULES}
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

function tryRepairPartialJSON(rawText: string): any {
  if (!rawText) return null;

  const suffixesToTry = [
    '"}]}',
    '"}}',
    '"]}',
    '"}',
    '}}',
    '}',
    ']}',
  ];

  for (const suffix of suffixesToTry) {
    try {
      const candidate = rawText.trim() + suffix;
      const parsed = JSON.parse(candidate);
      if (parsed && (parsed.intent || parsed.action || parsed.type || parsed.actions)) {
        return parsed;
      }
    } catch {
      // Continue
    }
  }

  const typeMatch = rawText.match(/"type"\s*:\s*"([^"]+)"/);
  const pathMatch = rawText.match(/"(?:file_path|path)"\s*:\s*"([^"]+)"/);
  const titleMatch = rawText.match(/"title"\s*:\s*"([^"]+)"/);
  
  const extractedType = typeMatch?.[1];
  const unescapeStr = (str?: string) => str ? str.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, '\\') : "";

  if (extractedType === "update_note" || rawText.includes('"file_path"')) {
    const searchMatch = rawText.match(/"search"\s*:\s*"((?:[^"\\]|\\.)*)/);
    const replaceMatch = rawText.match(/"replace"\s*:\s*"((?:[^"\\]|\\.)*)/);
    const beforeMatch = rawText.match(/"before"\s*:\s*"((?:[^"\\]|\\.)*)/);
    const afterMatch = rawText.match(/"after"\s*:\s*"((?:[^"\\]|\\.)*)/);
    const contentMatch = rawText.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)/);

    return {
      type: "update_note",
      file_path: pathMatch?.[1] || "",
      changes: {
        search: unescapeStr(searchMatch?.[1]),
        replace: unescapeStr(replaceMatch?.[1]),
        before: unescapeStr(beforeMatch?.[1]),
        after: unescapeStr(afterMatch?.[1] || contentMatch?.[1])
      }
    };
  } else if (extractedType === "create_note") {
    const contentMatch = rawText.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)/);
    return {
      type: "create_note",
      title: titleMatch?.[1] || "",
      path: pathMatch?.[1] || "",
      content: unescapeStr(contentMatch?.[1])
    };
  }

  return null;
}

export function parseActionPayload(text: string): any {
  if (!text) return null;
  const trimmed = text.trim();

  // 1. Try Code Block Regex matching
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
  const match = trimmed.match(codeBlockRegex);
  if (match) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed && (parsed.intent || parsed.action || parsed.type || parsed.actions)) return parsed;
    } catch {
      const repaired = tryRepairPartialJSON(match[1].trim());
      if (repaired) return repaired;
    }
  }

  // 2. Try raw JSON matching (searching for first '{' and last '}')
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1) {
    const rawCandidate = lastBrace > firstBrace
      ? trimmed.substring(firstBrace, lastBrace + 1)
      : trimmed.substring(firstBrace);
    try {
      const parsed = JSON.parse(rawCandidate);
      if (parsed && (parsed.intent || parsed.action || parsed.type || parsed.actions)) return parsed;
    } catch {
      const repaired = tryRepairPartialJSON(rawCandidate);
      if (repaired) return repaired;
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

  // Helper to check if a block content matches action indicators
  const isActionContent = (content: string) => {
    const normalized = content.replace(/\s/g, "");
    return normalized.includes('"intent"') ||
           normalized.includes('"action"') ||
           normalized.includes('"actions"') ||
           normalized.includes('"type":"create_note"') ||
           normalized.includes('"type":"update_note"') ||
           normalized.includes('"type":"suggest_structure"') ||
           normalized.includes('"type":"suggest_links"') ||
           normalized.includes('"type":"insight_report"') ||
           normalized.includes("'intent'") ||
           normalized.includes("'action'") ||
           normalized.includes("'actions'") ||
           normalized.includes("'type':'create_note'") ||
           normalized.includes("'type':'update_note'") ||
           normalized.includes("'type':'suggest_structure'") ||
           normalized.includes("'type':'suggest_links'") ||
           normalized.includes("'type':'insight_report'");
  };

  // 1. Strip only fenced code blocks that contain JSON action payloads.
  //    Preserve legitimate code blocks (python, javascript, etc.)
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
  cleaned = cleaned.replace(codeBlockRegex, (fullMatch, blockContent) => {
    if (isActionContent(blockContent)) return "";
    return fullMatch;
  });

  // 2. Handle incomplete/streaming JSON action blocks (no closing ```)
  //    Only strip if the open fence is followed by json-like action content
  const incompleteBlockIndex = cleaned.indexOf("```");
  if (incompleteBlockIndex !== -1) {
    const afterFence = cleaned.substring(incompleteBlockIndex + 3);
    const looksLikeActionBlock = /^\s*(?:json)?\s*\{/.test(afterFence) && isActionContent(afterFence);
    if (looksLikeActionBlock) {
      cleaned = cleaned.substring(0, incompleteBlockIndex);
    }
  }

  // 3. Also handle any raw JSON block not inside a code fence
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace !== -1) {
    const candidate = cleaned.substring(firstBrace);
    if (isActionContent(candidate)) {
      // It is an action payload block! Strip everything from the first brace to the end.
      cleaned = cleaned.substring(0, firstBrace);
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

export function mapCloudRpcChunk(
  rc: {
    id: string;
    note_title?: string;
    content?: string;
    similarity?: number;
    path?: string;
    note_path?: string;
    notePath?: string;
  },
  spaceId: string,
): RetrievedChunk {
  const notePath = rc.path || rc.note_path || rc.notePath || "";
  return {
    chunk: {
      id: rc.id,
      spaceId,
      notePath,
      noteTitle: rc.note_title || "Unknown Note",
      chunkText: rc.content || "",
      vector: [],
      startOffset: 0,
      endOffset: 0,
    },
    similarity: rc.similarity ?? 0,
  };
}

export function isComprehensiveSpaceQuery(query: string): boolean {

  const normalized = query.trim().toLowerCase();
  if (!normalized) return false;

  const overviewQuery = /\b(what'?s|what is|tell me|summari[sz]e|overview|about|inside|contain|contents?|vault|space|knowledge base|notes?)\b/.test(normalized) &&
    /\b(vault|space|knowledge base|notes?|contents?|about|overview)\b/.test(normalized);

  const wholeVaultTask = /\b(all|entire|whole|every|everything|full|complete|comprehensive|vault-wide|space-wide|huge|large)\b/.test(normalized) &&
    /\b(vault|space|knowledge base|notes?|files?|folders?|index|organize|summari[sz]e|analy[sz]e|find|review|map|connect|link|merge|cluster)\b/.test(normalized);

  return overviewQuery || wholeVaultTask;
}

export function getTopLevelFolder(notePath: string): string {
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
): Promise<RetrievedChunk[] & { isLexicalFallback?: boolean }> {
  console.log("[SpacesRAG] retrieveChunks called for space:", spaceId, "query:", query);
  
  let queryVector: number[] | null = null;
  let isLexicalFallback = isLexicalFallbackActive();
  try {
    const embedded = await embedText(query);
    if (isModelLoaded() && !isLexicalFallback) {
      queryVector = embedded.some((value) => value !== 0) ? embedded : null;
      console.log("[SpacesRAG] Generated semantic query vector. Length:", queryVector?.length);
    } else {
      isLexicalFallback = true;
      console.log("[SpacesRAG] Local model not loaded or lexical fallback active, skipping semantic query vector generation.");
    }
  } catch (err) {
    isLexicalFallback = true;
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
          results.push(mapCloudRpcChunk(rc, spaceId));
        }
        
        const finalChunks = options?.diversify
          ? diversifyRetrievedChunks(results, topK)
          : results;
        return Object.assign(finalChunks, { isLexicalFallback: isLexicalFallback || !queryVector });
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
      const notePathMap: Record<string, string> = {};
      const noteIds: string[] = [];
      const decryptedNotes: { id: string; title: string; path: string; content: string }[] = [];

      if (notesData) {
        for (const n of notesData as any[]) {
          noteTitleMap[n.id] = n.title;
          notePathMap[n.id] = n.path || "";
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
            path: n.path || "",
            content: decryptedContent,
          });
        }
      }

      if (noteIds.length > 0) {
        console.log(`[SpacesRAG] Cloud lexical fallback: querying note_chunks via inner join on notes...`);
        const { data, error } = await supabase
          .from("note_chunks" as any)
          .select("id, note_id, content, notes!inner(space_id, path, deleted)")
          .eq("notes.space_id", spaceId)
          .eq("notes.deleted", false);

        if (error) throw error;

        const cloudChunks = data as any[] | null;
        if (cloudChunks && cloudChunks.length > 0) {
          console.log(`[SpacesRAG] Cloud database lexical fallback fetched ${cloudChunks.length} chunks. Scoring...`);
          const queryTerms = tokenizeQuery(query);
          for (const rc of cloudChunks) {
            const notePath = ((rc as any).notes && typeof (rc as any).notes === "object" ? (rc as any).notes.path : "") || notePathMap[rc.note_id] || "";
            const mockChunk = {
              id: rc.id,
              spaceId,
              notePath,
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
                notePath: n.path || "",
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
  const selected = options?.diversify
    ? diversifyRetrievedChunks(ranked, topK)
    : ranked.slice(0, topK);
  return Object.assign(selected, { isLexicalFallback: isLexicalFallback || !queryVector });
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
  isLexicalFallback?: boolean;
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

  const isLexicalFallback = Boolean(retrieved.isLexicalFallback ?? isLexicalFallbackActive());

  if (retrieved.length === 0 && (!meta.explicitNotes || meta.explicitNotes.length === 0)) {
    return {
      answer: "No relevant content found in this space. Try rephrasing or adding more notes to your vault.",
      sources: [],
      isLexicalFallback,
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
      max_tokens: 8192,
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
    isLexicalFallback,
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

  const isLexicalFallback = Boolean(retrieved.isLexicalFallback ?? isLexicalFallbackActive());

  if (retrieved.length === 0 && (!meta.explicitNotes || meta.explicitNotes.length === 0)) {
    const msg = "No relevant content found in this space. Try rephrasing or adding more notes to your vault.";
    onChunk(msg);
    return { answer: msg, sources: [], isLexicalFallback };
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
      max_tokens: 8192,
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
    return { answer, sources: makeSources(), isLexicalFallback };
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

  return { answer: fullAnswer, sources: makeSources(), isLexicalFallback };
}
