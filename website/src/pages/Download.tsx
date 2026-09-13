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
        OpenOnyx is an Electron desktop app. These buttons download the {PRODUCT.version} files from GitHub
        Releases. You can also build from source with Node.js 22+.
      </p>

      <div className="download-grid">
        <article className="card">
          <h3>macOS</h3>
          <p>Apple Silicon and Intel .dmg from the v{PRODUCT.version} release. Zip archives are on the same page.</p>
          <div className="card-actions">
            <a className="btn primary" href={DOWNLOADS.files.macArmDmg}>
              Apple Silicon .dmg
            </a>
            <a className="btn" href={DOWNLOADS.files.macIntelDmg}>
              Intel .dmg
            </a>
          </div>
          <p className="download-more">
            <a href={PRODUCT.latestRelease} target="_blank" rel="noreferrer">
              All macOS files on the release
            </a>
          </p>
          <p>{DOWNLOADS.macNote}</p>
        </article>
        <article className="card">
          <h3>Windows</h3>
          <p>NSIS installer and portable .exe from the v{PRODUCT.version} release.</p>
          <div className="card-actions">
            <a className="btn primary" href={DOWNLOADS.files.winSetup}>
              Windows installer
            </a>
            <a className="btn" href={DOWNLOADS.files.winPortable}>
              Portable .exe
            </a>
          </div>
          <p className="download-more">
            <a href={PRODUCT.latestRelease} target="_blank" rel="noreferrer">
              All Windows files on the release
            </a>
          </p>
          <p>{DOWNLOADS.windowsNote}</p>
        </article>
        <article className="card">
          <h3>Linux</h3>
          <p>AppImage, .deb, and Arch .pkg.tar.zst from the v{PRODUCT.version} release, or the installer script.</p>
          <div className="card-actions">
            <a className="btn primary" href={DOWNLOADS.files.linuxAppImage}>
              AppImage
            </a>
            <a className="btn" href={DOWNLOADS.files.linuxDeb}>
              .deb
            </a>
            <a className="btn" href={DOWNLOADS.files.linuxArch}>
              Arch package
            </a>
          </div>
          <p className="download-more">
            <a href={PRODUCT.latestRelease} target="_blank" rel="noreferrer">
              All Linux files on the release
            </a>
          </p>
          <pre>{DOWNLOADS.linuxInstall}</pre>
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
