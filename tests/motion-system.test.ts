import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const motionCss = fs.readFileSync(path.join(root, "src/styles/motion.css"), "utf8");
const mainSource = fs.readFileSync(path.join(root, "src/main.tsx"), "utf8");

describe("motion system", () => {
  it("loads after the base stylesheet so motion tokens consistently win", () => {
    expect(mainSource.indexOf('import "./styles/motion.css"')).toBeGreaterThan(
      mainSource.indexOf('import "./tailwind.css"'),
    );
  });

  it("defines the desktop interaction timing scale", () => {
    expect(motionCss).toContain("--motion-duration-button: 110ms");
    expect(motionCss).toContain("--motion-duration-hover: 140ms");
    expect(motionCss).toContain("--motion-duration-tab: 170ms");
    expect(motionCss).toContain("--motion-duration-dialog: 180ms");
    expect(motionCss).toContain("--motion-duration-panel: 200ms");
  });

  it("provides a transform-free reduced-motion path with no stagger", () => {
    const reducedMotion = motionCss.slice(
      motionCss.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reducedMotion).toContain("transform: none !important");
    expect(reducedMotion).toContain("animation-delay: 0ms !important");
    expect(reducedMotion).toContain("animation-name: oo-fade-in !important");
  });

  it("caps repeated result and AI card motion", () => {
    expect(motionCss).toContain(".motion-search-results > :nth-child(n + 21)");
    expect(motionCss).toContain(".ai-panel-item:nth-child(n + 6)");
  });
});
