/**
 * FormattingToolbar — Onyx-style rich-text formatting strip
 * Dispatches markdown formatting commands to the active CodeMirror editor.
 */

import React, { useState, useEffect, useRef } from "react";
import {
  Bold,
  Italic,
  Strikethrough,
  Underline,
  Heading,
  List,
  ListOrdered,
  Quote,
  Code,
  Link2,
  Image,
  Table,
  Highlighter,
  RemoveFormatting,
  ChevronDown,
  Type,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  MoreHorizontal,
} from "lucide-react";

const toolbarClass =
  "onyx-toolbar flex h-9 min-h-9 shrink-0 items-center gap-0.5 overflow-visible border-b border-[var(--divider-color)] bg-[var(--bg-toolbar,var(--bg-secondary))] px-2";
const groupClass = "flex items-center gap-0.5";
const sepClass = "mx-1 h-4 w-px shrink-0 bg-[var(--border-subtle)]";
const btnClass =
  "flex h-7 min-w-7 cursor-pointer items-center justify-center gap-0.5 rounded-[4px] border-0 bg-transparent px-1.5 text-[var(--text-secondary)] transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
const btnWideClass = `${btnClass} px-2 text-[12px] font-medium`;

function dispatchFormat(command: string) {
  document.dispatchEvent(
    new CustomEvent("editor:format", { detail: { command } }),
  );
}

interface ToolBtnProps {
  title: string;
  command?: string;
  onClick?: () => void;
  children: React.ReactNode;
  wide?: boolean;
}

function ToolBtn({ title, command, onClick, children, wide }: ToolBtnProps) {
  return (
    <button
      type="button"
      className={wide ? btnWideClass : btnClass}
      title={title}
      onClick={() => {
        if (onClick) onClick();
        else if (command) dispatchFormat(command);
      }}
    >
      {children}
    </button>
  );
}

export function FormattingToolbar() {
  const [headingOpen, setHeadingOpen] = useState(false);
  const [fontSizeOpen, setFontSizeOpen] = useState(false);
  const [alignOpen, setAlignOpen] = useState(false);
  const [activeHeading, setActiveHeading] = useState<number | null>(null);

  const headingRef = useRef<HTMLDivElement>(null);
  const fontSizeRef = useRef<HTMLDivElement>(null);
  const alignRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (headingRef.current && !headingRef.current.contains(target)) {
        setHeadingOpen(false);
      }
      if (fontSizeRef.current && !fontSizeRef.current.contains(target)) {
        setFontSizeOpen(false);
      }
      if (alignRef.current && !alignRef.current.contains(target)) {
        setAlignOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    const handleFormatState = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail) {
        setActiveHeading(customEvent.detail.heading);
      }
    };
    document.addEventListener("editor:format-state", handleFormatState);
    return () => {
      document.removeEventListener("editor:format-state", handleFormatState);
    };
  }, []);

  return (
    <div
      className={toolbarClass}
      role="toolbar"
      aria-label="Formatting"
      style={{ backgroundColor: 'var(--bg-toolbar, var(--bg-secondary))' }}
    >
      <div className={groupClass}>
        {/* Heading Dropdown */}
        <div className="relative" ref={headingRef}>
          <button
            type="button"
            className={btnWideClass}
            title="Heading"
            onClick={() => setHeadingOpen(!headingOpen)}
          >
            <span>
              {activeHeading === 1
                ? "Heading 1"
                : activeHeading === 2
                ? "Heading 2"
                : activeHeading === 3
                ? "Heading 3"
                : activeHeading === 4
                ? "Heading 4"
                : "Normal Text"}
            </span>
            <ChevronDown size={12} strokeWidth={2} className="opacity-60" />
          </button>
          {headingOpen && (
            <div
              className="absolute top-full left-0 z-[4000] mt-1 min-w-[130px] rounded-lg border border-[var(--border-subtle,#2c2c2e)] bg-[var(--bg-elevated,#1e1e1f)] py-1 shadow-lg"
              style={{ boxShadow: "0 4px 12px rgba(0, 0, 0, 0.25)" }}
            >
              {[
                { label: "Heading 1", cmd: "heading-1", level: 1 },
                { label: "Heading 2", cmd: "heading-2", level: 2 },
                { label: "Heading 3", cmd: "heading-3", level: 3 },
                { label: "Heading 4", cmd: "heading-4", level: 4 },
                { label: "Normal Text", cmd: "heading-normal", level: null },
              ].map((opt) => (
                <button
                  key={opt.cmd}
                  type="button"
                  className={`flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-[12px] font-medium border-0 bg-transparent transition-colors ${
                    activeHeading === opt.level
                      ? "text-[var(--color-accent)] bg-[var(--bg-hover)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  }`}
                  onClick={() => {
                    dispatchFormat(opt.cmd);
                    setHeadingOpen(false);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Font Size Dropdown */}
        <div className="relative" ref={fontSizeRef}>
          <button
            type="button"
            className={btnWideClass}
            title="Font size"
            onClick={() => setFontSizeOpen(!fontSizeOpen)}
          >
            <Type size={14} strokeWidth={1.75} />
            <ChevronDown size={12} strokeWidth={2} className="opacity-60" />
          </button>
          {fontSizeOpen && (
            <div
              className="absolute top-full left-0 z-[4000] mt-1 min-w-[130px] rounded-lg border border-[var(--border-subtle,#2c2c2e)] bg-[var(--bg-elevated,#1e1e1f)] py-1 shadow-lg"
              style={{ boxShadow: "0 4px 12px rgba(0, 0, 0, 0.25)" }}
            >
              {[
                { label: "Small (85%)", cmd: "font-size-small" },
                { label: "Normal (100%)", cmd: "font-size-normal" },
                { label: "Medium (120%)", cmd: "font-size-medium" },
                { label: "Large (150%)", cmd: "font-size-large" },
                { label: "Max", cmd: "font-size-xl" },
              ].map((opt) => (
                <button
                  key={opt.cmd}
                  type="button"
                  className="flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] border-0 bg-transparent"
                  onClick={() => {
                    dispatchFormat(opt.cmd);
                    setFontSizeOpen(false);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={sepClass} />

      <div className={groupClass}>
        <ToolBtn title="Bold (Ctrl+B)" command="bold">
          <Bold size={15} strokeWidth={2.25} />
        </ToolBtn>
        <ToolBtn title="Italic (Ctrl+I)" command="italic">
          <Italic size={15} strokeWidth={1.75} />
        </ToolBtn>
        <ToolBtn title="Underline" command="underline">
          <Underline size={15} strokeWidth={1.75} />
        </ToolBtn>
        <ToolBtn title="Strikethrough" command="strikethrough">
          <Strikethrough size={15} strokeWidth={1.75} />
        </ToolBtn>
      </div>

      <div className={sepClass} />

      <div className={groupClass}>
        <ToolBtn title="Highlight" command="highlight">
          <Highlighter size={15} strokeWidth={1.75} />
        </ToolBtn>
        <ToolBtn title="Text color" command="text-color">
          <span className="relative flex h-4 w-4 items-center justify-center">
            <span className="text-[13px] font-semibold leading-none">A</span>
            <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-[#ef4444]" />
          </span>
        </ToolBtn>
        <ToolBtn title="Clear formatting" command="clear-format">
          <RemoveFormatting size={15} strokeWidth={1.75} />
        </ToolBtn>
      </div>

      <div className={sepClass} />

      <div className={groupClass}>
        <ToolBtn title="Bullet list" command="bullet-list">
          <List size={15} strokeWidth={1.75} />
        </ToolBtn>
        <ToolBtn title="Numbered list" command="numbered-list">
          <ListOrdered size={15} strokeWidth={1.75} />
        </ToolBtn>
        <ToolBtn title="Blockquote" command="blockquote">
          <Quote size={15} strokeWidth={1.75} />
        </ToolBtn>
        <ToolBtn title="Inline code" command="code">
          <Code size={15} strokeWidth={1.75} />
        </ToolBtn>
      </div>

      <div className={sepClass} />

      <div className={groupClass}>
        <ToolBtn title="Link" command="link">
          <Link2 size={15} strokeWidth={1.75} />
        </ToolBtn>
        <ToolBtn title="Image" command="image">
          <Image size={15} strokeWidth={1.75} />
        </ToolBtn>
        <ToolBtn title="Table" command="table">
          <Table size={15} strokeWidth={1.75} />
        </ToolBtn>
        
        {/* Align Dropdown */}
        <div className="relative" ref={alignRef}>
          <button
            type="button"
            className={btnClass}
            title="Align text"
            onClick={() => setAlignOpen(!alignOpen)}
          >
            <AlignLeft size={15} strokeWidth={1.75} />
            <ChevronDown size={11} strokeWidth={2} className="opacity-60 -ml-0.5" />
          </button>
          {alignOpen && (
            <div
              className="absolute top-full left-0 z-[4000] mt-1 min-w-[130px] rounded-lg border border-[var(--border-subtle,#2c2c2e)] bg-[var(--bg-elevated,#1e1e1f)] py-1 shadow-lg"
              style={{ boxShadow: "0 4px 12px rgba(0, 0, 0, 0.25)" }}
            >
              {[
                { label: "Align Left", cmd: "align-left", icon: AlignLeft },
                { label: "Align Center", cmd: "align-center", icon: AlignCenter },
                { label: "Align Right", cmd: "align-right", icon: AlignRight },
                { label: "Align Justify", cmd: "align-justify", icon: AlignJustify },
              ].map((opt) => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.cmd}
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] border-0 bg-transparent"
                    onClick={() => {
                      dispatchFormat(opt.cmd);
                      setAlignOpen(false);
                    }}
                  >
                    <Icon size={13} strokeWidth={1.75} />
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1" />

      <div className={groupClass}>
        <ToolBtn title="More" command="more">
          <MoreHorizontal size={15} strokeWidth={1.75} />
        </ToolBtn>
      </div>
    </div>
  );
}
