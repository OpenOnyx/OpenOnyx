/** Website palette is Ctrl/Cmd+K. Label it for the machine in front of the reader. */
export function isApplePlatform() {
  if (typeof navigator === "undefined") return false;
  const platform = navigator.platform || "";
  const ua = navigator.userAgent || "";
  return /Mac|iPhone|iPad|iPod/.test(platform) || /Mac OS X|iPhone|iPad|iPod/.test(ua);
}

export function paletteHotkeyLabel() {
  return isApplePlatform() ? "⌘K" : "Ctrl+K";
}
