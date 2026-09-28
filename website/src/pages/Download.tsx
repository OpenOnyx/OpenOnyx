import { useEffect, useMemo, useState } from "react";
import { DOWNLOADS, PRODUCT } from "../data/facts";
import { usePageMeta } from "../lib/meta";

type PlatformId = "macos" | "windows" | "linux";
type Architecture = "arm64" | "x64" | null;
type DownloadFormat = "dmg" | "exe" | "appimage" | "deb" | "arch";

type ReleaseAsset = {
  id: string;
  platform: PlatformId;
  platformLabel: string;
  architecture: Architecture;
  architectureLabel: string;
  format: DownloadFormat;
  formatLabel: string;
  label: string;
  filename: string;
  downloadUrl: string;
  primary?: boolean;
};

type DetectedDevice = {
  platform: PlatformId | null;
  architecture: Architecture;
};

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    platform?: string;
    getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string; platform?: string }>;
  };
};

const RELEASE_ASSETS: ReleaseAsset[] = [
  {
    id: "macos-arm64",
    platform: "macos",
    platformLabel: "macOS",
    architecture: "arm64",
    architectureLabel: "Apple Silicon",
    format: "dmg",
    formatLabel: ".dmg",
    label: "Download for Apple Silicon",
    filename: `OpenOnyx-${PRODUCT.version}-arm64.dmg`,
    downloadUrl: DOWNLOADS.files.macArmDmg,
    primary: true,
  },
  {
    id: "macos-x64",
    platform: "macos",
    platformLabel: "macOS",
    architecture: "x64",
    architectureLabel: "Intel Mac",
    format: "dmg",
    formatLabel: ".dmg",
    label: "Intel Mac",
    filename: `OpenOnyx-${PRODUCT.version}.dmg`,
    downloadUrl: DOWNLOADS.files.macIntelDmg,
  },
  {
    id: "windows-installer",
    platform: "windows",
    platformLabel: "Windows",
    architecture: "x64",
    architectureLabel: "x86_64",
    format: "exe",
    formatLabel: "Installer .exe",
    label: "Download Windows installer",
    filename: `OpenOnyx.Setup.${PRODUCT.version}.exe`,
    downloadUrl: DOWNLOADS.files.winSetup,
    primary: true,
  },
  {
    id: "windows-portable",
    platform: "windows",
    platformLabel: "Windows",
    architecture: "x64",
    architectureLabel: "x86_64",
    format: "exe",
    formatLabel: "Portable .exe",
    label: "Portable .exe",
    filename: `OpenOnyx.${PRODUCT.version}.exe`,
    downloadUrl: DOWNLOADS.files.winPortable,
  },
  {
    id: "linux-appimage",
    platform: "linux",
    platformLabel: "Linux",
    architecture: "x64",
    architectureLabel: "x86_64",
    format: "appimage",
    formatLabel: "AppImage",
    label: "Download AppImage",
    filename: `OpenOnyx-${PRODUCT.version}.AppImage`,
    downloadUrl: DOWNLOADS.files.linuxAppImage,
    primary: true,
  },
  {
    id: "linux-deb",
    platform: "linux",
    platformLabel: "Linux",
    architecture: "x64",
    architectureLabel: "x86_64",
    format: "deb",
    formatLabel: ".deb",
    label: ".deb",
    filename: `openonyx_${PRODUCT.version}_amd64.deb`,
    downloadUrl: DOWNLOADS.files.linuxDeb,
  },
  {
    id: "linux-arch",
    platform: "linux",
    platformLabel: "Linux",
    architecture: "x64",
    architectureLabel: "x86_64",
    format: "arch",
    formatLabel: "Arch package",
    label: "Arch package",
    filename: `openonyx-${PRODUCT.version}-1-x86_64.pkg.tar.zst`,
    downloadUrl: DOWNLOADS.files.linuxArch,
  },
];

const PLATFORM_ORDER: PlatformId[] = ["macos", "windows", "linux"];

function normalizeArchitecture(value = ""): Architecture {
  const source = value.toLowerCase();
  if (source.includes("arm") || source.includes("aarch")) return "arm64";
  if (source.includes("x86") || source.includes("x64") || source.includes("amd64") || source.includes("64")) return "x64";
  return null;
}

function detectPlatformFromText(value: string): PlatformId | null {
  const source = value.toLowerCase();
  if (source.includes("mac")) return "macos";
  if (source.includes("win")) return "windows";
  if (source.includes("linux") || source.includes("x11")) return "linux";
  return null;
}

function detectDevice(): DetectedDevice {
  const nav = navigator as NavigatorWithUserAgentData;
  const platform = detectPlatformFromText(`${nav.userAgentData?.platform ?? ""} ${navigator.platform} ${navigator.userAgent}`);
  return { platform, architecture: normalizeArchitecture(navigator.userAgent) };
}

function choosePrimaryAsset(platform: PlatformId, architecture: Architecture) {
  const assets = RELEASE_ASSETS.filter((asset) => asset.platform === platform);
  if (platform === "macos" && architecture) {
    return assets.find((asset) => asset.architecture === architecture) ?? assets.find((asset) => asset.primary) ?? assets[0];
  }
  return assets.find((asset) => asset.primary) ?? assets[0];
}

function platformInstruction(platform: PlatformId) {
  if (platform === "macos") {
    return "Open the downloaded .dmg, drag OpenOnyx into Applications, then open it from Finder. If macOS warns about an unidentified developer, right-click the app and choose Open.";
  }
  if (platform === "windows") {
    return "Run the installer and follow the prompts. Use the portable executable only if you want to run OpenOnyx without installing it.";
  }
  return "Run the AppImage, install the .deb package, use the Arch package, or run the optional installer script below.";
}

export function Download() {
  const [detected, setDetected] = useState<DetectedDevice>({ platform: null, architecture: null });
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformId>("linux");
  const [copied, setCopied] = useState(false);

  usePageMeta(
    `Download OpenOnyx ${PRODUCT.version}`,
    `Official OpenOnyx ${PRODUCT.version} installers for macOS, Windows, and Linux. Local editing needs no account.`,
  );

  useEffect(() => {
    const initial = detectDevice();
    setDetected(initial);
    if (initial.platform) setSelectedPlatform(initial.platform);

    const nav = navigator as NavigatorWithUserAgentData;
    nav.userAgentData?.getHighEntropyValues?.(["architecture", "platform"])
      .then((values) => {
        const platform = detectPlatformFromText(`${values.platform ?? ""} ${navigator.platform} ${navigator.userAgent}`);
        const architecture = normalizeArchitecture(values.architecture);
        setDetected({ platform: platform ?? initial.platform, architecture: architecture ?? initial.architecture });
        if (platform) setSelectedPlatform(platform);
      })
      .catch(() => {
        /* Low-entropy browser data is enough for the platform fallback. */
      });
  }, []);

  const currentAsset = useMemo(
    () => choosePrimaryAsset(selectedPlatform, detected.architecture),
    [selectedPlatform, detected.architecture],
  );
  const currentPlatformAssets = useMemo(
    () => RELEASE_ASSETS.filter((asset) => asset.platform === selectedPlatform),
    [selectedPlatform],
  );
  const alternatives = currentPlatformAssets.filter((asset) => asset.id !== currentAsset.id);

  async function copyLinuxInstall() {
    try {
      await navigator.clipboard.writeText(DOWNLOADS.linuxInstall);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="download-page">
      <section className="download-primary" aria-labelledby="primary-download-title">
        <div className="download-primary-copy">
          <span>{currentAsset.platformLabel}</span>
          <small>{detected.platform === currentAsset.platform ? "Detected on this device" : detected.platform ? "Selected platform" : "Platform not detected"}</small>
          <h2 id="primary-download-title">Download OpenOnyx {PRODUCT.version}</h2>
        </div>

        <div className="download-action-panel">
          <a className="download-primary-button" href={currentAsset.downloadUrl}>
            {currentAsset.label} ↓
          </a>
          {alternatives.length > 0 && (
            <div className="download-alternatives">
              <span>Other {currentAsset.platformLabel} formats</span>
              <div>
                {alternatives.map((asset) => (
                  <a key={asset.id} href={asset.downloadUrl}>{asset.label}</a>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="download-other" aria-labelledby="other-platforms-title">
        <h2 id="other-platforms-title">Other platforms</h2>
        <div className="download-manifest">
          {PLATFORM_ORDER.map((platform) => {
            const assets = RELEASE_ASSETS.filter((asset) => asset.platform === platform);
            const label = assets[0]?.platformLabel ?? platform;
            return (
              <div key={platform} className={platform === selectedPlatform ? "is-current" : undefined}>
                <button type="button" onClick={() => setSelectedPlatform(platform)} aria-pressed={platform === selectedPlatform}>
                  {label}
                  {platform === selectedPlatform && <span>Current</span>}
                </button>
                <ul>
                  {assets.map((asset) => (
                    <li key={asset.id}>
                      <span>
                        {asset.architectureLabel}
                        <small>{asset.filename}</small>
                      </span>
                      <em>{asset.formatLabel}</em>
                      <a href={asset.downloadUrl}>{asset.label} ↓</a>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <section className="download-ownership" aria-label="Your files stay yours">
        <span>YOUR FILES STAY YOURS</span>
        <p>Installing OpenOnyx doesn't create a hosted workspace. Your vault remains ordinary Markdown files on your disk.</p>
      </section>

      <section className="download-install" aria-labelledby="installation-title">
        <h2 id="installation-title">Installation</h2>
        <ol>
          <li><span>01 / DOWNLOAD</span><p>Choose the package for your operating system.</p></li>
          <li><span>02 / INSTALL</span><p>{platformInstruction(selectedPlatform)}</p></li>
          <li><span>03 / OPEN A FOLDER</span><p>Choose an existing Markdown folder or create a new vault.</p></li>
        </ol>
        {selectedPlatform === "linux" && (
          <div className="download-command">
            <div><span>Optional Linux install script</span><button type="button" onClick={copyLinuxInstall}>{copied ? "Copied" : "Copy"}</button></div>
            <pre><code>{DOWNLOADS.linuxInstall}</code></pre>
          </div>
        )}
      </section>

      <section className="download-source" aria-labelledby="source-title">
        <h2 id="source-title">Open source by default</h2>
        <div className="download-trust-list">
          <div><span>Source code</span><p>GitHub repository</p><a href={PRODUCT.repo} target="_blank" rel="noreferrer">View source ↗</a></div>
          <div><span>Releases</span><p>Every published build</p><a href={PRODUCT.latestRelease} target="_blank" rel="noreferrer">View releases ↗</a></div>
          <div><span>License</span><p>{PRODUCT.license}</p><a href={`${PRODUCT.repo}/blob/main/LICENSE`} target="_blank" rel="noreferrer">View license ↗</a></div>
        </div>
      </section>
    </section>
  );
}
