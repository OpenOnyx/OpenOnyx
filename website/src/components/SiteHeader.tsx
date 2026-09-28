import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { PRODUCT } from "../data/facts";
import { useTheme } from "../theme";

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12 .7a11.3 11.3 0 0 0-3.6 22c.6.1.8-.2.8-.6v-2c-3.3.7-4-1.4-4-1.4-.5-1.3-1.2-1.6-1.2-1.6-1-.7.1-.7.1-.7 1.1.1 1.7 1.2 1.7 1.2 1 .1.6 2.5 3.4 1.8.1-.7.4-1.2.7-1.5-2.6-.3-5.4-1.3-5.4-5.8 0-1.3.5-2.3 1.2-3.2-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8.1 3.1.7.9 1.2 1.9 1.2 3.2 0 4.5-2.7 5.5-5.4 5.8.4.4.8 1.1.8 2.2v3.3c0 .4.2.7.8.6A11.3 11.3 0 0 0 12 .7Z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <path fill="currentColor" d="M12 2.5a1 1 0 0 1 1 1v1.1a1 1 0 1 1-2 0V3.5a1 1 0 0 1 1-1Zm0 16.9a1 1 0 0 1 1 1v1.1a1 1 0 1 1-2 0v-1.1a1 1 0 0 1 1-1ZM4.6 4.6a1 1 0 0 1 1.4 0l.8.8a1 1 0 0 1-1.4 1.4L4.6 6a1 1 0 0 1 0-1.4Zm12.6 12.6a1 1 0 0 1 1.4 0l.8.8a1 1 0 0 1-1.4 1.4l-.8-.8a1 1 0 0 1 0-1.4ZM2.5 12a1 1 0 0 1 1-1h1.1a1 1 0 1 1 0 2H3.5a1 1 0 0 1-1-1Zm16.9 0a1 1 0 0 1 1-1h1.1a1 1 0 1 1 0 2h-1.1a1 1 0 0 1-1-1ZM6.8 17.2a1 1 0 0 1 0 1.4l-.8.8A1 1 0 0 1 4.6 18l.8-.8a1 1 0 0 1 1.4 0ZM19.4 4.6a1 1 0 0 1 0 1.4l-.8.8a1 1 0 1 1-1.4-1.4l.8-.8a1 1 0 0 1 1.4 0Z" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M20.2 14.5A8.2 8.2 0 0 1 9.5 3.8a.8.8 0 0 0-.8-1.1 9.8 9.8 0 1 0 12.6 12.6.8.8 0 0 0-1.1-.8Z" />
    </svg>
  );
}

function formatStars(count: number) {
  if (count >= 1000) return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k`;
  return String(count);
}

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [stars, setStars] = useState("—");
  const { docsTheme, setDocsTheme } = useTheme();
  const location = useLocation();
  const isDocs = location.pathname.startsWith("/docs");

  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [menuOpen]);
  useEffect(() => {
    const updateScrolled = () => setScrolled(window.scrollY > 8);
    updateScrolled();
    window.addEventListener("scroll", updateScrolled, { passive: true });
    return () => window.removeEventListener("scroll", updateScrolled);
  }, []);
  useEffect(() => {
    const cached = sessionStorage.getItem("openonyx-github-stars");
    if (cached) setStars(cached);
    const controller = new AbortController();
    fetch("https://api.github.com/repos/OpenOnyx/OpenOnyx", {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { stargazers_count?: number } | null) => {
        if (typeof data?.stargazers_count !== "number") return;
        const nextStars = formatStars(data.stargazers_count);
        setStars(nextStars);
        sessionStorage.setItem("openonyx-github-stars", nextStars);
      })
      .catch(() => {
        /* Keep the repository metadata fallback. */
      });
    return () => controller.abort();
  }, []);

  return (
    <header className={`header${isDocs ? " is-docs" : ""}${menuOpen ? " is-open" : ""}${scrolled ? " is-scrolled" : ""}`}>
      <div className="header-bar">
        <Link to="/" className="brand" aria-label="OpenOnyx home"><img className="brand-logo" src="/logos/logo-dark.png" alt="" /><span>OpenOnyx</span></Link>
        <nav className="nav-links" aria-label="Primary navigation">
          <a href="/#why">Product</a>
          {!isDocs && <a href="/#intelligence">Intelligence</a>}
          <NavLink to="/careers">Careers</NavLink>
          <NavLink to="/docs">Docs</NavLink>
          <a className="github-stars-link" href={PRODUCT.repo} target="_blank" rel="noreferrer" aria-label={stars === "—" ? "GitHub repository" : `GitHub repository, ${stars} stars`}><GitHubIcon /><span>{stars}</span></a>
        </nav>
        <div className="header-meta">
          {isDocs && (
            <button type="button" className="docs-theme-toggle" aria-label={`Switch to ${docsTheme === "dark" ? "light" : "dark"} theme`} aria-pressed={docsTheme === "dark"} onClick={() => setDocsTheme(docsTheme === "dark" ? "light" : "dark")}><span><SunIcon /><MoonIcon /></span></button>
          )}
          <Link className="header-cta" to="/download">Download</Link>
          <button type="button" className="nav-toggle" aria-expanded={menuOpen} aria-controls="mobile-nav" onClick={() => setMenuOpen((open) => !open)}><span className="sr-only">{menuOpen ? "Close menu" : "Open menu"}</span><i /><i /></button>
        </div>
      </div>
      <nav id="mobile-nav" className="mobile-nav" hidden={!menuOpen} aria-label="Mobile navigation"><a href="/#why">Product</a>{!isDocs && <a href="/#intelligence">Intelligence</a>}<NavLink to="/careers">Careers</NavLink><NavLink to="/docs">Docs</NavLink><a href={PRODUCT.repo} target="_blank" rel="noreferrer">GitHub · {stars} stars</a><Link to="/download">Download</Link></nav>
    </header>
  );
}
