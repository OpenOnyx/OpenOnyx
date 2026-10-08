/** Common connection lifecycle; provider credentials stay in Electron main. */
export type AppsConnectionState = 'disconnected' | 'connecting' | 'connected' | 'needs-reconnection' | 'connection-failed';
