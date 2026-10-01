import React from "react";
import { Database, Folder, Plug } from "lucide-react";
import type { AppIconKey } from "../../../../utils/appRegistry";

const baseClass = "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[12px] font-bold shadow-none";

function GoogleDriveMark() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true" className="h-6 w-6">
      <path d="M14 4h8l10 17h-8z" fill="#188038" />
      <path d="M4 25 14 4l4 7-7 14z" fill="#1967D2" />
      <path d="M11 25h21l-4 7H7z" fill="#F9AB00" />
    </svg>
  );
}

function GmailMark() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true" className="h-6 w-6">
      <path d="M6 10h24v17H6z" fill="#fff" opacity="0.95" />
      <path d="M6 10v17h5V15z" fill="#EA4335" />
      <path d="M30 10v17h-5V15z" fill="#34A853" />
      <path d="M6 10l12 10L30 10v5L18 25 6 15z" fill="#EA4335" />
      <path d="M11 27h14v-5H11z" fill="#F9AB00" />
      <path d="M25 27h5V15l-5 4z" fill="#4285F4" />
    </svg>
  );
}

function CalendarMark() {
  return (
    <span className="grid h-6 w-6 overflow-hidden rounded border border-[#4285F4]/40 bg-white text-center font-bold leading-none text-[#1A73E8]">
      <span className="h-1.5 bg-[#4285F4]" />
      <span className="self-center text-[11px]">31</span>
    </span>
  );
}

function SlackMark() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true" className="h-6 w-6">
      <rect x="15" y="3" width="6" height="14" rx="3" fill="#36C5F0" />
      <rect x="3" y="15" width="14" height="6" rx="3" fill="#2EB67D" />
      <rect x="15" y="19" width="6" height="14" rx="3" fill="#ECB22E" />
      <rect x="19" y="15" width="14" height="6" rx="3" fill="#E01E5A" />
    </svg>
  );
}

function DiscordMark() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true" className="h-6 w-6 text-[#5865F2]">
      <path fill="currentColor" d="M9 10c4-3 14-3 18 0 2 4 3 8 2 14-4 3-7 4-10 4l-1-2c-2 .2-4 0-6-.8l-2 2c-3-.7-5-1.8-7-3.2-.5-5 .8-10 3-14z" />
      <circle cx="14" cy="19" r="2" fill="white" />
      <circle cx="22" cy="19" r="2" fill="white" />
    </svg>
  );
}

function TelegramMark() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true" className="h-6 w-6">
      <circle cx="18" cy="18" r="15" fill="#229ED9" />
      <path d="M10 17.5 26 11l-3.5 15-5-4-3 3 .5-5z" fill="white" />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true" className="h-6 w-6 text-[var(--text-primary)]">
      <path fill="currentColor" fillRule="evenodd" d="M18 4C10.3 4 4 10.4 4 18.2c0 6.2 4 11.5 9.5 13.4.7.1 1-.3 1-.7v-2.6c-3.9.8-4.7-1.7-4.7-1.7-.6-1.6-1.5-2-1.5-2-1.3-.9.1-.9.1-.9 1.4.1 2.1 1.5 2.1 1.5 1.2 2.1 3.2 1.5 4 1.1.1-.9.5-1.5.9-1.9-3.1-.4-6.3-1.6-6.3-7a5.5 5.5 0 0 1 1.4-3.8c-.1-.4-.6-1.8.2-3.7 0 0 1.2-.4 3.9 1.5a13 13 0 0 1 7 0c2.7-1.9 3.9-1.5 3.9-1.5.8 1.9.3 3.3.2 3.7a5.5 5.5 0 0 1 1.5 3.8c0 5.4-3.3 6.6-6.4 7 .5.4.9 1.2.9 2.4v3.6c0 .4.3.9 1 .7A14.2 14.2 0 0 0 32 18.2C32 10.4 25.7 4 18 4z" clipRule="evenodd" />
    </svg>
  );
}

function LinearMark() {
  return <span className="text-lg leading-none text-[#5E6AD2]">◆</span>;
}

function NotionMark() {
  return <span className="font-serif text-lg leading-none text-[var(--text-primary)]">N</span>;
}

function iconNode(icon: AppIconKey): React.ReactNode {
  if (icon === "github") return <GitHubMark />;
  if (icon === "google-drive") return <GoogleDriveMark />;
  if (icon === "google-calendar") return <CalendarMark />;
  if (icon === "discord") return <DiscordMark />;
  if (icon === "telegram") return <TelegramMark />;
  if (icon === "notion") return <NotionMark />;
  if (icon === "gmail") return <GmailMark />;
  if (icon === "slack") return <SlackMark />;
  if (icon === "linear") return <LinearMark />;
  if (icon === "folder") return <Folder size={19} className="text-amber-500" />;
  if (icon === "database") return <Database size={18} className="text-[var(--text-secondary)]" />;
  return <Plug size={18} className="text-[var(--text-secondary)]" />;
}

export function AppIcon({ icon, className = "" }: { icon: AppIconKey; className?: string }) {
  return <span className={`${baseClass} ${className}`} aria-hidden="true">{iconNode(icon)}</span>;
}
