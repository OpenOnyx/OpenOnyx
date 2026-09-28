/**
 * SearchReplace - VS Code-style Find/Replace Component
 *
 * A floating search/replace panel that mimics VS Code's search UI exactly.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { EditorView } from "@codemirror/view";
import {
  SearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  selectMatches,
} from "@codemirror/search";

interface SearchReplaceProps {
  getView: () => EditorView | null;
  isOpen: boolean;
  onClose: () => void;
}

interface MatchInfo {
  current: number;
  total: number;
}

const panelClass =
  "editor-search-panel absolute right-6 top-3 z-[1000] flex items-start gap-0 rounded-[var(--radius-md)] border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-1.5 font-[var(--font-sans)] text-[13px] text-[var(--text-secondary)] shadow-none";
const toggleClass =
  "mt-0.5 flex h-[26px] w-5 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-[var(--text-tertiary)] transition-[transform,color] duration-150 hover:text-[var(--text-primary)] [&_svg]:transition-transform [&_svg]:duration-150";
const toggleExpandedClass = "[&_svg]:rotate-90";
const contentClass = "flex flex-col gap-1";
const rowClass = "flex h-[26px] items-center gap-1";
const inputContainerClass = "relative flex items-center";
const inputClass =
  "h-6 w-[180px] rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] py-0.5 pl-2 pr-[70px] font-[inherit] text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--editor-caret)] focus:shadow-[0_0_0_2px_var(--editor-selection)]";
const replaceInputClass = "pr-8";
const optionsClass =
  "absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5";
const optionButtonClass =
  "flex h-[18px] w-5 cursor-pointer items-center justify-center rounded-[3px] border border-transparent bg-transparent p-0 text-xs font-medium text-[var(--text-tertiary)] transition-colors duration-100 hover:border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
const optionButtonActiveClass =
  "border-[var(--editor-caret)] bg-[var(--editor-caret)] text-white";
const matchCountClass =
  "min-w-[70px] whitespace-nowrap pl-1.5 text-left text-xs text-[var(--text-tertiary)]";
const actionsClass = "flex items-center gap-0";
const actionButtonClass =
  "flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-[3px] border-0 bg-transparent p-0 text-[var(--text-tertiary)] transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:h-4 [&_svg]:w-4";
const replaceOptionsClass = "pointer-events-none";
const replaceLabelClass =
  "px-1 text-xs font-medium text-[var(--text-tertiary)]";

export function SearchReplace({
  getView,
  isOpen,
  onClose,
}: SearchReplaceProps) {
  const [searchValue, setSearchValue] = useState("");
  const [replaceValue, setReplaceValue] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [showReplace, setShowReplace] = useState(true);
  const [matchInfo, setMatchInfo] = useState<MatchInfo>({
    current: 0,
    total: 0,
  });

  const searchInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus search input when opened
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
      searchInputRef.current.select();
    }
  }, [isOpen]);

  // Count matches in document
  const countMatches = useCallback(() => {
    const view = getView();
    if (!view || !searchValue) {
      setMatchInfo({ current: 0, total: 0 });
      return;
    }

    const doc = view.state.doc.toString();
    let total = 0;
    let current = 0;

    try {
      let pattern: RegExp;
      if (useRegex) {
        pattern = new RegExp(searchValue, caseSensitive ? "g" : "gi");
      } else {
        const escaped = searchValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const wordPattern = wholeWord ? `\\b${escaped}\\b` : escaped;
        pattern = new RegExp(wordPattern, caseSensitive ? "g" : "gi");
      }

      const matches = [...doc.matchAll(pattern)];
      total = matches.length;

      // Find current match based on cursor position
      const cursorPos = view.state.selection.main.head;
      for (let i = 0; i < matches.length; i++) {
        if (matches[i].index !== undefined && matches[i].index >= cursorPos) {
          current = i + 1;
          break;
        }
      }
      if (current === 0 && total > 0) current = 1;
    } catch {
      // Invalid regex
      total = 0;
      current = 0;
    }

    setMatchInfo({ current, total });
  }, [getView, searchValue, caseSensitive, wholeWord, useRegex]);

  // Update search query in CodeMirror
  const updateSearch = useCallback(() => {
    const view = getView();
    if (!view) return;

    const query = new SearchQuery({
      search: searchValue,
      caseSensitive,
      regexp: useRegex,
      wholeWord,
      replace: replaceValue,
    });

    view.dispatch({ effects: setSearchQuery.of(query) });
    countMatches();
  }, [
    getView,
    searchValue,
    caseSensitive,
    useRegex,
    wholeWord,
    replaceValue,
    countMatches,
  ]);

  // Update search when parameters change
  useEffect(() => {
    if (isOpen) {
      updateSearch();
    }
  }, [searchValue, caseSensitive, wholeWord, useRegex, isOpen, updateSearch]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "Escape") {
        onClose();
        getView()?.focus();
      } else if (e.key === "F3" && !e.shiftKey) {
        e.preventDefault();
        handleFindNext();
      } else if (e.key === "F3" && e.shiftKey) {
        e.preventDefault();
        handleFindPrev();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, getView, onClose]);

  const handleFindNext = () => {
    const view = getView();
    if (view && searchValue) {
      findNext(view);
      setTimeout(countMatches, 10);
    }
  };

  const handleFindPrev = () => {
    const view = getView();
    if (view && searchValue) {
      findPrevious(view);
      setTimeout(countMatches, 10);
    }
  };

  const handleReplace = () => {
    const view = getView();
    if (view && searchValue) {
      replaceNext(view);
      setTimeout(countMatches, 10);
    }
  };

  const handleReplaceAll = () => {
    const view = getView();
    if (view && searchValue) {
      replaceAll(view);
      setTimeout(countMatches, 10);
    }
  };

  const handleSelectAll = () => {
    const view = getView();
    if (view && searchValue) {
      selectMatches(view);
    }
  };

  if (!isOpen) return null;

  return (
    <div className={panelClass} ref={panelRef}>
      {/* Chevron toggle for replace section */}
      <button
        className={`${toggleClass}${showReplace ? ` ${toggleExpandedClass}` : ""}`}
        onClick={() => setShowReplace(!showReplace)}
        title={showReplace ? "Hide Replace" : "Show Replace"}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M5.7 13.7L5 13l4.6-4.6L5 3.7l.7-.7 5 5.3-5 5.4z" />
        </svg>
      </button>

      <div className={contentClass}>
        {/* Find Row */}
        <div className={rowClass}>
          <div className={inputContainerClass}>
            <input
              ref={searchInputRef}
              type="text"
              className={inputClass}
              placeholder="Find"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleFindNext();
                } else if (e.key === "Enter" && e.shiftKey) {
                  e.preventDefault();
                  handleFindPrev();
                }
              }}
            />
            <div className={optionsClass}>
              <button
                className={`${optionButtonClass}${caseSensitive ? ` ${optionButtonActiveClass}` : ""}`}
                onClick={() => setCaseSensitive(!caseSensitive)}
                title="Match Case (Alt+C)"
              >
                Aa
              </button>
              <button
                className={`${optionButtonClass}${wholeWord ? ` ${optionButtonActiveClass}` : ""}`}
                onClick={() => setWholeWord(!wholeWord)}
                title="Match Whole Word (Alt+W)"
              >
                <span className="underline underline-offset-2">ab</span>
              </button>
              <button
                className={`${optionButtonClass}${useRegex ? ` ${optionButtonActiveClass}` : ""}`}
                onClick={() => setUseRegex(!useRegex)}
                title="Use Regular Expression (Alt+R)"
              >
                .*
              </button>
            </div>
          </div>

          <span className={matchCountClass}>
            {searchValue
              ? matchInfo.total === 0
                ? "No results"
                : `${matchInfo.current} of ${matchInfo.total}`
              : "No results"}
          </span>

          <div className={actionsClass}>
            <button
              className={actionButtonClass}
              onClick={handleFindPrev}
              title="Previous Match (Shift+Enter)"
              disabled={!searchValue || matchInfo.total === 0}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M4 8l4-4v2.5h4v3H8V12L4 8z"
                  transform="rotate(-90 8 8)"
                />
              </svg>
            </button>
            <button
              className={actionButtonClass}
              onClick={handleFindNext}
              title="Next Match (Enter)"
              disabled={!searchValue || matchInfo.total === 0}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M4 8l4-4v2.5h4v3H8V12L4 8z"
                  transform="rotate(90 8 8)"
                />
              </svg>
            </button>
            <button
              className={actionButtonClass}
              onClick={handleSelectAll}
              title="Select All Matches"
              disabled={!searchValue || matchInfo.total === 0}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <path d="M2 3.5h12v1H2v-1zm0 4h12v1H2v-1zm0 4h12v1H2v-1z" />
              </svg>
            </button>
            <button
              className={actionButtonClass}
              onClick={onClose}
              title="Close (Escape)"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Replace Row */}
        {showReplace && (
          <div className={rowClass}>
            <div className={inputContainerClass}>
              <input
                type="text"
                className={`${inputClass} ${replaceInputClass}`}
                placeholder="Replace"
                value={replaceValue}
                onChange={(e) => setReplaceValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleReplace();
                  } else if (e.key === "Enter" && e.shiftKey) {
                    e.preventDefault();
                    handleReplaceAll();
                  }
                }}
              />
              <div className={`${optionsClass} ${replaceOptionsClass}`}>
                <span className={replaceLabelClass}>AB</span>
              </div>
            </div>

            <div className={actionsClass}>
              <button
                className={actionButtonClass}
                onClick={handleReplace}
                title="Replace (Enter)"
                disabled={!searchValue || matchInfo.total === 0}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M3.221 3.739l2.261 2.269L7.7 3.784l-.7-.7-1.012 1.007-.008-1.6a.523.523 0 0 1 .149-.38l1.378-1.381-.7-.7L5.419 1.4a1.533 1.533 0 0 0-.441 1.082l.006 1.717-.996-.996-.767.536zm6.67 4.389l-2.262-2.268-2.218 2.224.7.7 1.012-1.007.008 1.6a.523.523 0 0 1-.149.38l-1.377 1.38.7.7 1.388-1.37a1.533 1.533 0 0 0 .44-1.082l-.005-1.717.996.996.767-.536z" />
                </svg>
              </button>
              <button
                className={actionButtonClass}
                onClick={handleReplaceAll}
                title="Replace All (Shift+Enter)"
                disabled={!searchValue || matchInfo.total === 0}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M3.221 3.739l2.261 2.269L7.7 3.784l-.7-.7-1.012 1.007-.008-1.6a.523.523 0 0 1 .149-.38l1.378-1.381-.7-.7L5.419 1.4a1.533 1.533 0 0 0-.441 1.082l.006 1.717-.996-.996-.767.536zm6.67 4.389l-2.262-2.268-2.218 2.224.7.7 1.012-1.007.008 1.6a.523.523 0 0 1-.149.38l-1.377 1.38.7.7 1.388-1.37a1.533 1.533 0 0 0 .44-1.082l-.005-1.717.996.996.767-.536z" />
                  <path d="M12.5 3h-3v1h3v3h1V3.5a.5.5 0 0 0-.5-.5h-.5zM3.5 12H6v1H3a.5.5 0 0 1-.5-.5V10h1v2.5z" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
