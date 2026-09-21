// ── Global setup for plugins (must be before anything else) ──
import moment from 'moment';
(window as any).moment = moment;
(window as any)._bundledLocaleWeekSpec = (moment.localeData() as any)._week || { dow: 0, doy: 6 };

import './lib/obsidian-api/dom-extensions';

import React from "react";
import ReactDOM from "react-dom/client";
import { installGlobalTooltips } from "./lib/tooltips";
import { documentTailwindClasses } from "./styles/documentTailwindClasses";
import { themeClasses } from "./styles/themeClasses";

import "@fontsource/inter/300.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/lora/400.css";
import "@fontsource/lora/500.css";
import "@fontsource/lora/600.css";
import "@fontsource/lora/700.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
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
  const computed = getComputedStyle(document.documentElement);
  for (const property of computed) {
    if (property.startsWith('--')) {
      document.body.style.setProperty(property, computed.getPropertyValue(property));
    }
  }
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

function StartupFailure({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    <main
      role="alert"
      style={{
        minHeight: '100vh',
        boxSizing: 'border-box',
        display: 'grid',
        placeItems: 'center',
        padding: 32,
        color: '#f4f4f5',
        background: '#0f0f14',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <section style={{ width: 'min(560px, 100%)', lineHeight: 1.55 }}>
        <h1 style={{ margin: '0 0 12px', fontSize: 24 }}>OpenOnyx could not finish starting</h1>
        <p style={{ margin: '0 0 16px', color: '#c4c4cc' }}>
          The renderer encountered an error. Reloading usually recovers the session; your vault files are not changed.
        </p>
        <pre
          style={{
            margin: '0 0 20px',
            padding: 14,
            overflow: 'auto',
            border: '1px solid #3f3f46',
            borderRadius: 8,
            color: '#fca5a5',
            background: '#18181b',
            whiteSpace: 'pre-wrap',
          }}
        >
          {message}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: '10px 16px',
            border: 0,
            borderRadius: 8,
            color: '#071311',
            background: '#5eead4',
            font: 'inherit',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Reload OpenOnyx
        </button>
      </section>
    </main>
  );
}

class StartupErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error: unknown | null }
> {
  state: { error: unknown | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('[OpenOnyx] React startup failed', error, info.componentStack);
  }

  render() {
    if (this.state.error) return <StartupFailure error={this.state.error} />;
    return this.props.children;
  }
}

const rootEl = document.getElementById("root");
if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  void import('./App')
    .then(({ default: App }) => {
      root.render(
        <React.StrictMode>
          <StartupErrorBoundary>
            <App />
          </StartupErrorBoundary>
        </React.StrictMode>,
      );
    })
    .catch((error: unknown) => {
      console.error('[OpenOnyx] Application bundle failed to load', error);
      root.render(<StartupFailure error={error} />);
    });
} else {
  console.error('[OpenOnyx] Root element not found!');
}
