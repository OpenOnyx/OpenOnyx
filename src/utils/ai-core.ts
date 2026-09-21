/**
 * AI Core — Minimal, controlled LLM usage
 *
 * Storage: .openonyx/annotations.json (disk-backed, NOT localStorage)
 *
 * LLM is used ONLY for:
 *  1. Auto-annotation: 1-line per note (generated once, cached)
 *  2. Synthesis across multiple notes (on user request)
 *  3. RAG query answering (on user request)
 *
 * LLM does NOT: auto-modify notes, auto-create links, replace user thinking.
 * All outputs are cached. The system works fully without an API key.
 */

import { loadAIConfig, getBaseUrl, getProviderHeaders, parseProviderError } from "./ai-settings";
import { readData, writeData, createDebouncedWriter } from "./disk-store";
import { MERMAID_FORMATTING_RULES } from "./spaces-rag";

// ── Cache ────────────────────────────────────────────────────────────────────

interface AnnotationEntry {
  text: string;
  hash: string;
  createdAt: number;
}

interface SynthesisEntry {
  text: string;
  createdAt: number;
}

interface AICache {
  annotations: Record<string, AnnotationEntry>;
  syntheses: Record<string, SynthesisEntry>;
}

// In-memory cache
let _cache: AICache | null = null;
let _cacheLoaded = false;

const _debouncedSave = createDebouncedWriter(2000);

async function loadCache(): Promise<AICache> {
  if (_cache && _cacheLoaded) return _cache;

  // Try disk first
  const diskData = await readData<AICache>("annotations.json");
  if (diskData && diskData.annotations) {
    _cache = diskData;
    _cacheLoaded = true;
    return _cache;
  }

  // Migrate from localStorage if exists
  try {
    const raw = localStorage.getItem("openonyx-ai-cache-v2");
    if (raw) {
      _cache = JSON.parse(raw);
      _cacheLoaded = true;
      // Persist to disk and remove from localStorage
      await writeData("annotations.json", _cache);
      localStorage.removeItem("openonyx-ai-cache-v2");
      console.log("[AI Core] Migrated cache from localStorage to disk");
      return _cache!;
    }
  } catch { /* silent */ }

  _cache = { annotations: {}, syntheses: {} };
  _cacheLoaded = true;
  return _cache;
}

function loadCacheSync(): AICache {
  if (_cache) return _cache;
  // If not loaded yet, trigger async load and return empty
  loadCache();
  return _cache || { annotations: {}, syntheses: {} };
}

function saveCache(cache: AICache): void {
  _cache = cache;
  _debouncedSave("annotations.json", cache);
}

function simpleHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

// ── LLM call helper ─────────────────────────────────────────────────────────

async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 300,
  temperature = 0.2,
): Promise<string> {
  const config = loadAIConfig();
  if (!config) throw new Error("No API key configured.");

  const baseUrl = getBaseUrl(config);
  const requestBody = JSON.stringify({
    model: config.modelId,
    max_tokens: maxTokens,
    temperature,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  // Some providers occasionally return a successful response with an empty
  // choices array while warming up or switching models. Retry those transient
  // responses instead of making the user click Ask repeatedly.
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: getProviderHeaders(config),
      body: requestBody,
    });

    if (!response.ok) {
      throw new Error(await parseProviderError(response));
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim()) return content.trim();
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }

  throw new Error("The AI provider returned an empty response after several attempts. Please try again.");
}

export async function askAI(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 600,
  temperature = 0.3,
): Promise<string> {
  return callLLM(systemPrompt, userPrompt, maxTokens, temperature);
}


// ── Utility ──────────────────────────────────────────────────────────────────

function parseInsight(rawText: string): string {
  let text = rawText.trim();
  
  // 1. Try to parse JSON
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed && typeof parsed.insight === "string") return parsed.insight;
    } catch { /* ignore */ }
  }

  // 2. Strip surrounding quotes if the ENTIRE thing is wrapped in quotes
  if (text.startsWith('"') && text.endsWith('"') && text.length > 2) {
    text = text.slice(1, -1).trim();
  }

  // 3. Markers fallback (Try this before arbitrary quotes, because CoT markers are very reliable)
  const markers = [/(?:Let's craft:|Let's write:|Insight:|Core insight:|Output:)/i];
  for (const regex of markers) {
    const parts = text.split(regex);
    if (parts.length > 1) {
      let candidate = parts[parts.length - 1].trim();
      candidate = candidate.replace(/Count words:[\s\S]*$/i, "").trim();
      candidate = candidate.replace(/^"|"$/g, "").trim();
      if (candidate.length > 10) {
        return candidate;
      }
    }
  }

  // 4. Quotes fallback
  const quotes = [...text.matchAll(/"([^"]+)"/g)];
  const validQuotes = quotes.filter(q => q[1].length > 15 && q[1].toLowerCase() !== "insight");
  if (validQuotes.length > 0) return validQuotes[validQuotes.length - 1][1];

  return text;
}

// ── 1. Auto-annotation ──────────────────────────────────────────────────────

export async function getAnnotation(
  notePath: string,
  noteContent: string,
): Promise<string | null> {
  const cache = await loadCache();
  const hash = simpleHash(noteContent);

  const cached = cache.annotations[notePath];
  if (cached && cached.hash === hash) {
    return parseInsight(cached.text);
  }

  const config = loadAIConfig();
  if (!config) return null;

  try {
    const systemPrompt = `You are a subtle assistant in a knowledge management tool.
Generate ONE sentence (max 20 words) capturing the core insight of this note.
Be specific. No fluff. 
You MUST respond ONLY with a valid JSON object in this exact format:
{"insight": "your one sentence insight here"}`;

    const cleaned = noteContent.replace(/^---[\s\S]*?---\s*/m, "").trim();
    if (cleaned.length < 20) return null;

    const rawResponse = await callLLM(systemPrompt, cleaned.substring(0, 1500), 150);
    const text = parseInsight(rawResponse);

    cache.annotations[notePath] = { text, hash, createdAt: Date.now() };
    saveCache(cache);
    return text;
  } catch (err) {
    console.warn("[AI] Annotation failed:", err);
    return null;
  }
}

export function getCachedAnnotation(notePath: string): string | null {
  const cache = loadCacheSync();
  const raw = cache.annotations[notePath]?.text;
  if (!raw) return null;
  return parseInsight(raw);
}

// ── 2. Synthesis ────────────────────────────────────────────────────────────

export async function synthesizeNotes(
  notes: { title: string; content: string }[],
): Promise<string> {
  if (notes.length < 2) throw new Error("Need at least 2 notes.");

  const cacheKey = notes.map((n) => n.title).sort().join("|");
  const cache = await loadCache();
  const cached = cache.syntheses[cacheKey];
  if (cached) return cached.text;

  const systemPrompt = `You are a synthesis engine in a knowledge management tool.
Analyze these notes and produce a 3-5 sentence synthesis.
Focus on connections, tensions, and unexplored questions.
Be specific. No headers or formatting. Just the synthesis.`;

  const notesBlock = notes
    .map((n) => `--- ${n.title} ---\n${n.content.substring(0, 600)}`)
    .join("\n\n");

  const text = await callLLM(systemPrompt, notesBlock, 400, 0.3);

  cache.syntheses[cacheKey] = { text, createdAt: Date.now() };
  saveCache(cache);
  return text;
}

// ── 3. RAG Query ────────────────────────────────────────────────────────────

export async function queryRAG(
  question: string,
  relevantNotes: { title: string; content: string; similarity: number }[],
): Promise<{ answer: string; sources: string[] }> {
  if (relevantNotes.length === 0) {
    return {
      answer: "No relevant notes found. Try rephrasing or adding more notes.",
      sources: [],
    };
  }

  const systemPrompt = `You are a knowledge assistant for a note-taking tool.
Answer based ONLY on the provided notes.
Reference notes by name. Keep concise (3-6 sentences).
If information is insufficient, say so. Reply with ONLY the answer.
Use clean markdown formatting. If the user requests a diagram, follow these rules:
${MERMAID_FORMATTING_RULES}`;

  const notesBlock = relevantNotes
    .map((n) => `[${n.title}] (${Math.round(n.similarity * 100)}%)\n${n.content.substring(0, 800)}`)
    .join("\n\n---\n\n");

  const answer = await callLLM(
    systemPrompt,
    `Question: ${question}\n\n--- Notes ---\n\n${notesBlock}`,
    2048,
    0.2,
  );

  return { answer, sources: relevantNotes.map((n) => n.title) };
}

// ── Utility ──────────────────────────────────────────────────────────────────

export function isAIConfigured(): boolean {
  return loadAIConfig() !== null;
}

// ── 4. Smart Expansion (First Thought) ───────────────────────────────────────

export interface AIContinuation {
  type: "action" | "clarity" | "insight";
  text: string;
  structure: string;
}

export interface AIFirstThoughtExpansionPlan {
  continuations: [AIContinuation, AIContinuation, AIContinuation];
}

export async function generateFirstThoughtExpansion(
  userThought: string,
): Promise<AIFirstThoughtExpansionPlan | null> {
  const config = loadAIConfig();
  if (!config) return null;

  try {
    const systemPrompt = `GOAL:
Extend the user's thought into something more useful, specific, and insightful.

This is NOT a template generator. This is NOT a formatting tool. This is a thinking partner.
You must help the user think better — not just organize text.

---

INPUT:
User will provide a single thought (can be vague, emotional, or incomplete).

---

OUTPUT:
Return EXACTLY 3 continuations in JSON format.

Each continuation must include:
- type: "action" | "clarity" | "insight"
- text: short, natural continuation (1–2 lines max)
- structure: a structured markdown expansion derived from the text

---

STRICT RULES:

1. ALWAYS be context-specific
- Directly reference the user's topic
- Never give generic advice

Bad: "Start with basics"
Good: "Start with Python and build small scripts like a calculator or file organizer"

---

2. NEVER generate generic productivity phrases

BANNED:
- "Break this into steps"
- "Make a plan"
- "Define your goal"
- "Start with fundamentals"
- "Be consistent"
- "Set milestones"
- "Explore this further"

If your output matches any of these patterns → REWRITE.

---

3. EACH continuation must feel DIFFERENT

You must generate:

(ACTION) → A concrete next move
(CLARITY) → Make the thought more specific or defined
(INSIGHT) → A non-obvious idea, mistake, or reframing

---

4. FORCE SPECIFICITY

Every continuation must include at least ONE of:
- a real-world example
- a constraint
- a comparison
- a mistake to avoid

---

5. ANTI-BORING CHECK (MANDATORY)

Before returning, validate:
- Could this apply to 50+ different topics?
- Does this feel obvious?

If YES → rewrite with more specificity and depth.

---

6. HANDLE ALL VALID INPUTS

Expand ANY meaningful thought, including:
- goals → "I want to learn coding"
- feelings → "I feel stuck"
- casual → "I love swimming"
- messy → "I want to sleep but also work"

DO NOT expand (return {"continuations":[]} for):
- greeting ("hi")
- identity ("my name is x")

---

7. STRUCTURE GENERATION RULE

The structure MUST be derived from the meaning of the continuation.

NOT generic headings like:
❌ "## Steps"
❌ "## Plan"

Instead:
✔ compress the idea into a natural heading

Example:
Text: "Start with Python and build small tools"
Structure:
## Start with Python
- Build simple tools like calculator or file organizer
- Avoid only watching tutorials — write code from day one

---

8. KEEP IT HUMAN
- Natural language only
- No robotic phrasing
- No quotes around user input
- No repeating input awkwardly

---

OUTPUT FORMAT:
Return ONLY valid JSON:
{
  "continuations": [
    {
      "type": "action",
      "text": "...",
      "structure": "## ...\\n- ...\\n- ..."
    },
    {
      "type": "clarity",
      "text": "...",
      "structure": "## ...\\n- ...\\n- ..."
    },
    {
      "type": "insight",
      "text": "...",
      "structure": "## ...\\n- ...\\n- ..."
    }
  ]
}`;

    const text = await callLLM(systemPrompt, userThought, 800, 0.4);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    
    const parsed = JSON.parse(match[0]);
    if (!parsed.continuations || parsed.continuations.length !== 3) return null;
    
    return parsed as AIFirstThoughtExpansionPlan;
  } catch (err) {
    console.warn("[AI] Smart expansion failed:", err);
    return null;
  }
}
