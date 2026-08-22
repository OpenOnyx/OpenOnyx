import { DOWNLOADS, PRODUCT } from "../data/facts";
import { usePageMeta } from "../lib/meta";

export function Download() {
  usePageMeta(
    `Download OpenOnyx ${PRODUCT.version}`,
    `Official OpenOnyx ${PRODUCT.version} installers for macOS, Windows, and Linux. Local editing needs no account.`,
  );

  return (
    <section className="section">
      <div className="kicker">download · v{PRODUCT.version}</div>
      <h1>official binaries from GitHub Releases.</h1>
      <p style={{ color: "var(--muted)", maxWidth: 640 }}>
        OpenOnyx is an Electron desktop app. Grab the installer for your OS from the {PRODUCT.version} release,
        or build from source with Node.js 22+.
      </p>

      <div className="download-grid">
        <article className="card">
          <h3>macOS</h3>
          <p>.dmg and .zip from the release. Apple Silicon and Intel artifacts are produced by the macOS builder.</p>
          <a className="btn primary" href={PRODUCT.latestRelease} target="_blank" rel="noreferrer">
            Get macOS build
          </a>
          <p style={{ marginTop: 14 }}>{DOWNLOADS.macNote}</p>
        </article>
        <article className="card">
          <h3>Windows</h3>
          <p>NSIS and portable .exe from the release.</p>
          <a className="btn primary" href={PRODUCT.latestRelease} target="_blank" rel="noreferrer">
            Get Windows build
          </a>
          <p style={{ marginTop: 14 }}>{DOWNLOADS.windowsNote}</p>
        </article>
        <article className="card">
          <h3>Linux</h3>
          <p>AppImage, .deb, and Arch .pkg.tar.zst from the current release.</p>
          <a className="btn primary" href={PRODUCT.latestRelease} target="_blank" rel="noreferrer">
            Get Linux build
          </a>
          <pre style={{ marginTop: 14, fontSize: 12 }}>{DOWNLOADS.linuxInstall}</pre>
        </article>
      </div>

      <div className="card source-card" style={{ marginTop: 12 }}>
        <h3>Run from source</h3>
        <p>
          Requires {PRODUCT.engines}. This starts Electron against the Vite dev server on port {PRODUCT.vitePort}.
        </p>
        <pre>{`git clone https://github.com/OpenOnyx/OpenOnyx.git
cd OpenOnyx
npm install
npm run dev`}</pre>
      </div>
    </section>
  );
}
