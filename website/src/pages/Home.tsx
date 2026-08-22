import { Link } from "react-router-dom";
import { CompareTable } from "../components/CompareTable";
import { Reveal } from "../components/Reveal";
import { FilmFrame } from "../components/product/FilmFrame";
import { Workspace } from "../components/product/Workspace";
import { FEATURES, PRODUCT, STORY } from "../data/facts";
import { usePageMeta } from "../lib/meta";

export function Home() {
  usePageMeta(`OpenOnyx — Local-first knowledge workspace`, PRODUCT.description);

  return (
    <div className="stage">
      <div className="stage-lead">
        <p className="kicker">desktop · local-first · apache-2.0 · v{PRODUCT.version}</p>
        <div className="stage-row">
          <h1>
            your files. <em>your graph.</em>
          </h1>
          <div className="hero-actions">
            <Link className="btn primary" to="/download">
              Download
            </Link>
            <button type="button" className="btn" onClick={() => window.dispatchEvent(new Event("openonyx:palette"))}>
              Open ⌘K
            </button>
          </div>
        </div>
        <p className="lede">
          A local-first knowledge workspace with the thinking layer built in. Markdown stays on disk. Spaces, the AI
          graph, and plugins are part of the desktop — not a shopping list.
        </p>
      </div>

      <Workspace />

      <ul className="understory">
        <li>
          <b>Files stay files.</b> Markdown on disk. The app is a viewer, not a database.
        </li>
        <li>
          <b>Local AI is built in.</b> Spaces and the AI graph run on the machine. No account to write.
        </li>
        <li>
          <b>Open source. No telemetry.</b> Apache-2.0 desktop. You can read every line.
        </li>
      </ul>

      <section className="inventory">
        <Reveal>
          <div className="kicker">what's included</div>
          <h2>The whole product. Not a plugin shopping list.</h2>
          <p>Twelve surfaces that ship in the desktop app. Open any one in the docs.</p>
        </Reveal>
        <div className="inventory-grid">
          {FEATURES.map((item) => (
            <Link className="inventory-card" key={item.id} to={item.href}>
              <span>{item.kicker}</span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </Link>
          ))}
        </div>
      </section>

      <div className="story">
        {STORY.map((item, index) => (
          <section className={`film${index % 2 ? " is-flip" : ""}`} key={item.id} id={item.id}>
            <Reveal className="film-copy">
              <div className="kicker">{item.kicker}</div>
              <h2>{item.title}</h2>
              <p>{item.body}</p>
              <ul className="points">
                {item.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </Reveal>
            <Reveal className="film-stage" delay={70}>
              <FilmFrame src={item.clip} poster={item.image} alt={item.alt} />
            </Reveal>
          </section>
        ))}
      </div>

      <section className="compare">
        <Reveal>
          <div className="kicker">if you already live in Obsidian</div>
          <h2>Same vault. More product.</h2>
          <p>
            Open the folder you already have. Then you get a thinking layer Obsidian does not ship: Spaces, an AI
            graph, inline writing help, your own cloud, and an Apache-2.0 desktop with no telemetry. A phone client is
            in progress.
          </p>
        </Reveal>
        <CompareTable />
        <p className="compare-foot">
          Coming from an existing vault? <Link to="/docs/obsidian">Open it as a folder</Link>. Full list:{" "}
          <Link to="/docs/features">what's included</Link>.
        </p>
      </section>

      <section className="close-band">
        <Reveal>
          <div className="kicker">start</div>
          <h2>Official builds on GitHub Releases.</h2>
          <p>macOS, Windows, and Linux. Local editing needs no account.</p>
          <div className="hero-actions">
            <Link className="btn primary" to="/download">
              Platform notes
            </Link>
            <a className="btn" href={PRODUCT.latestRelease} target="_blank" rel="noreferrer">
              v{PRODUCT.version} on GitHub
            </a>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
