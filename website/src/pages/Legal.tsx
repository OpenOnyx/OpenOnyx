import { PRIVACY_POLICY, TERMS_OF_SERVICE, type LegalPolicy } from "../data/legal";
import { usePageMeta } from "../lib/meta";
import "../styles/legal.css";

export function LegalDocument({ policy }: { policy: LegalPolicy }) {
  const updated = new Date(`${policy.updated}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
  return (
    <article className="legal-page">
      <header className="legal-heading">
        <p className="legal-eyebrow">OPENONYX / LEGAL</p>
        <h1>{policy.title}</h1>
        <p className="legal-updated">Last updated: <time dateTime={policy.updated}>{updated}</time></p>
        <nav className="legal-switch" aria-label="Legal documents">
          <a href="/privacy" aria-current={policy.path === "/privacy" ? "page" : undefined}>Privacy Policy</a>
          <a href="/terms" aria-current={policy.path === "/terms" ? "page" : undefined}>Terms of Service</a>
        </nav>
      </header>
      <div className="legal-layout">
        <nav className="legal-contents" aria-label="Contents">
          <p className="legal-eyebrow">CONTENTS</p>
          <ol>{policy.sections.map((section) => <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}</ol>
        </nav>
        <div className="legal-prose">
          {policy.sections.map((section, index) => (
            <section id={section.id} key={section.id} aria-labelledby={`${section.id}-heading`}>
              <h2 id={`${section.id}-heading`}><span aria-hidden="true">{String(index + 1).padStart(2, "0")} / </span>{section.title}</h2>
              {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {section.items && <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>}
              {section.links && <ul className="legal-references">{section.links.map((link) => <li key={link.href}>
                <a href={link.href} {...(link.href.startsWith("https:") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{link.label}</a>
              </li>)}</ul>}
            </section>
          ))}
        </div>
      </div>
    </article>
  );
}

function LegalPage({ policy }: { policy: LegalPolicy }) {
  usePageMeta(`${policy.title} | OpenOnyx`, policy.description);
  return <LegalDocument policy={policy} />;
}

export function Privacy() { return <LegalPage policy={PRIVACY_POLICY} />; }
export function Terms() { return <LegalPage policy={TERMS_OF_SERVICE} />; }
