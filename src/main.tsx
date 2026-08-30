// ── Global setup for plugins (must be before anything else) ──
import moment from 'moment';
(window as any).moment = moment;
(window as any)._bundledLocaleWeekSpec = (moment.localeData() as any)._week || { dow: 0, doy: 6 };

import './lib/obsidian-api/dom-extensions';

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installGlobalTooltips } from "./lib/tooltips";
import { documentTailwindClasses } from "./styles/documentTailwindClasses";
import { themeClasses } from "./styles/themeClasses";

import "@fontsource/inter/300.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "katex/dist/katex.min.css";
import "./tailwind.css";

document.documentElement.className = `${document.documentElement.className} ${documentTailwindClasses} ${themeClasses}`.trim();
installGlobalTooltips();

// Excalidraw copies body styles into an iframe when it reads Obsidian tokens.
// Mirror the computed Tailwind values, rather than another class set, so this
// does not alter the selected theme's CSS cascade.
const syncThemeVariablesToBody = () => {
  // Run asynchronously after render to prevent UI freezing / layout thrashing
  requestAnimationFrame(() => {
    const computed = getComputedStyle(document.documentElement);
    const updates: [string, string][] = [];
    for (let i = 0; i < computed.length; i++) {
      const property = computed[i];
      if (property.startsWith('--')) {
        updates.push([property, computed.getPropertyValue(property)]);
      }
    }
    // Batch write all properties to body style
    for (const [property, value] of updates) {
      document.body.style.setProperty(property, value);
    }
  });
};
(window as any).__oo_sync_theme_variables_to_body = syncThemeVariablesToBody;
syncThemeVariablesToBody();

// ── Global shims for plugin compatibility ──
if (!(String.prototype as any).contains) {
  (String.prototype as any).contains = String.prototype.includes;
}
if (!(Array.prototype as any).contains) {
  (Array.prototype as any).contains = Array.prototype.includes;
}

// ── Global Error Handling for Debugging ──
window.onerror = (msg, url, line, col, error) => {
  if (typeof msg === 'string' && msg.includes('ResizeObserver loop completed')) return false;
  console.log(`[FATAL] ${msg} at ${url}:${line}:${col}`, error);
  return false;
};
window.onunhandledrejection = (event) => {
  console.log(`[REJECTION]`, event.reason);
};

console.log('[OpenOnyx] Main entry point executing');

const rootEl = document.getElementById("root");
if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
} else {
  console.error('[OpenOnyx] Root element not found!');
}
