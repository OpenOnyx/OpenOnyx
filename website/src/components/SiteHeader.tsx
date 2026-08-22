import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { PRODUCT } from "../data/facts";
import { useTheme } from "../theme";

function formatCount(n: number) {
  return n.toLocaleString("en-US");
}

export function SiteHeader() {
  const [stars, setStars] = useState<number | null>(91);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const { theme, toggle } = useTheme();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    let cancelled = false;
    fetch("https://api.github.com/repos/OpenOnyx/OpenOnyx")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && typeof data?.stargazers_count === "number") {
          setStars(data.stargazers_count);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    const onResize = () => {
      if (window.innerWidth > 760) setMenuOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("resize", onResize);
    };
  }, [menuOpen]);

  return (
    <header className={`header${menuOpen ? " is-open" : ""}`}>
      <div className="header-bar">
        <div className="header-left">
          <NavLink to="/" className="brand" end onClick={() => setMenuOpen(false)}>
            <img src="/logos/logo-dark.png" alt="" width={26} height={26} />
            <span>openonyx</span>
          </NavLink>
          <nav className="nav-links" aria-label="Primary">
            <NavLink to="/" end>
              product
            </NavLink>
            <NavLink to="/docs">docs</NavLink>
            <NavLink to="/download">download</NavLink>
            <a href={PRODUCT.repo} target="_blank" rel="noreferrer">
              source
            </a>
          </nav>
        </div>
        <div className="header-meta">
          <button
            type="button"
            className="theme-toggle"
            onClick={toggle}
            aria-label={theme === "light" ? "Switch to dark" : "Switch to light"}
            title={theme === "light" ? "Dark mode" : "Light mode"}
          >
            {theme === "light" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
                <circle cx="12" cy="12" r="4" />
                <path d="M12 3v2M12 19v2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M3 12h2M19 12h2M5.2 18.8l1.4-1.4M17.4 6.6l1.4-1.4" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 14.3A8.4 8.4 0 1 1 9.7 3 6.6 6.6 0 0 0 21 14.3z" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="meta-chip"
            onClick={() => window.dispatchEvent(new Event("openonyx:palette"))}
          >
            ⌘K
          </button>
          <a className="meta-chip" href={PRODUCT.latestRelease} target="_blank" rel="noreferrer">
            v{PRODUCT.version}
          </a>
          <a className="meta-chip" href={`${PRODUCT.repo}/stargazers`} target="_blank" rel="noreferrer">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8" />
            </svg>
            <span>{stars !== null ? formatCount(stars) : "github"}</span>
          </a>
          <button
            type="button"
            className="nav-toggle"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="sr-only">{menuOpen ? "Close menu" : "Open menu"}</span>
            <span />
            <span />
          </button>
        </div>
      </div>
      <nav id="mobile-nav" className="mobile-nav" hidden={!menuOpen} aria-label="Mobile">
        <NavLink to="/" end>
          product
        </NavLink>
        <NavLink to="/docs">docs</NavLink>
        <NavLink to="/download">download</NavLink>
        <a href={PRODUCT.repo} target="_blank" rel="noreferrer">
          source
        </a>
      </nav>
    </header>
  );
}
