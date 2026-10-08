import { createHash } from 'node:crypto';
import { authorizeGoogle, googleTokenRequest, GoogleOAuthError, type GoogleOAuthConfig, type OAuthTokens, validGoogleTokenBrokerUrl } from './googleDriveOAuth.js';
import { GoogleDriveCredentialStore, type DriveCredential } from './googleDriveStore.js';
import { DRIVE_MIME_TYPES, type DriveAccount, type DriveFile, type DriveKind, type DriveStatus } from './googleDriveTypes.js';
import { readPdfResponse } from './googleDrivePdfCache.js';
import { readBoundedDriveResponse, type CachedDrivePreview } from './googleDriveFileCache.js';

const FILE_ID = /^[A-Za-z0-9_-]{1,200}$/;
const FILE_FIELDS = 'id,name,mimeType,modifiedTime,size,owners(displayName),description,trashed';
const GOOGLE_NATIVE_EXPORTS: Partial<Record<DriveKind, string>> = {
  document: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  spreadsheet: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  presentation: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function normalizeDriveFile(value: unknown, accountId: string): DriveFile | null {
  const data = asRecord(value);
  if (typeof data.id !== 'string' || !FILE_ID.test(data.id) || typeof data.name !== 'string' || !data.name || typeof data.mimeType !== 'string' || data.trashed === true) return null;
  const kind = DRIVE_MIME_TYPES[data.mimeType] || 'file';
  const nativeKind = data.mimeType.startsWith('application/vnd.google-apps.') ? kind : 'file';
  const host = nativeKind === 'document' ? 'https://docs.google.com/document/d/' : nativeKind === 'spreadsheet' ? 'https://docs.google.com/spreadsheets/d/' : nativeKind === 'presentation' ? 'https://docs.google.com/presentation/d/' : nativeKind === 'folder' ? 'https://drive.google.com/drive/folders/' : 'https://drive.google.com/file/d/';
  const size = typeof data.size === 'string' ? Number(data.size) : data.size;
  const owners = Array.isArray(data.owners) ? data.owners.map(owner => asRecord(owner).displayName).filter((owner): owner is string => typeof owner === 'string').slice(0, 3).join(', ') : '';
  return { id: data.id, accountId, name: data.name.slice(0, 500), mimeType: data.mimeType.slice(0, 200), kind, url: `${host}${data.id}${['document', 'spreadsheet', 'presentation'].includes(nativeKind) ? '/edit' : nativeKind === 'folder' ? '' : '/view'}`,
    modifiedAt: typeof data.modifiedTime === 'string' && Number.isFinite(Date.parse(data.modifiedTime)) ? data.modifiedTime : undefined,
    size: typeof size === 'number' && Number.isSafeInteger(size) && size >= 0 ? size : undefined,
    owner: owners.slice(0, 240) || undefined, preview: typeof data.description === 'string' ? data.description.slice(0, 1200) : undefined, cachedAt: new Date().toISOString() };
}
export function driveSearchQuery(query: string, kind: string): string {
  const literal = query.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const mimes = Object.entries(DRIVE_MIME_TYPES).filter(([, type]) => type === kind).map(([mime]) => `mimeType = '${mime}'`);
  const mimeFilter = mimes.length > 1 ? `(${mimes.join(' or ')})` : mimes[0];
  return `trashed = false${literal ? ` and name contains '${literal}'` : ''}${mimeFilter ? ` and ${mimeFilter}` : ''}`;
}

export class GoogleDriveProvider {
  private accounts: DriveCredential[] = [];
  private tokens = new Map<string, OAuthTokens>();
  private connecting: AbortController | null = null;
  private generation = 0;
  private mutations: Promise<void> = Promise.resolve();
  private mutate<T>(action: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(action);
    this.mutations = result.then(() => {}, () => {});
    return result;
  }
  constructor(private readonly store: GoogleDriveCredentialStore, private readonly config: GoogleOAuthConfig, private readonly openBrowser: (url: string) => Promise<void>, private readonly fetcher: typeof fetch = fetch) {}
  private refreshes = new Map<string, Promise<string>>();
  private revocations = new Set<Promise<void>>();
  private listeners = new Set<(status: DriveStatus) => void>();
  private loadFailed = false;
  private connectionFailed = false;
  private accountEpochs = new Map<string, number>();
  private invalidateAccount(id: string): void { this.accountEpochs.set(id, (this.accountEpochs.get(id) || 0) + 1); }
  subscribeStatus(listener: (status: DriveStatus) => void): () => void {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  private changed(): void { for (const listener of this.listeners) listener(this.status()); }
  async load(): Promise<void> {
    try { this.accounts = (await this.store.load()).filter(account => account.clientId === this.config.clientId); this.loadFailed = false; }
    catch { this.loadFailed = true; throw new Error('Google Drive credentials could not be unlocked. Reconnect your account.'); }
    finally { this.changed(); }
  }
  status(): DriveStatus {
    const accounts = this.accounts.map(({ id, email, name, needsReconnect }) => ({ id, email, name, ...(needsReconnect ? { needsReconnect: true } : {}) }));
    return { configured: /^[\w.-]+\.apps\.googleusercontent\.com$/.test(this.config.clientId) && (this.config.tokenBrokerUrl === undefined || validGoogleTokenBrokerUrl(this.config.tokenBrokerUrl)), secureStorage: this.store.available(), accounts,
      connectionState: this.connecting ? 'connecting' : this.loadFailed || accounts.some(account => account.needsReconnect) ? 'needs-reconnection' : accounts.length ? 'connected' : this.connectionFailed ? 'connection-failed' : 'disconnected' };
  }
  async connect(): Promise<DriveAccount> {
    if (!this.store.available()) throw new Error('Secure system credential storage is unavailable.');
    if (this.connecting) throw new Error('Google authorization is already in progress.');
    const controller = new AbortController(); this.connecting = controller;
    this.connectionFailed = false; this.changed();
    const generation = this.generation;
    let connected: DriveAccount | undefined;
    try {
      // An old revoke must finish before a new grant can be issued for this
      // client. Otherwise a quick reconnect could be revoked by the old task.
      let cancelWait = () => {};
      try {
        await Promise.race([Promise.all(this.revocations), new Promise<never>((_resolve, reject) => {
          cancelWait = () => reject(new GoogleOAuthError('cancelled', 'Google authorization was cancelled.'));
          controller.signal.addEventListener('abort', cancelWait, { once: true });
          if (controller.signal.aborted) cancelWait();
        })]);
      } finally { controller.signal.removeEventListener('abort', cancelWait); }
      if (controller.signal.aborted) throw new GoogleOAuthError('cancelled', 'Google authorization was cancelled.');
      await authorizeGoogle(this.config, this.openBrowser, controller.signal, this.fetcher, { onAuthorized: async (tokens, signal) => {
        if (!tokens.refreshToken) throw new GoogleOAuthError('failed', 'Google did not grant offline access. Reconnect your account.');
        const user = asRecord(asRecord(await this.json('about?fields=user(permissionId,emailAddress,displayName)', tokens.accessToken, signal)).user);
        if (typeof user.permissionId !== 'string' || !user.permissionId) throw new GoogleOAuthError('failed', 'Could not identify the connected Google account.');
        if (signal.aborted || generation !== this.generation) throw new GoogleOAuthError('cancelled', 'Google authorization was cancelled.');
        const account: DriveCredential = { id: `drive-${createHash('sha256').update(user.permissionId).digest('hex').slice(0, 24)}`, email: typeof user.emailAddress === 'string' ? user.emailAddress.slice(0, 254) : '', name: typeof user.displayName === 'string' ? user.displayName.slice(0, 100) : 'Google account', refreshToken: tokens.refreshToken, clientId: this.config.clientId, ...(tokens.brokerTicket ? { brokerTicket: tokens.brokerTicket } : {}) };
        await this.mutate(async () => {
          if (signal.aborted || generation !== this.generation) throw new GoogleOAuthError('cancelled', 'Google authorization was cancelled.');
          const previous = this.accounts;
          const accounts = [...previous.filter(value => value.id !== account.id), account];
          await this.store.save(accounts);
          // Cancellation during an asynchronous write must not persist a cancelled login.
          if (signal.aborted || generation !== this.generation) { await this.store.save(previous); throw new GoogleOAuthError('cancelled', 'Google authorization was cancelled.'); }
          this.invalidateAccount(account.id); this.refreshes.delete(account.id); this.accounts = accounts; this.tokens.set(account.id, tokens); this.loadFailed = false;
          connected = { id: account.id, email: account.email, name: account.name };
        });
      } });
      return connected!;
    } catch (error) { this.connectionFailed = !(error instanceof GoogleOAuthError && error.kind === 'cancelled'); throw error; }
    finally { this.connecting = null; this.changed(); }
  }
  cancelConnection(): void { this.generation++; this.connecting?.abort(); }
  async disconnect(id: string): Promise<void> {
    this.cancelConnection();
    let account: DriveCredential | undefined;
    await this.mutate(async () => {
      account = this.accounts.find(value => value.id === id);
      const accounts = this.accounts.filter(value => value.id !== id);
      await this.store.save(accounts); this.invalidateAccount(id); this.accounts = accounts; this.tokens.delete(id); this.refreshes.delete(id);
      this.connectionFailed = false; this.loadFailed = false; this.changed();
    });
    if (account?.refreshToken) {
      // Do not hold the UI hostage to remote revocation. Local removal is authoritative.
      const revocation = this.fetcher('https://oauth2.googleapis.com/revoke', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: account.refreshToken }) }).then(() => {}, () => {});
      this.revocations.add(revocation);
      void revocation.then(() => this.revocations.delete(revocation));
    }
  }
  private async needsReconnect(account: DriveCredential): Promise<void> {
    await this.mutate(async () => {
      if (!this.accounts.includes(account)) return;
      const accounts = this.accounts.map(value => value === account ? { ...value, refreshToken: '', needsReconnect: true } : value);
      this.invalidateAccount(account.id); this.tokens.delete(account.id); this.accounts = accounts; this.changed();
      await this.store.save(accounts);
    });
  }
  private async accessToken(id: string, force = false): Promise<string> {
    const account = this.accounts.find(value => value.id === id);
    if (!account || account.needsReconnect || !account.refreshToken) throw new GoogleOAuthError('reconnect', 'Reconnect Google Drive to access this resource.');
    const cached = this.tokens.get(id);
    if (!force && cached && cached.expiresAt > Date.now() + 60000) return cached.accessToken;
    const pending = this.refreshes.get(id);
    if (pending) return pending;
    const epoch = this.accountEpochs.get(id);
    const refresh = (async () => {
      let token: OAuthTokens;
      try { token = await googleTokenRequest({ grant_type: 'refresh_token', refresh_token: account.refreshToken, ...(account.brokerTicket ? { broker_ticket: account.brokerTicket } : {}) }, this.config, this.fetcher); }
      catch (error) { if (error instanceof GoogleOAuthError && error.kind === 'reconnect') await this.needsReconnect(account); throw error; }
      if (!this.accounts.includes(account)) throw new Error('Google Drive was disconnected.');
      if ((token.refreshToken && token.refreshToken !== account.refreshToken) || (token.brokerTicket && token.brokerTicket !== account.brokerTicket)) {
        await this.mutate(async () => {
          if (!this.accounts.includes(account)) throw new Error('Google Drive was disconnected.');
          const accounts = this.accounts.map(value => value === account ? { ...value, refreshToken: token.refreshToken || value.refreshToken, ...(token.brokerTicket ? { brokerTicket: token.brokerTicket } : {}) } : value);
          await this.store.save(accounts); this.accounts = accounts;
        });
      }
      if (this.accountEpochs.get(id) !== epoch || !this.accounts.some(value => value.id === id && !value.needsReconnect)) throw new Error('Google Drive was disconnected.');
      this.tokens.set(id, token); return token.accessToken;
    })();
    this.refreshes.set(id, refresh);
    try { return await refresh; } finally { if (this.refreshes.get(id) === refresh) this.refreshes.delete(id); }
  }
  private async authorizedResponse(endpoint: string, id: string): Promise<Response> {
    const epoch = this.accountEpochs.get(id);
    const active = () => { if (this.accountEpochs.get(id) !== epoch || !this.accounts.some(account => account.id === id && !account.needsReconnect)) throw new Error('Google Drive was disconnected.'); };
    const token = await this.accessToken(id);
    let response = await this.response(endpoint, token);
    active();
    if (response.status === 401) {
      await response.body?.cancel();
      response = await this.response(endpoint, await this.accessToken(id, this.tokens.get(id)?.accessToken === token));
      active();
      if (response.status === 401) {
        await response.body?.cancel();
        const account = this.accounts.find(value => value.id === id);
        if (account) await this.needsReconnect(account);
        throw new GoogleOAuthError('reconnect', 'Google Drive authorization expired. Reconnect to continue.');
      }
    }
    return response;
  }
  private async authorizedJson(endpoint: string, id: string): Promise<unknown> { return (await this.authorizedResponse(endpoint, id)).json(); }
  private async response(endpoint: string, token: string, signal?: AbortSignal): Promise<Response> {
    let response: Response;
    try { response = await this.fetcher(`https://www.googleapis.com/drive/v3/${endpoint}`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) }); }
    catch { throw new Error('Google Drive is unavailable. Your saved snapshots remain readable.'); }
    if (response.status === 404 || response.status === 403) throw new Error('Resource unavailable. Your cached version is preserved.');
    if (response.status === 401) return response;
    if (!response.ok) throw new Error('Could not load Google Drive resources. Try again.');
    return response;
  }
  private async json(endpoint: string, token: string, signal?: AbortSignal): Promise<unknown> {
    const response = await this.response(endpoint, token, signal);
    if (response.status === 401) throw new GoogleOAuthError('reconnect', 'Google Drive authorization expired. Reconnect to continue.');
    return response.json();
  }
  async search(accountId: string, query: string, kind: DriveKind | 'everything'): Promise<DriveFile[]> {
    const params = new URLSearchParams({ q: driveSearchQuery(query, kind), fields: `files(${FILE_FIELDS})`, pageSize: '30', orderBy: 'modifiedTime desc', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
    const data = asRecord(await this.authorizedJson(`files?${params}`, accountId));
    if (!this.accounts.some(account => account.id === accountId)) throw new Error('Google Drive was disconnected.');
    return Array.isArray(data.files) ? data.files.map(file => normalizeDriveFile(file, accountId)).filter((file): file is DriveFile => file !== null) : [];
  }
  async getResource(accountId: string, id: string): Promise<DriveFile> {
    if (!FILE_ID.test(id)) throw new Error('Invalid Google Drive resource.');
    const resource = normalizeDriveFile(await this.authorizedJson(`files/${id}?${new URLSearchParams({ fields: FILE_FIELDS, supportsAllDrives: 'true' })}`, accountId), accountId);
    if (!resource) throw new Error('Resource unavailable. Your cached version is preserved.');
    if (resource.mimeType === 'application/vnd.google-apps.document') {
      // Export plain text, bounded before caching. Never fetch or display provider HTML.
      try {
        const response = await this.authorizedResponse(`files/${id}/export?mimeType=text%2Fplain`, accountId);
        const reader = response.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder(); let preview = ''; let bytes = 0;
          try { while (bytes < 4096) { const part = await reader.read(); if (part.done) break; const remaining = 4096 - bytes; preview += decoder.decode(part.value.subarray(0, remaining), { stream: true }); bytes += part.value.length; } preview += decoder.decode(); }
          finally { await reader.cancel(); }
          resource.preview = preview.slice(0, 4000);
        }
      } catch (error) {
        if (error instanceof GoogleOAuthError && error.kind === 'reconnect') throw error;
        /* Metadata remains usable when Google does not permit text export. */
      }
    }
    if (!this.accounts.some(account => account.id === accountId)) throw new Error('Google Drive was disconnected.');
    return resource;
  }
  async getPdf(accountId: string, id: string): Promise<Uint8Array> {
    if (!FILE_ID.test(id)) throw new Error('Invalid Google Drive resource.');
    const data = asRecord(await this.authorizedJson(`files/${id}?${new URLSearchParams({ fields: 'id,mimeType,capabilities(canDownload)', supportsAllDrives: 'true' })}`, accountId));
    if (data.mimeType !== 'application/pdf' || asRecord(data.capabilities).canDownload === false) throw new Error('Google Drive cannot preview this file as a PDF.');
    const bytes = await readPdfResponse(await this.authorizedResponse(`files/${id}?alt=media&supportsAllDrives=true`, accountId));
    if (!this.accounts.some(account => account.id === accountId)) throw new Error('Google Drive was disconnected.');
    return bytes;
  }

  async getPreviewFile(accountId: string, id: string): Promise<CachedDrivePreview> {
    if (!FILE_ID.test(id)) throw new Error('Invalid Google Drive resource.');
    const data = asRecord(await this.authorizedJson(`files/${id}?${new URLSearchParams({ fields: 'id,mimeType,capabilities(canDownload)', supportsAllDrives: 'true' })}`, accountId));
    const mimeType = typeof data.mimeType === 'string' ? data.mimeType : '';
    if (!mimeType) throw new Error('Google Drive cannot preview this file.');
    const kind = DRIVE_MIME_TYPES[mimeType] || 'file';
    const exportMime = mimeType.startsWith('application/vnd.google-apps.') ? GOOGLE_NATIVE_EXPORTS[kind] : undefined;
    if (!exportMime && asRecord(data.capabilities).canDownload === false) throw new Error('Google Drive cannot preview this file.');
    const endpoint = exportMime
      ? `files/${id}/export?${new URLSearchParams({ mimeType: exportMime })}`
      : `files/${id}?alt=media&supportsAllDrives=true`;
    const previewMime = exportMime || mimeType;
    const bytes = await readBoundedDriveResponse(await this.authorizedResponse(endpoint, accountId), previewMime);
    if (!this.accounts.some(account => account.id === accountId)) throw new Error('Google Drive was disconnected.');
    return { bytes, mimeType: previewMime, cachedAt: new Date().toISOString() };
  }
}
