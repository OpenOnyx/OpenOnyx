/**
 * Welcome Screen
 *
 * Displayed when no vault is selected. Provides vault opening
 * and a polished first-use experience (Onyx Studio entry).
 */

import React, { useEffect, useRef, useState } from "react";
import { FolderOpen, Plus } from "lucide-react";
import { Theme } from "../../types";
import { isDarkTheme } from "../../utils/helpers";
import type { AppSettings } from "./SettingsPage";

export type VaultEntryAction = "open" | "create";
export type VaultEntryTransitionPhase = "idle" | "transitioning" | "entered";

interface WelcomeScreenProps {
  onOpenVault: (action: VaultEntryAction) => void;
  transitionPhase?: VaultEntryTransitionPhase;
  theme?: Theme;
  settings?: AppSettings;
}

export function WelcomeScreen({
  onOpenVault,
  transitionPhase = "idle",
  theme = "dark",
  settings,
}: WelcomeScreenProps) {
  const [pressedAction, setPressedAction] = useState<VaultEntryAction | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const isDark = isDarkTheme(theme, settings);

  useEffect(() => {
    return () => {
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
      }
    };
  }, []);

  const actionsDisabled = transitionPhase !== "idle";

  const handleAction = (action: VaultEntryAction) => {
    if (actionsDisabled) return;

    setPressedAction(action);
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
    }
    pressTimerRef.current = setTimeout(() => {
      setPressedAction(null);
      pressTimerRef.current = null;
    }, 140);

    onOpenVault(action);
  };

  return (
    <div
      className="relative flex h-full w-full select-none flex-col items-center justify-center overflow-hidden bg-[var(--oo-surface-0,var(--bg-primary))] text-[var(--oo-text-primary,var(--text-primary))]"
      ref={screenRef}
      data-transition-phase={transitionPhase}
    >
      {/* Quiet mineral banding — decorative only */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.45]"
        style={{
          background: isDark
            ? "radial-gradient(ellipse 80% 50% at 50% 40%, color-mix(in srgb, var(--oo-accent, #E8A84A) 8%, transparent), transparent 70%)"
            : "radial-gradient(ellipse 80% 50% at 50% 40%, color-mix(in srgb, var(--oo-accent, #B45309) 6%, transparent), transparent 70%)",
        }}
      />

      <div className="relative z-[1] flex flex-col items-center px-6">
        <div
          className={`mb-7 flex h-[5.5rem] w-[5.5rem] items-center justify-center rounded-2xl border p-3.5 shadow-sm ${
            isDark
              ? "border-[var(--oo-border-subtle)] bg-[var(--oo-surface-2)]"
              : "border-[var(--oo-border-subtle)] bg-[var(--oo-surface-2,#FFFFFF)]"
          }`}
        >
          <img
            src={isDark ? "logos/logo-dark.png" : "logos/logo-light.png"}
            alt="OpenOnyx"
            className="h-full w-full object-contain"
          />
        </div>

        <h1 className="mb-2 text-[2rem] font-bold tracking-tight text-[var(--oo-text-primary,var(--text-primary))]">
          OpenOnyx
        </h1>
        <p className="mb-1 max-w-[380px] text-center text-[15px] font-medium text-[var(--oo-text-secondary,var(--text-secondary))]">
          Local-first knowledge studio
        </p>
        <p className="mb-9 max-w-[400px] text-center text-[13px] leading-relaxed text-[var(--oo-text-muted,var(--text-muted))]">
          Your files stay yours. Open a Markdown vault to write, link, and explore
          ideas in a professional desktop workspace.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--oo-accent,var(--accent-primary))] bg-[var(--oo-accent,var(--accent-primary))] px-6 py-3 text-[15px] font-semibold text-[var(--oo-accent-on,var(--text-on-accent))] transition-all duration-150 hover:border-[var(--oo-accent-hover,var(--accent-secondary))] hover:bg-[var(--oo-accent-hover,var(--accent-secondary))] disabled:cursor-not-allowed disabled:opacity-50 ${
              pressedAction === "open" ? "scale-95" : ""
            }`}
            onClick={() => handleAction("open")}
            disabled={actionsDisabled}
          >
            <FolderOpen size={18} strokeWidth={2} /> Open vault
          </button>
          <button
            type="button"
            className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--oo-border-medium,var(--border-subtle))] bg-[var(--oo-surface-1,var(--bg-secondary))] px-6 py-3 text-[15px] font-semibold text-[var(--oo-text-primary,var(--text-primary))] transition-all duration-150 hover:border-[var(--oo-border-strong,var(--border-medium))] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50 ${
              pressedAction === "create" ? "scale-95" : ""
            }`}
            onClick={() => handleAction("create")}
            disabled={actionsDisabled}
          >
            <Plus size={18} strokeWidth={2} /> Create vault
          </button>
        </div>
      </div>
    </div>
  );
}
