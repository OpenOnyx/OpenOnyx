import { Outlet, useLocation } from "react-router-dom";
import { PRODUCT } from "../data/facts";
import { CommandProvider } from "./commands";
import { SiteHeader } from "./SiteHeader";

export function Layout() {
  const location = useLocation();
  return (
    <CommandProvider>
    <div className="site">
      <SiteHeader />
      <main key={location.pathname} className="page">
        <Outlet />
      </main>
      <footer className="footer">
        <span>
          {PRODUCT.name} v{PRODUCT.version} · {PRODUCT.license} · no product analytics
        </span>
        <nav>
          <a href={PRODUCT.repo}>source</a>
          <a href={PRODUCT.releases}>releases</a>
          <a href={PRODUCT.issues}>issues</a>
        </nav>
      </footer>
    </div>
    </CommandProvider>
  );
}
