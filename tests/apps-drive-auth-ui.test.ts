// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DriveStatus } from '../electron/googleDriveTypes';
import { DriveAppPage } from '../src/components/apps/DriveAppPage';

const api = vi.hoisted(() => ({ status: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), cancelConnect: vi.fn(), onStatusChanged: vi.fn() }));
vi.mock('../src/utils/api', () => ({ getAPI: () => ({ googleDrive: api }) }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let changed: (status: DriveStatus) => void;
const unsubscribe = vi.fn();
const account = { id: 'drive-' + 'a'.repeat(24), email: 'qa@example.test', name: 'QA' };
const disconnected: DriveStatus = { configured: true, secureStorage: true, accounts: [], connectionState: 'disconnected' };
beforeEach(() => {
  vi.resetAllMocks();
  api.status.mockResolvedValue(disconnected);
  api.onStatusChanged.mockImplementation(callback => { changed = callback; return unsubscribe; });
});
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.replaceChildren(); });
async function render() {
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(React.createElement(DriveAppPage, { onBack: vi.fn() })));
  return container;
}
const button = (container: HTMLElement, label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent === label)!;

it('connects directly, exposes cancellation, and reacts to safe Connected/reconnection status events', async () => {
  let finish!: () => void;
  api.connect.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const container = await render();
  expect(container.querySelector('input')).toBeNull();
  act(() => button(container, 'Connect').click());
  expect(api.connect).toHaveBeenCalledOnce();
  expect(container.textContent).toContain('Connecting');
  act(() => button(container, 'Cancel').click()); expect(api.cancelConnect).toHaveBeenCalledOnce();
  const connected: DriveStatus = { ...disconnected, accounts: [account], connectionState: 'connected' };
  api.status.mockResolvedValue(connected);
  await act(async () => { changed(connected); finish(); });
  expect(container.textContent).toContain('✓ Connected'); expect(container.textContent).toContain(account.email);
  act(() => changed({ ...connected, accounts: [{ ...account, needsReconnect: true }], connectionState: 'needs-reconnection' }));
  expect(container.textContent).toContain('Needs reconnection'); expect(button(container, 'Reconnect')).toBeDefined();
  expect(container.textContent).not.toMatch(/client.secret|refresh.token|redirect.URI/i);
  act(() => root!.unmount()); root = undefined;
  expect(unsubscribe).toHaveBeenCalledOnce();
});

it('shows cancellation/failure feedback and resets Connect without asking for credentials', async () => {
  const container = await render();
  api.connect.mockRejectedValue(new Error('Google authorization was cancelled.'));
  await act(async () => button(container, 'Connect').click());
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Google Drive connection was cancelled.');
  expect(button(container, 'Connect').disabled).toBe(false);
  api.connect.mockRejectedValue(new Error('Google authorization could not complete the token exchange. Try again.'));
  await act(async () => button(container, 'Connect').click());
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Couldn't connect to Google Drive. Try again.");
  expect(container.querySelector('input')).toBeNull();
});

it('disables an unconfigured development build and disconnects without a credential form', async () => {
  api.status.mockResolvedValue({ ...disconnected, configured: false });
  const container = await render();
  expect(button(container, 'Connect').disabled).toBe(true); expect(container.textContent).toContain('app maintainer');
  const connected = { ...disconnected, accounts: [account], connectionState: 'connected' as const };
  act(() => changed(connected));
  api.status.mockResolvedValue(disconnected); api.disconnect.mockResolvedValue(undefined);
  await act(async () => button(container, 'Disconnect').click());
  expect(api.disconnect).toHaveBeenCalledWith(account.id);
  expect(container.textContent).not.toContain('✓ Connected'); expect(button(container, 'Connect')).toBeDefined();
});
