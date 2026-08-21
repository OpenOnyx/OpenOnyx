import React, { useState } from "react";
import {
  clearSavedUserDatabaseConfig,
  connectUserDatabase,
  disconnectUserDatabase,
  getUserDatabaseConfig,
  loadSavedUserDatabaseConfig,
  saveUserDatabaseConfig,
  testConnection,
  type UserDatabaseConfig,
} from "../../../lib/userDatabase";
import { configureSupabaseClient } from "../../../lib/supabase";
import { parseSupabaseEnv } from "../../../lib/supabaseConfig";
import databaseSchemaSql from "../../../../supabase/schema.sql?raw";
import { getAPI } from "../../../utils/api";
import { PreferenceCard } from "./PreferenceCard";

export function DatabaseInfrastructureView() {
  const [databaseConfig, setDatabaseConfig] = useState<UserDatabaseConfig>(() => (
    loadSavedUserDatabaseConfig() ||
    getUserDatabaseConfig() || {
      supabaseUrl: "",
      anonKey: "",
    }
  ));
  const [databaseEnvText, setDatabaseEnvText] = useState("");
  const [databaseStatus, setDatabaseStatus] = useState<{ type: "idle" | "success" | "error" | "info"; message: string }>(() => (
    loadSavedUserDatabaseConfig()
      ? { type: "success", message: "Saved local Supabase credentials are active." }
      : { type: "idle", message: "" }
  ));
  const [databaseSchemaCopyStatus, setDatabaseSchemaCopyStatus] = useState<{ type: "idle" | "success" | "error"; message: string }>({ type: "idle", message: "" });
  const [isTestingDatabase, setIsTestingDatabase] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const normalizedDatabaseConfig = (): UserDatabaseConfig => ({
    supabaseUrl: databaseConfig.supabaseUrl.trim(),
    anonKey: databaseConfig.anonKey.trim(),
  });

  const handleImportDatabaseEnv = () => {
    const parsed = parseSupabaseEnv(databaseEnvText);
    if (!parsed.supabaseUrl && !parsed.anonKey) {
      setDatabaseStatus({ type: "error", message: "Could not locate VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY." });
      return;
    }
    setDatabaseConfig((current) => ({
      supabaseUrl: parsed.supabaseUrl || current.supabaseUrl,
      anonKey: parsed.anonKey || current.anonKey,
    }));
    setDatabaseStatus({ type: "info", message: "Imported credentials. Click Save to activate." });
  };

  const handleTestDatabaseConnection = async () => {
    const config = normalizedDatabaseConfig();
    if (!config.supabaseUrl || !config.anonKey) {
      setDatabaseStatus({ type: "error", message: "Supabase URL and API Key are required." });
      return;
    }
    setIsTestingDatabase(true);
    setDatabaseStatus({ type: "info", message: "Testing connection..." });
    try {
      const result = await testConnection(config);
      setDatabaseStatus(result.ok ? { type: "success", message: "Connection verified." } : { type: "error", message: result.error || "Connection failed." });
    } finally {
      setIsTestingDatabase(false);
    }
  };

  const handleSaveDatabaseConfig = async () => {
    const config = normalizedDatabaseConfig();
    if (!config.supabaseUrl || !config.anonKey) {
      setDatabaseStatus({ type: "error", message: "Supabase URL and API Key are required." });
      return;
    }
    try {
      configureSupabaseClient(config);
      const saved = saveUserDatabaseConfig(config);
      connectUserDatabase(saved);
      setDatabaseConfig(saved);
      setDatabaseStatus({ type: "success", message: "Saved locally. Storage sync active." });
    } catch (err: any) {
      setDatabaseStatus({ type: "error", message: err.message || "Failed to save database configuration." });
    }
  };

  const handleClearDatabaseConfig = async () => {
    clearSavedUserDatabaseConfig();
    disconnectUserDatabase();
    configureSupabaseClient();
    setDatabaseConfig({ supabaseUrl: "", anonKey: "" });
    setDatabaseEnvText("");
    setDatabaseStatus({ type: "info", message: "Credentials cleared from local device." });
  };

  const handleCopyDatabaseSchema = async () => {
    try {
      await getAPI().writeClipboardText(databaseSchemaSql);
      setDatabaseSchemaCopyStatus({ type: "success", message: "Copied migration SQL script to clipboard." });
    } catch {
      setDatabaseSchemaCopyStatus({ type: "error", message: "Failed to copy migration SQL." });
    }
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="border-b border-[var(--border-subtle)] pb-4">
        <h2 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
          Sync & Cloud Storage
        </h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Manage cloud space sync, device connection, and database storage endpoints.
        </p>
      </div>

      {/* Connection Overview */}
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Connection Status</span>
            <div className="mt-1 text-sm font-bold text-[var(--text-primary)]">
              {databaseConfig.supabaseUrl ? "Configured" : "Disconnected"}
            </div>
          </div>
          <div className="text-right">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Endpoint</span>
            <div className="mt-1 text-xs font-mono text-[var(--text-muted)] truncate max-w-xs">
              {databaseConfig.supabaseUrl || "None"}
            </div>
          </div>
        </div>
      </div>

      {/* Credentials Form */}
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5">
        <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
          Supabase Credentials
        </h3>
        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
              Project URL
            </label>
            <input
              type="text"
              value={databaseConfig.supabaseUrl}
              onChange={(e) => setDatabaseConfig((current) => ({ ...current, supabaseUrl: e.target.value }))}
              placeholder="https://your-project.supabase.co"
              className="h-8 w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-tertiary)] px-3 text-xs font-mono text-[var(--text-primary)] outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
              Anon API Key
            </label>
            <input
              type="password"
              value={databaseConfig.anonKey}
              onChange={(e) => setDatabaseConfig((current) => ({ ...current, anonKey: e.target.value }))}
              placeholder="eyJhbGciOi..."
              className="h-8 w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-tertiary)] px-3 text-xs font-mono text-[var(--text-primary)] outline-none"
            />
          </div>

          {/* Action Bar */}
          <div className="mt-2 flex items-center justify-between">
            <div className="text-xs font-semibold text-[var(--text-primary)]">
              {databaseStatus.message}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTestDatabaseConnection}
                disabled={isTestingDatabase}
                className="h-8 rounded-md border border-[var(--border-medium)] bg-[var(--bg-tertiary)] px-3 text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              >
                {isTestingDatabase ? "Testing..." : "Test Connection"}
              </button>
              <button
                type="button"
                onClick={handleSaveDatabaseConfig}
                className="h-8 rounded-md bg-[var(--text-primary)] px-3 text-xs font-bold text-[var(--bg-primary)] hover:opacity-90"
              >
                Save
              </button>
              <button
                type="button"
                onClick={handleClearDatabaseConfig}
                className="h-8 rounded-md border border-[var(--border-medium)] bg-transparent px-3 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Expandable Advanced Options Accordion */}
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAdvanced((prev) => !prev)}
          className="flex w-full items-center justify-between p-4 text-left text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
        >
          <span>Advanced Sync & Database Options</span>
          <span>{showAdvanced ? "▲ Hide" : "▼ Show"}</span>
        </button>

        {showAdvanced && (
          <div className="flex flex-col gap-5 border-t border-[var(--border-subtle)] p-5">
            {/* Import from .env */}
            <div>
              <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
                Import from .env Text
              </h4>
              <p className="mb-3 text-xs text-[var(--text-muted)]">
                Paste text containing VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to auto-populate credentials.
              </p>
              <textarea
                rows={3}
                value={databaseEnvText}
                onChange={(e) => setDatabaseEnvText(e.target.value)}
                placeholder={"VITE_SUPABASE_URL=https://project.supabase.co\nVITE_SUPABASE_ANON_KEY=eyJhbGciOi..."}
                className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-tertiary)] p-3 text-xs font-mono text-[var(--text-primary)] outline-none"
              />
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={handleImportDatabaseEnv}
                  className="h-8 rounded-md border border-[var(--border-medium)] bg-[var(--bg-tertiary)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                >
                  Import Values
                </button>
              </div>
            </div>

            {/* Schema Migration Runner */}
            <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-4">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">Schema Migration SQL</h4>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  Copy bundled schema.sql script to initialize your database tables and RLS policies.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCopyDatabaseSchema}
                className="h-8 rounded-md bg-[var(--bg-tertiary)] px-3 text-xs font-semibold text-[var(--text-primary)] border border-[var(--border-medium)] hover:bg-[var(--bg-hover)]"
              >
                Copy SQL
              </button>
            </div>
            {databaseSchemaCopyStatus.message && (
              <span className="text-xs font-semibold text-[var(--text-primary)]">{databaseSchemaCopyStatus.message}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
