/**
 * AI Settings - Configuration for AI providers and models
 * 
 * Uses disk storage (.openonyx/ai-settings.json) for security.
 * Plaintext API keys are never left in localStorage.
 */

import { readData, writeData } from "./disk-store";

export interface AIModel {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  supportsGrounding: boolean;
  groundingModelId?: string;
}

export type AIProvider = "openrouter" | "openai";

export interface AIProviderPreset {
  id: AIProvider;
  label: string;
  baseUrl: string;
  keyUrl: string;
  keyPlaceholder: string;
}

export const AI_PROVIDER_PRESETS: AIProviderPreset[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/settings/keys",
    keyPlaceholder: "sk-or-v1-...",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    keyUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-...",
  },
];

export function getPreset(provider: AIProvider): AIProviderPreset {
  return AI_PROVIDER_PRESETS.find((p) => p.id === provider) || AI_PROVIDER_PRESETS[0];
}

export const OPENROUTER_MODELS: AIModel[] = [
  {
    id: "anthropic/claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    shortLabel: "Claude",
    description: "Best reasoning & annotation quality",
    supportsGrounding: false,
  },
  {
    id: "openai/gpt-4o",
    label: "GPT-4o",
    shortLabel: "GPT-4o",
    description: "Strong structured output, broad knowledge",
    supportsGrounding: true,
  },
  {
    id: "google/gemini-2.5-pro-preview-03-25",
    label: "Gemini 2.5 Pro",
    shortLabel: "Gemini",
    description: "Long-context, web grounding available",
    supportsGrounding: true,
  },
  {
    id: "deepseek/deepseek-chat",
    label: "DeepSeek V3",
    shortLabel: "DeepSeek",
    description: "Cost-efficient frontier model",
    supportsGrounding: false,
  },
  {
    id: "mistralai/mistral-small-3.2-24b-instruct",
    label: "Mistral Small 3.2",
    shortLabel: "Mistral",
    description: "Fast, excellent structured outputs",
    supportsGrounding: false,
  },
  // Free tier
  {
    id: "nvidia/nemotron-3-nano-30b-a3b:free",
    label: "Nemotron 30B · Free",
    shortLabel: "Nemotron",
    description: "Free · no credits · ~200 req/day",
    supportsGrounding: false,
  },
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    label: "Nemotron 120B · Free",
    shortLabel: "Nemotron",
    description: "Free · no credits · ~200 req/day · MoE",
    supportsGrounding: false,
  },
];

export const OPENAI_MODELS: AIModel[] = [
  {
    id: "gpt-4o",
    label: "GPT-4o",
    shortLabel: "GPT-4o",
    description: "Strong structured output, broad knowledge",
    supportsGrounding: true,
    groundingModelId: "gpt-4o-search-preview",
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o Mini",
    shortLabel: "GPT-4o Mini",
    description: "Fast and capable, web grounding available",
    supportsGrounding: true,
    groundingModelId: "gpt-4o-mini-search-preview",
  },
  {
    id: "gpt-4.1",
    label: "GPT-4.1",
    shortLabel: "GPT-4.1",
    description: "Latest GPT-4, improved instruction following",
    supportsGrounding: false,
  },
  {
    id: "gpt-4.1-mini",
    label: "GPT-4.1 Mini",
    shortLabel: "GPT-4.1 Mini",
    description: "Fast and capable, good balance",
    supportsGrounding: false,
  },
  {
    id: "o4-mini",
    label: "o4-mini",
    shortLabel: "o4-mini",
    description: "Fast reasoning model",
    supportsGrounding: false,
  },
];

export function getModelsForProvider(provider: AIProvider): AIModel[] {
  if (provider === "openai") return OPENAI_MODELS;
  return OPENROUTER_MODELS;
}

export const DEFAULT_MODEL_ID = "openai/gpt-4o";
export const DEFAULT_PROVIDER: AIProvider = "openrouter";

export interface AISettings {
  apiKey: string;
  modelId: string;
  webGrounding: boolean;
  provider: AIProvider;
  customBaseUrl: string;
  providerKeys?: Partial<Record<AIProvider, string>>;
  customModelId?: string;
}

const LEGACY_STORAGE_KEY = "openonyx-ai-settings";
const DISK_SETTINGS_PATH = "ai-settings.json";
export const AI_SETTINGS_CHANGED_EVENT = "ai-settings-changed";

let _settingsCache: AISettings | null = null;
let _loadPromise: Promise<AISettings> | null = null;

const DEFAULT_SETTINGS: AISettings = {
  apiKey: "",
  modelId: DEFAULT_MODEL_ID,
  webGrounding: false,
  provider: DEFAULT_PROVIDER,
  customBaseUrl: "",
  customModelId: "",
};

function notifySettingsChanged(): void {
  if (typeof window === "undefined") return;
  // Keep credentials in the module cache; never expose API keys in DOM events.
  window.dispatchEvent(new Event(AI_SETTINGS_CHANGED_EVENT));
}

export function loadSettings(): AISettings {
  if (_settingsCache) {
    return _settingsCache;
  }

  // 1. Check legacy localStorage for migration
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const result: AISettings = { ...DEFAULT_SETTINGS, ...parsed };
        _settingsCache = result;
        void writeData(DISK_SETTINGS_PATH, result).then(() => {
          try {
            if (typeof localStorage !== "undefined") {
              localStorage.removeItem(LEGACY_STORAGE_KEY);
              console.log("[AISettings] Migrated AI settings from localStorage to .openonyx/ai-settings.json");
            }
          } catch { /* silent */ }
        });
        return result;
      }
    }
  } catch { /* silent */ }

  // 2. Trigger async load in background to populate cache
  void loadSettingsAsync();

  _settingsCache = { ...DEFAULT_SETTINGS };
  return _settingsCache;
}

export async function loadSettingsAsync(): Promise<AISettings> {
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async (): Promise<AISettings> => {
    // 1. Read from disk (.openonyx/ai-settings.json)
    const diskData = await readData<AISettings>(DISK_SETTINGS_PATH);
    if (diskData) {
      const result: AISettings = { ...DEFAULT_SETTINGS, ...diskData };
      _settingsCache = result;
      notifySettingsChanged();
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.removeItem(LEGACY_STORAGE_KEY);
        }
      } catch { /* silent */ }
      return result;
    }

    // 2. Fall back to legacy localStorage migration if disk data was missing
    try {
      if (typeof localStorage !== "undefined") {
        const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const result: AISettings = { ...DEFAULT_SETTINGS, ...parsed };
          _settingsCache = result;
          await writeData(DISK_SETTINGS_PATH, result);
          localStorage.removeItem(LEGACY_STORAGE_KEY);
          console.log("[AISettings] Migrated AI settings from localStorage to .openonyx/ai-settings.json");
          notifySettingsChanged();
          return result;
        }
      }
    } catch { /* silent */ }

    const finalSettings: AISettings = _settingsCache || { ...DEFAULT_SETTINGS };
    _settingsCache = finalSettings;
    return finalSettings;
  })();

  return _loadPromise;
}

export function saveSettings(settings: AISettings): void {
  _settingsCache = { ...DEFAULT_SETTINGS, ...settings };
  void writeData(DISK_SETTINGS_PATH, _settingsCache);
  notifySettingsChanged();

  // Guarantee plaintext API keys are NEVER left in localStorage
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
  } catch { /* silent */ }
}

export function _resetSettingsCache(): void {
  _settingsCache = null;
  _loadPromise = null;
}

export interface AIConfig {
  apiKey: string;
  modelId: string;
  supportsGrounding: boolean;
  provider: AIProvider;
  customBaseUrl: string;
}

export function loadAIConfig(): AIConfig | null {
  const s = loadSettings();
  if (!s.apiKey) return null;
  const models = getModelsForProvider(s.provider);
  const model = models.find((m) => m.id === s.modelId);
  const modelId = s.modelId || models[0]?.id || DEFAULT_MODEL_ID;
  const supportsGrounding =
    (s.provider === "openrouter" || s.provider === "openai") &&
    s.webGrounding &&
    (model?.supportsGrounding ?? false);
  return { apiKey: s.apiKey, modelId, supportsGrounding, provider: s.provider, customBaseUrl: s.customBaseUrl };
}

export function getBaseUrl(config: AIConfig): string {
  const custom = config.customBaseUrl?.trim();
  return custom || getPreset(config.provider).baseUrl;
}

export function getProviderHeaders(config: AIConfig): Record<string, string> {
  const base: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  };
  if (config.provider === "openrouter") {
    base["HTTP-Referer"] = typeof window !== 'undefined' ? window.location.origin : "https://openonyx.app";
    base["X-Title"] = "OpenOnyx";
  }
  return base;
}

export async function parseProviderError(response: Response): Promise<string> {
  let errObj: { message?: string; metadata?: { provider_name?: string } } | undefined;
  try {
    const body = await response.json();
    errObj = body?.error;
  } catch { /* couldn't parse JSON */ }

  const providerName = errObj?.metadata?.provider_name;

  switch (response.status) {
    case 401: return "Invalid or missing API key. Check your key in AI Settings.";
    case 402: return "Insufficient credits. Add credits or switch to a free model.";
    case 403: return "Content flagged by the provider's safety filter.";
    case 404: return "Model unavailable. Switch to another model in AI Settings.";
    case 408: return "Request timed out. Try again.";
    case 429:
      return providerName
        ? `${providerName} is rate-limiting. Retry later or switch models.`
        : "Too many requests. Slow down and try again.";
    case 502:
    case 503:
      return providerName
        ? `${providerName} is temporarily unavailable. Try again or switch models.`
        : "The AI provider is temporarily unavailable. Try again.";
    default:
      return errObj?.message ?? `Request failed (${response.status}). Check your settings.`;
  }
}
