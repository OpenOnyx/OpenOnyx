import React from "react";
import type { ExternalResource } from "../../types/appResources";
import { DriveResourcePicker } from "./DriveResourcePicker";
import { GithubResourcePicker } from "./GithubResourcePicker";
import { openResource } from "./ResourceCard";

// Add trusted local provider surfaces here. The editor never imports provider UI.
const RESOURCE_PICKERS: Record<string, React.ComponentType<{ onClose: () => void; onSelect: (resource: ExternalResource) => void; initialServerId?: string }>> = { github: GithubResourcePicker, "google-drive": DriveResourcePicker };

/** The command surface browses objects; technical runners live in Advanced. */
export function AppResourcePicker({ onClose, onSelect, providerId = "github", serverId }: { onClose: () => void; onSelect?: (resource: ExternalResource) => void; providerId?: string; serverId?: string }) {
  const Picker = RESOURCE_PICKERS[providerId];
  if (!Picker) return null;
  return <Picker initialServerId={serverId} onClose={onClose} onSelect={(resource) => {
    if (onSelect) { onSelect(resource); return; }
    const detail = { resource, inserted: false };
    window.dispatchEvent(new CustomEvent("openonyx:resource-insert", { detail }));
    onClose();
    if (!detail.inserted) openResource(resource);
  }} />;
}
