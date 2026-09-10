import { Link } from "react-router-dom";
import { usePageMeta } from "../lib/meta";

export function NotFound() {
  usePageMeta(
    "Page not found — OpenOnyx",
    "This URL is not a page on the OpenOnyx site. The product, docs, and download pages are.",
  );

  return (
    <section className="section not-found">
      <div className="kicker">404</div>
      <h1>this page is not here.</h1>
      <p style={{ color: "var(--muted)", maxWidth: 560 }}>
        That address is not a route on this site. Unknown docs slugs go to Get going; anything else lands here.
      </p>
      <div className="hero-actions">
        <Link className="btn primary" to="/">
          Product
        </Link>
        <Link className="btn" to="/docs/start">
          Docs
        </Link>
        <Link className="btn" to="/download">
          Download
        </Link>
      </div>
    </section>
  );
}
