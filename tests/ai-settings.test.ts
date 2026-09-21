// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_SETTINGS_CHANGED_EVENT,
  DEFAULT_MODEL_ID,
  DEFAULT_PROVIDER,
  getBaseUrl,
  getProviderHeaders,
  loadAIConfig,
  loadSettings,
  loadSettingsAsync,
  parseProviderError,
  saveSettings,
  _resetSettingsCache,
} from "../src/utils/ai-settings";
import { readData, writeData } from "../src/utils/disk-store";

describe("AI settings", () => {
  beforeEach(() => {
    _resetSettingsCache();
    let store: Record<string, string> = {};
    const mockStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = String(value); },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { store = {}; },
      get length() { return Object.keys(store).length; },
      key: (i: number) => Object.keys(store)[i] ?? null,
    };
    Object.defineProperty(window, "localStorage", { value: mockStorage, writable: true, configurable: true });
    Object.defineProperty(globalThis, "localStorage", { value: mockStorage, writable: true, configurable: true });
  });

  it("returns defaults when nothing is stored", () => {
    expect(loadSettings()).toMatchObject({
      apiKey: "",
      modelId: DEFAULT_MODEL_ID,
      provider: DEFAULT_PROVIDER,
    });
    expect(loadAIConfig()).toBeNull();
  });

  it("round-trips a saved key and does NOT leave plaintext in localStorage", async () => {
    saveSettings({
      apiKey: "sk-test-secret-123",
      modelId: "openai/gpt-4o",
      webGrounding: false,
      provider: "openrouter",
      customBaseUrl: "",
    });

    const loaded = loadAIConfig();
    expect(loaded?.apiKey).toBe("sk-test-secret-123");
    expect(loaded?.provider).toBe("openrouter");

    // Verify localStorage contains NO plaintext key under openonyx-ai-settings
    expect(window.localStorage.getItem("openonyx-ai-settings")).toBeNull();

    // Verify saved to disk store (.openonyx/ai-settings.json)
    const diskData = await readData<any>("ai-settings.json");
    expect(diskData?.apiKey).toBe("sk-test-secret-123");
  });

  it("broadcasts the active model and does not promote a stale custom-model draft", () => {
    const listener = vi.fn();
    window.addEventListener(AI_SETTINGS_CHANGED_EVENT, listener);
    saveSettings({
      apiKey: "sk-active",
      modelId: "nvidia/nemotron-3-super-120b-a12b:free",
      customModelId: "mistralai/mistral-small-3.2-24b-instruct",
      webGrounding: false,
      provider: "openrouter",
      customBaseUrl: "",
    });

    expect(loadAIConfig()?.modelId).toBe("nvidia/nemotron-3-super-120b-a12b:free");
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toBeUndefined();
    window.removeEventListener(AI_SETTINGS_CHANGED_EVENT, listener);
  });

  it("migrates legacy localStorage value once to disk and deletes it from localStorage", async () => {
    // Seed legacy localStorage
    window.localStorage.setItem(
      "openonyx-ai-settings",
      JSON.stringify({
        apiKey: "sk-legacy-key-999",
        modelId: "openai/gpt-4o",
        provider: "openai",
      }),
    );

    // Call saveSettings with legacy data to simulate load/migrate
    const settings = loadSettings();
    expect(settings.apiKey).toBe("sk-legacy-key-999");

    const loadedAsync = await loadSettingsAsync();
    expect(loadedAsync.apiKey).toBe("sk-legacy-key-999");

    // Confirm legacy localStorage was deleted
    expect(window.localStorage.getItem("openonyx-ai-settings")).toBeNull();

    // Confirm stored on disk
    const diskData = await readData<any>("ai-settings.json");
    expect(diskData?.apiKey).toBe("sk-legacy-key-999");
  });

  it("uses a custom base url when set", () => {
    expect(
      getBaseUrl({
        apiKey: "x",
        modelId: "gpt-4o",
        supportsGrounding: false,
        provider: "openai",
        customBaseUrl: "https://proxy.example/v1",
      }),
    ).toBe("https://proxy.example/v1");
  });

  it("adds OpenRouter headers", () => {
    const headers = getProviderHeaders({
      apiKey: "sk-or",
      modelId: "x",
      supportsGrounding: false,
      provider: "openrouter",
      customBaseUrl: "",
    });
    expect(headers.Authorization).toBe("Bearer sk-or");
    expect(headers["X-Title"]).toBe("OpenOnyx");
  });

  it("maps common provider status codes", async () => {
    const unauthorized = await parseProviderError(new Response("{}", { status: 401 }));
    expect(unauthorized).toMatch(/API key/i);
    const payment = await parseProviderError(new Response("{}", { status: 402 }));
    expect(payment).toMatch(/credits/i);
  });
});
