// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { EditorHeader } from '../src/components/editor/EditorHeader';
import { FormattingToolbar } from '../src/components/layout/FormattingToolbar';

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderToolbar() {
  const container = document.createElement('div');
  container.style.overflow = 'hidden';
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(React.createElement(FormattingToolbar)));
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('opens toolbar menus outside the clipped editor pane', () => {
  const container = renderToolbar();
  const heading = container.querySelector<HTMLButtonElement>('[title="Heading"]')!;
  vi.spyOn(heading, 'getBoundingClientRect').mockReturnValue({
    left: 20, right: 120, top: 8, bottom: 36, width: 100, height: 28, x: 20, y: 8, toJSON: () => ({}),
  });

  act(() => heading.click());

  const menu = document.body.querySelector<HTMLElement>('[role="menu"]');
  expect(menu).not.toBeNull();
  expect(container.contains(menu)).toBe(false);
  expect(menu?.textContent).toContain('Heading 1');
});

it('keeps the toolbar more button delegated to the editor file menu', () => {
  const container = renderToolbar();
  const commands: string[] = [];
  const menuRequests: Array<{ x?: number; y?: number }> = [];
  const listener = ((event: CustomEvent) => {
    commands.push(event.detail.command);
  }) as EventListener;
  const menuListener = ((event: CustomEvent) => {
    menuRequests.push(event.detail);
  }) as EventListener;
  document.addEventListener('editor:format', listener);
  document.addEventListener('editor:open-file-menu', menuListener);

  act(() => container.querySelector<HTMLButtonElement>('[title="More"]')!.click());

  expect(commands).toEqual(['more']);
  expect(menuRequests).toHaveLength(1);
  expect(document.body.querySelector('[role="menu"]')).toBeNull();
  document.removeEventListener('editor:format', listener);
  document.removeEventListener('editor:open-file-menu', menuListener);
});

it('opens the existing editor action menu with Export to PDF from the toolbar more event', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const toolbarButton = document.createElement('button');
  toolbarButton.title = 'More';
  toolbarButton.getBoundingClientRect = () => ({
    left: 400, right: 428, top: 8, bottom: 36, width: 28, height: 28, x: 400, y: 8, toJSON: () => ({}),
  });
  const toolbar = document.createElement('div');
  toolbar.className = 'onyx-toolbar';
  toolbar.append(toolbarButton);
  document.body.append(toolbar);
  root = createRoot(container);

  act(() => root!.render(React.createElement(EditorHeader, {
    filePath: 'Notes/Test.md',
    viewMode: 'editor',
    onViewModeChange: vi.fn(),
    onExportPdf: vi.fn(),
    isFocused: true,
  })));
  act(() => document.dispatchEvent(new CustomEvent('editor:format', { detail: { command: 'more' } })));

  expect(document.body.textContent).toContain('Export to PDF...');
  expect(document.body.textContent).toContain('Rename...');
  expect(document.body.textContent).toContain('Open in default app');
});
