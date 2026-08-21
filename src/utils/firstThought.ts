export const FIRST_THOUGHT_PROMPTS = [
  "A random thought...",
  "Something you're trying to figure out...",
  "An idea you had today...",
  "A problem you're stuck on...",
  "Something you've been thinking about...",
];

export const FIRST_THOUGHT_GHOST_EXAMPLES = [
  "I want to build something but don't know where to start",
  "Why do I procrastinate even when I care?",
  "Learning feels scattered lately",
];

export const FIRST_THOUGHT_EXPANSION_IDLE_MS = 700;

export const randomInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

export type FirstThoughtExpandableIntent =
  | "goal"
  | "problem"
  | "idea"
  | "confusion"
  | "reflection";

export type FirstThoughtNonExpandableIntent =
  | "identity"
  | "factual"
  | "greeting"
  | "too_short"
  | "unknown";

export type FirstThoughtIntentClassification =
  | {
      kind: "expandable";
      intent: FirstThoughtExpandableIntent;
      semantic: FirstThoughtSemanticIntent;
    }
  | {
      kind: "non_expandable";
      intent: FirstThoughtNonExpandableIntent;
    };

export type FirstThoughtIntentType =
  | "learn"
  | "build"
  | "social"
  | "reflect"
  | "plan"
  | "problem";

export type FirstThoughtContext = {
  knownSkills: string[];
  constraints: string[];
  timeframe: string | null;
  audience: string | null;
};

export type FirstThoughtSemanticIntent = {
  intentType: FirstThoughtIntentType;
  topic: string | null;
  context: FirstThoughtContext;
  clarityScore: number;
  signals: {
    hasVagueSignal: boolean;
    hasSpecificTopicSignal: boolean;
  };
};

export type FirstThoughtTemplate = {
  label: string;
  template: string;
};

export type FirstThoughtExpansionPlan = {
  intent: FirstThoughtExpandableIntent;
  suggestions: FirstThoughtTemplate[];
};

export const TRANSITION_STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "while", "where",
  "when", "then", "have", "has", "was", "were", "your", "about", "note", "notes",
  "list", "task", "item", "section", "idea", "project", "daily",
]);

const FIRST_THOUGHT_MIN_MEANINGFUL_WORDS = 2;

export function getMeaningfulWordCount(value: string): number {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.trim().length > 2 && !TRANSITION_STOP_WORDS.has(token)).length;
}

export function normalizeFirstThoughtDraft(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.?!,;:]+$/, "")
    .trim();
}

export function inferTopic(normalized: string): string | null {
  // Common prefixes to strip
  const prefixes = [
    /^(?:i\s+want\s+to\s+learn\s+about|i\s+need\s+to\s+learn|how\s+to\s+learn|learn)\s+(.+)$/,
    /^(?:i\s+want\s+to\s+build|i\s+need\s+to\s+build|how\s+to\s+build|build)\s+(.+)$/,
    /^(?:i\s+want\s+to\s+design|i\s+need\s+to\s+design|how\s+to\s+design|design)\s+(.+)$/,
    /^(?:i\s+want\s+to\s+make|i\s+need\s+to\s+make|how\s+to\s+make|make)\s+(.+)$/,
    /^(?:i\s+want\s+to\s+create|i\s+need\s+to\s+create|how\s+to\s+create|create)\s+(.+)$/,
    /^(?:i\s+can'?t\s+seem\s+to\s+figure\s+out|i\s+can'?t\s+figure\s+out|how\s+to\s+figure\s+out|figure\s+out)\s+(.+)$/,
    /^(?:i\s+am\s+confused\s+about|i'm\s+confused\s+about|confused\s+about|confusion\s+about)\s+(.+)$/,
    /^(?:i\s+feel\s+stuck\s+on|i'm\s+stuck\s+on|stuck\s+on)\s+(.+)$/,
    /^(?:i\s+struggle\s+with|i\s+struggle\s+to)\s+(.+)$/,
    /^(?:how\s+do\s+i|how\s+can\s+i)\s+(.+)$/,
    /^(?:why\s+does|why\s+is|why)\s+(.+)$/,
    /^(?:i\s+feel|i\s+think)\s+(.+)$/,
    /^(?:i\s+love|i\s+like|i\s+enjoy)\s+(.+)$/,
    /^(?:what\s+if)\s+(.+)$/,
  ];

  for (const regex of prefixes) {
    const match = normalized.match(regex);
    if (match && match[1]) {
      const candidate = match[1].trim();
      if (candidate.length > 2) return candidate;
    }
  }

  // Fallback: extract first 2-3 meaningful words
  const words = normalized
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, "").trim())
    .filter((w) => w.length > 2 && !TRANSITION_STOP_WORDS.has(w));

  if (words.length > 0) {
    return words.slice(0, 3).join(" ");
  }

  return null;
}

export function inferFirstThoughtSemanticIntent(
  normalized: string,
  baseType: FirstThoughtIntentType,
): FirstThoughtSemanticIntent {
  const topic = inferTopic(normalized);
  
  // Extract contextual signals
  const knownSkills: string[] = [];
  if (/\b(javascript|python|rust|coding|programming|react|typescript)\b/.test(normalized)) {
    knownSkills.push("technical");
  }
  if (/\b(writing|design|drawing|art|music)\b/.test(normalized)) {
    knownSkills.push("creative");
  }

  const constraints: string[] = [];
  if (/\b(busy|no\s+time|limited\s+time|schedule)\b/.test(normalized)) {
    constraints.push("time");
  }
  if (/\b(hard|difficult|complex|advanced)\b/.test(normalized)) {
    constraints.push("difficulty");
  }

  let timeframe: string | null = null;
  if (/\b(today|tonight|this\s+week|tomorrow)\b/.test(normalized)) {
    timeframe = "immediate";
  } else if (/\b(month|year|long\s+term)\b/.test(normalized)) {
    timeframe = "long_term";
  }

  let audience: string | null = null;
  if (/\b(users|people|audience|customers|clients)\b/.test(normalized)) {
    audience = "external";
  } else if (/\b(myself|personal|private|just\s+me)\b/.test(normalized)) {
    audience = "self";
  }

  const vagueSignals = [
    /\b(something|someday|maybe|idk|not\s+sure|dunno)\b/,
    /\b(somehow|kind\s+of|sort\s+of)\b/,
  ];
  const hasVagueSignal = vagueSignals.some((rx) => rx.test(normalized));
  const hasSpecificTopicSignal = topic !== null && topic.split(/\s+/).length >= 2;

  let clarityScore = 0.5;
  if (hasSpecificTopicSignal) clarityScore += 0.25;
  if (hasVagueSignal) clarityScore -= 0.2;
  if (knownSkills.length > 0 || constraints.length > 0) clarityScore += 0.15;
  clarityScore = Math.max(0.1, Math.min(1.0, clarityScore));

  return {
    intentType: baseType,
    topic,
    context: {
      knownSkills,
      constraints,
      timeframe,
      audience,
    },
    clarityScore,
    signals: {
      hasVagueSignal,
      hasSpecificTopicSignal,
    },
  };
}

export function classifyFirstThoughtIntent(value: string): FirstThoughtIntentClassification {
  const normalized = normalizeFirstThoughtDraft(value);
  if (!normalized) return { kind: "non_expandable", intent: "unknown" };

  // Strict identity/greeting classification to prevent expansion modal for tiny social cues
  const greetings = /^(?:hello|hi|hey|greetings|yo|sup|good\s+morning|good\s+afternoon|good\s+evening)\b/;
  if (greetings.test(normalized)) {
    return { kind: "non_expandable", intent: "greeting" };
  }

  const simpleFactualQuestions = /^(?:what\s+is\s+the\s+capital\s+of|who\s+wrote|when\s+did|how\s+many)\b/;
  if (simpleFactualQuestions.test(normalized)) {
    return { kind: "non_expandable", intent: "factual" };
  }

  const identityQuestions = /^(?:who\s+are\s+you|what\s+is\s+your\s+name|are\s+you\s+an\s+ai)\b/;
  if (identityQuestions.test(normalized)) {
    return { kind: "non_expandable", intent: "identity" };
  }

  // Expansion intent matching
  let match = normalized.match(
    /^(?:i\s+want\s+to\s+learn\s+about|i\s+need\s+to\s+learn|how\s+to\s+learn|learn\s+about)\s+(.+)$/,
  );
  if (match) {
    return {
      kind: "expandable",
      intent: "goal",
      semantic: inferFirstThoughtSemanticIntent(normalized, "learn"),
    };
  }

  match = normalized.match(
    /^(?:i\s+want\s+to\s+build|i\s+need\s+to\s+build|how\s+to\s+build|build)\s+(.+)$/,
  );
  if (match) {
    return {
      kind: "expandable",
      intent: "idea",
      semantic: inferFirstThoughtSemanticIntent(normalized, "build"),
    };
  }

  match = normalized.match(
    /^(?:i\s+want\s+to\s+design|i\s+need\s+to\s+design|how\s+to\s+design|design)\s+(.+)$/,
  );
  if (match) {
    return {
      kind: "expandable",
      intent: "idea",
      semantic: inferFirstThoughtSemanticIntent(normalized, "build"),
    };
  }

  match = normalized.match(
    /^(?:i\s+want\s+to\s+make|i\s+need\s+to\s+make|how\s+to\s+make|make)\s+(.+)$/,
  );
  if (match) {
    return {
      kind: "expandable",
      intent: "idea",
      semantic: inferFirstThoughtSemanticIntent(normalized, "build"),
    };
  }

  match = normalized.match(
    /^(?:i\s+want\s+to\s+create|i\s+need\s+to\s+create|how\s+to\s+create|create)\s+(.+)$/,
  );
  if (match) {
    return {
      kind: "expandable",
      intent: "idea",
      semantic: inferFirstThoughtSemanticIntent(normalized, "build"),
    };
  }

  match = normalized.match(
    /^(?:i\s+can'?t\s+seem\s+to\s+figure\s+out|i\s+can'?t\s+figure\s+out|how\s+to\s+figure\s+out|figure\s+out)\s+(.+)$/,
  );
  if (match) {
    return {
      kind: "expandable",
      intent: "confusion",
      semantic: inferFirstThoughtSemanticIntent(normalized, "problem"),
    };
  }

  match = normalized.match(
    /^(?:i\s+am\s+confused\s+about|i'm\s+confused\s+about|confused\s+about|confusion\s+about)\s+(.+)$/,
  );
  if (match) {
    return {
      kind: "expandable",
      intent: "confusion",
      semantic: inferFirstThoughtSemanticIntent(normalized, "problem"),
    };
  }

  match = normalized.match(/^(?:i\s+feel\s+stuck\s+on|i'm\s+stuck\s+on|stuck\s+on)\s+(.+)$/);
  if (match) {
    return {
      kind: "expandable",
      intent: "problem",
      semantic: inferFirstThoughtSemanticIntent(normalized, "problem"),
    };
  }

  const socialKeywords = [
    /\b(friend|colleague|partner|boss|manager|team|family|talk\s+to|meet\s+with)\b/,
    /\b(relationship|conversation|argument|disagreement|cooperation)\b/,
  ];
  const hasSocialIntent = socialKeywords.some((rx) => rx.test(normalized));

  match = normalized.match(
    /^(?:i\s+need\s+to\s+talk\s+to|i\s+want\s+to\s+talk\s+to|i\s+need\s+to\s+meet\s+with|i\s+want\s+to\s+meet\s+with)\s+(.+)$/,
  );
  if (match) {
    return {
      kind: "expandable",
      intent: "goal",
      semantic: inferFirstThoughtSemanticIntent(normalized, "social"),
    };
  }

  match = normalized.match(
    /^(?:i\s+can'?t|i\s+cannot|i\s+struggle\s+with|i\s+struggle\s+to|i\s+am\s+stuck\s+with)\s+(.+)$/,
  );
  if (match) {
    return {
      kind: "expandable",
      intent: "problem",
      semantic: inferFirstThoughtSemanticIntent(normalized, "problem"),
    };
  }

  if (/\b(stuck|blocked|overwhelmed|confused)\b/.test(normalized)) {
    return {
      kind: "expandable",
      intent: "problem",
      semantic: inferFirstThoughtSemanticIntent(normalized, "problem"),
    };
  }

  if (/^what\s+if\b/.test(normalized) || /\b(build|create|launch|ship|prototype)\b/.test(normalized)) {
    return {
      kind: "expandable",
      intent: "idea",
      semantic: inferFirstThoughtSemanticIntent(normalized, "build"),
    };
  }

  if (hasSocialIntent) {
    return {
      kind: "expandable",
      intent: "goal",
      semantic: inferFirstThoughtSemanticIntent(normalized, "social"),
    };
  }

  match = normalized.match(
    /^(?:why|how\s+do\s+i|how\s+can\s+i|what\s+am\s+i\s+missing)\b(?:\s+(.+))?$/,
  );
  if (match) {
    return {
      kind: "expandable",
      intent: "confusion",
      semantic: inferFirstThoughtSemanticIntent(normalized, "problem"),
    };
  }

  match = normalized.match(/^(?:i\s+feel|i\s+think)\s+(.+)$/);
  if (match) {
    const semanticIntentType: FirstThoughtIntentType = /\bstuck\b/.test(normalized)
      ? "problem"
      : "reflect";
    return {
      kind: "expandable",
      intent: "reflection",
      semantic: inferFirstThoughtSemanticIntent(normalized, semanticIntentType),
    };
  }

  match = normalized.match(/^(?:i\s+love|i\s+like|i\s+enjoy)\s+(.+)$/);
  if (match) {
    return {
      kind: "expandable",
      intent: "reflection",
      semantic: inferFirstThoughtSemanticIntent(normalized, "reflect"),
    };
  }

  if (/\b(confused|unclear|lost|dont\s+understand|don't\s+understand)\b/.test(normalized)) {
    return {
      kind: "expandable",
      intent: "confusion",
      semantic: inferFirstThoughtSemanticIntent(normalized, "problem"),
    };
  }

  if (getMeaningfulWordCount(normalized) < FIRST_THOUGHT_MIN_MEANINGFUL_WORDS) {
    return { kind: "non_expandable", intent: "too_short" };
  }

  return { kind: "non_expandable", intent: "unknown" };
}

export function getFirstThoughtExpansionPlan(value: string): FirstThoughtExpansionPlan | null {
  const classification = classifyFirstThoughtIntent(value);
  if (classification.kind !== "expandable") {
    // Even non-expandable intents with enough words should get a generic plan
    const words = getMeaningfulWordCount(value);
    if (words < 3) return null;
    // Extract a topic from raw text for generic expansion
    const fallbackTopic = inferTopic(normalizeFirstThoughtDraft(value)) || "this";
    const cap = fallbackTopic.charAt(0).toUpperCase() + fallbackTopic.slice(1);
    return {
      intent: "goal",
      suggestions: [
        { label: `What matters about ${fallbackTopic}`, template: `## Why ${cap} Matters\n- \n- \n` },
        { label: `Explore ${fallbackTopic} deeper`, template: `## Exploring ${cap}\n- \n- \n` },
        { label: `Next Steps for ${cap}`, template: `## Next Steps for ${cap}\n- [ ] \n- [ ] \n` },
      ],
    };
  }

  const semantic = classification.semantic;
  // Extract topic — use inferred topic, or pull it from the raw input
  const topic = semantic.topic || inferTopic(normalizeFirstThoughtDraft(value)) || "this";
  const cap = topic.charAt(0).toUpperCase() + topic.slice(1);

  let plan: FirstThoughtExpansionPlan | null = null;

  if (semantic.intentType === "learn") {
    plan = {
      intent: "goal",
      suggestions: [
        { label: `Map out learning ${topic}`, template: `## Learning ${cap} — Roadmap\n- Start with fundamentals of ${topic}\n- Build a small ${topic} project\n- Review and iterate\n` },
        { label: `Find ${topic} resources`, template: `## ${cap} Resources\n- [ ] Find a beginner course for ${topic}\n- [ ] Look for ${topic} communities\n- [ ] Set aside weekly time for ${topic}\n` },
        { label: `Why ${topic} matters to me`, template: `## Why ${cap}?\n- What drew me to ${topic}\n- What I hope to do with ${topic}\n- How I'll know I'm making progress\n` },
      ],
    };
  } else if (semantic.intentType === "build") {
    plan = {
      intent: "idea",
      suggestions: [
        { label: `Define what ${topic} solves`, template: `## What ${cap} Solves\n- The core problem\n- Who feels this pain\n- Why existing solutions fail\n` },
        { label: `Sketch ${topic} v1`, template: `## ${cap} — First Version\n- Core feature #1\n- Core feature #2\n- What to skip for now\n` },
        { label: `Who needs ${topic}`, template: `## ${cap} — Target Users\n- Primary user type\n- Their biggest frustration\n- How they'd find ${topic}\n` },
      ],
    };
  } else if (semantic.intentType === "social") {
    plan = {
      intent: "goal",
      suggestions: [
        { label: `Plan the first move`, template: `## First Interaction\n- Setting/context for ${topic}\n- What to say or do\n- How to read the response\n` },
        { label: `Why ${topic} matters`, template: `## Why This Matters\n- What I'm hoping for\n- What I'm afraid of\n- What I'd regret not doing\n` },
        { label: `Best & worst outcomes`, template: `## Possible Outcomes\n- Best case\n- Realistic case\n- Worst case (and why it's fine)\n` },
      ],
    };
  } else if (semantic.intentType === "problem") {
    plan = {
      intent: "problem",
      suggestions: [
        { label: `Root cause of ${topic}`, template: `## Why ${cap} Happens\n- When it started\n- What makes it worse\n- What I've tried so far\n` },
        { label: `One action for ${topic}`, template: `## One Thing I Can Do\n- [ ] Smallest step to address ${topic}\n- When I'll do it\n- How I'll know it worked\n` },
        { label: `Patterns around ${topic}`, template: `## ${cap} — Patterns\n- Times when ${topic} gets worse\n- Times when it gets better\n- What's different in those moments\n` },
      ],
    };
  } else if (semantic.intentType === "reflect") {
    plan = {
      intent: "reflection",
      suggestions: [
        { label: `Unpack this feeling`, template: `## What I'm Feeling About ${cap}\n- The core emotion\n- What triggered it\n- What I need right now\n` },
        { label: `What triggered ${topic}`, template: `## ${cap} — The Trigger\n- What happened recently\n- Why it hit differently this time\n- What I wish had happened\n` },
        { label: `Moving forward from ${topic}`, template: `## Moving Forward\n- One thing that would help\n- Who I could talk to about ${topic}\n- What "better" looks like this week\n` },
      ],
    };
  } else if (semantic.intentType === "plan") {
    plan = {
      intent: "goal",
      suggestions: [
        { label: `${cap} milestones`, template: `## ${cap} — Milestones\n- First milestone for ${topic}\n- Mid-point checkpoint\n- End goal\n` },
        { label: `${cap} priorities`, template: `## ${cap} — What Comes First\n- Most important thing for ${topic}\n- What can wait\n- What to drop entirely\n` },
        { label: `${cap} constraints`, template: `## ${cap} — Reality Check\n- Time available for ${topic}\n- Skills or resources I need\n- Biggest risk\n` },
      ],
    };
  }

  if (!plan) {
    // Generic fallback — still topic-aware
    plan = {
      intent: "goal",
      suggestions: [
        { label: `Explore ${topic} further`, template: `## Exploring ${cap}\n- What I know so far\n- What I want to figure out\n- First thing to try\n` },
        { label: `Why ${topic} matters`, template: `## Why ${cap} Matters\n- What draws me to ${topic}\n- What changes if I pursue this\n- What I'd regret skipping\n` },
        { label: `Next step for ${topic}`, template: `## ${cap} — Next Step\n- [ ] The one thing I can do today\n- [ ] Who or what can help\n- [ ] How I'll track progress\n` },
      ],
    };
  }

  return plan;
}

export function expandFirstThoughtDraft(
  value: string,
  templateString: string,
): { value: string; cursor: number } {
  const trimmed = value.trim();
  const expandedValue = `${trimmed}\n\n${templateString}`;
  return {
    value: expandedValue,
    cursor: expandedValue.length,
  };
}

export function extractConceptTokens(value: string, maxTokens = 8): string[] {
  return value
    .toLowerCase()
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !TRANSITION_STOP_WORDS.has(token))
    .slice(0, maxTokens);
}

export function deriveCurrentConcept(content: string): string | null {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const recent = lines.slice(-6).reverse();
  for (const line of recent) {
    const tokens = extractConceptTokens(line, 1);
    if (tokens.length > 0) return tokens[0];
  }

  const fallback = extractConceptTokens(content, 1);
  return fallback[0] || null;
}

export function getTransitionLikelihood(
  transitionMap: Record<string, Record<string, number>>,
  fromConcept: string,
  candidateTokens: string[],
): number {
  const transitions = transitionMap[fromConcept];
  if (!transitions || candidateTokens.length === 0) return 0;

  const total = Object.values(transitions).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 0;

  let best = 0;
  for (const token of candidateTokens) {
    const probability = (transitions[token] || 0) / total;
    if (probability > best) best = probability;
  }
  return best;
}
