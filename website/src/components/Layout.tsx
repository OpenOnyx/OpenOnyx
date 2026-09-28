import { Link, Outlet, useLocation } from "react-router-dom";
import { PRODUCT } from "../data/facts";
import { CommandProvider } from "./commands";
import { SiteHeader } from "./SiteHeader";

export function Layout() {
  const location = useLocation();
  const isDocs = location.pathname.startsWith("/docs");
  return (
    <CommandProvider>
      <div className="site">
        <a className="skip-link" href="#main-content">Skip to content</a>
        <SiteHeader />
        <main id="main-content" className="page"><Outlet /></main>
        {!isDocs && (
          <footer className={`footer${location.pathname === "/" ? " footer-home" : ""}`}>
            <div className="footer-inner"><Link to="/" className="brand"><img className="brand-logo" src="/logos/logo-dark.png" alt="" /><span>OpenOnyx</span></Link><p>Open source. Local-first. Your files.</p><nav aria-label="Footer navigation"><Link to="/careers">Careers</Link><a href={PRODUCT.repo} target="_blank" rel="noreferrer">GitHub</a><a href={`${PRODUCT.repo}/discussions`} target="_blank" rel="noreferrer">Community</a><a href="https://github.com/sponsors/OpenOnyx" target="_blank" rel="noreferrer">Sponsor</a><a href={`${PRODUCT.repo}/blob/main/LICENSE`} target="_blank" rel="noreferrer">{PRODUCT.license}</a></nav></div>
            <div className="footer-bottom"><span>© {new Date().getFullYear()} OpenOnyx</span><span>Your knowledge belongs to you.</span></div>
          </footer>
        )}
      </div>
    </CommandProvider>
  );
}
