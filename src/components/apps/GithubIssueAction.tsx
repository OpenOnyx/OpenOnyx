import React, { useEffect, useRef, useState } from "react";
import type { McpServerSnapshot } from "../../types/mcp";
import { getAPI } from "../../utils/api";
import { identifyAppId } from "../../utils/appRegistry";
import { createGithubProvider } from "../../utils/githubProvider";
import { openResource } from "./ResourceCard";
import { rememberResource } from "../../utils/appResources";
import { ResourceDialog } from "./ResourceDialog";

export function GithubIssueAction({ selection, onClose }: { selection: string; onClose: () => void }) {
  const [server, setServer] = useState<McpServerSnapshot | null>(null);
  const [repository, setRepository] = useState("");
  const [title, setTitle] = useState(selection.split("\n")[0].slice(0, 120));
  const [body, setBody] = useState(selection);
  const [labels, setLabels] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    getAPI().mcp.list().then((servers) => {
      if (!alive.current) return;
      const connected = servers.find((item) => identifyAppId(item) === "github" && item.runtime.status === "connected" && item.config.enabledTools.includes("create_issue"));
      setServer(connected || null);
      if (!connected) setError("Connect GitHub and allow Create issues in Settings → Apps. Creating issues also requires an authenticated provider.");
    }).catch((error) => { if (alive.current) setError(String(error)); });
    return () => { alive.current = false; };
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!server || busy) return;
    setBusy(true); setError("");
    try {
      const resource = await createGithubProvider(server).createIssue({ repository, title, body, labels: labels.split(",").map((item) => item.trim()).filter(Boolean) });
      if (alive.current) { rememberResource(resource); onClose(); openResource(resource); }
    } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : "Could not create issue"); }
    finally { if (alive.current) setBusy(false); }
  };
  return <ResourceDialog title="Create GitHub issue" onClose={onClose}>
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <label className="text-sm">Repository<input required pattern="[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+" value={repository} onChange={(event) => setRepository(event.target.value)} className="app-resource-input" placeholder="owner/repository" /></label>
      <label className="text-sm">Title<input required maxLength={256} value={title} onChange={(event) => setTitle(event.target.value)} className="app-resource-input" /></label>
      <label className="text-sm">Body<textarea value={body} onChange={(event) => setBody(event.target.value)} className="app-resource-input min-h-40" /></label>
      <label className="text-sm">Labels<input value={labels} onChange={(event) => setLabels(event.target.value)} className="app-resource-input" placeholder="bug, windows" /></label>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <div className="flex justify-end gap-3"><button type="button" onClick={onClose} className="app-resource-secondary">Cancel</button><button type="submit" disabled={!server || busy} className="app-resource-primary">{busy ? "Creating…" : "Create issue"}</button></div>
    </form>
  </ResourceDialog>;
}
