// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_ID,
  DEFAULT_PROVIDER,
  getBaseUrl,
  getProviderHeaders,
  loadAIConfig,
  loadSettings,
  parseProviderError,
  saveSettings,
} from "../src/utils/ai-settings";

describe("AI settings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns defaults when nothing is stored", () => {
    expect(loadSettings()).toMatchObject({
      apiKey: "",
      modelId: DEFAULT_MODEL_ID,
      provider: DEFAULT_PROVIDER,
    });
    expect(loadAIConfig()).toBeNull();
  });

  it("round-trips a saved key", () => {
    saveSettings({
      apiKey: "sk-test",
      modelId: "openai/gpt-4o",
      webGrounding: false,
      provider: "openrouter",
      customBaseUrl: "",
    });
    const loaded = loadAIConfig();
    expect(loaded?.apiKey).toBe("sk-test");
    expect(loaded?.provider).toBe("openrouter");
  });

  it("uses a custom base url when set", () => {
    expect(getBaseUrl({
      apiKey: "x",
      modelId: "gpt-4o",
      supportsGrounding: false,
      provider: "openai",
      customBaseUrl: "https://proxy.example/v1",
    })).toBe("https://proxy.example/v1");
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
