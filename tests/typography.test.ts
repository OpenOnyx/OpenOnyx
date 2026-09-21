import { describe, expect, it } from "vitest";
import { FONT_FAMILY_PRESETS, normalizeFontFamily } from "../src/types/settings";

describe("typography presets", () => {
  it("offers a curated set of distinct bundled font choices", () => {
    expect(FONT_FAMILY_PRESETS.map((preset) => preset.id)).toEqual([
      "inter",
      "space-grotesk",
      "atkinson",
      "lora",
      "georgia",
      "jetbrains-mono",
    ]);
  });

  it("migrates redundant and older font choices to the curated presets", () => {
    expect(normalizeFontFamily("'SF Pro Display', system-ui, sans-serif")).toBe(
      FONT_FAMILY_PRESETS[0].value,
    );
    expect(normalizeFontFamily("'Segoe UI', system-ui, sans-serif")).toBe(
      FONT_FAMILY_PRESETS[0].value,
    );
    expect(normalizeFontFamily("Georgia, serif")).toBe(FONT_FAMILY_PRESETS[4].value);
    expect(normalizeFontFamily("'JetBrains Mono', monospace")).toBe(
      FONT_FAMILY_PRESETS[5].value,
    );
  });

  it("keeps a custom font stack intact", () => {
    expect(normalizeFontFamily('"IBM Plex Sans", sans-serif')).toBe(
      '"IBM Plex Sans", sans-serif',
    );
  });
});
