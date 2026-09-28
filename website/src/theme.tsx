import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { documentTailwindClasses } from "../../src/styles/documentTailwindClasses";
import { themeClasses } from "../../src/styles/themeClasses";
import { useLocation } from "react-router-dom";

export type Theme = "dark" | "light";

type ThemeApi = {
  theme: Theme;
  toggle: () => void;
  setTheme: (theme: Theme) => void;
  docsTheme: Theme;
  setDocsTheme: (theme: Theme) => void;
};

const ThemeCtx = createContext<ThemeApi | null>(null);

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem("openonyx-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* ignore */
  }
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => (typeof window === "undefined" ? "dark" : readTheme()));
  const [docsTheme, setDocsTheme] = useState<Theme>(() => {
    try { return localStorage.getItem('openonyx-docs-theme') === 'light' ? 'light' : 'dark'; }
    catch { return 'dark'; }
  });
  const isDocs = useLocation().pathname.startsWith('/docs');
  const effectiveTheme = isDocs ? docsTheme : theme;

  useEffect(() => {
    document.documentElement.dataset.theme = isDocs && effectiveTheme === 'dark' ? 'openonyx' : effectiveTheme;
    if (isDocs) document.documentElement.dataset.docsTheme = docsTheme;
    else delete document.documentElement.dataset.docsTheme;
    document.documentElement.style.colorScheme = effectiveTheme;
    document.documentElement.className = `${documentTailwindClasses} ${themeClasses}`.trim();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", effectiveTheme === "light" ? "#ffffff" : "#0d0d0d");
    try {
      localStorage.setItem("openonyx-theme", theme);
      localStorage.setItem("openonyx-docs-theme", docsTheme);
    } catch {
      /* ignore */
    }
  }, [theme, docsTheme, effectiveTheme, isDocs]);

  const api = useMemo<ThemeApi>(
    () => ({
      theme,
      setTheme: setThemeState,
      docsTheme,
      setDocsTheme,
      toggle: () => setThemeState((current) => (current === "light" ? "dark" : "light")),
    }),
    [theme, docsTheme],
  );

  return <ThemeCtx.Provider value={api}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error("useTheme needs ThemeProvider");
  return ctx;
}
