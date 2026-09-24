export interface SupportReport {
  ok: boolean;
  /** Human-readable names of missing capabilities. */
  missing: string[];
  /** Can stream received files straight to disk (Chromium File System Access API). */
  canSaveToDisk: boolean;
}

type Env = Partial<typeof globalThis> & Record<string, unknown>;

export function checkSupport(env: Env = globalThis as Env): SupportReport {
  const missing: string[] = [];
  const pc = env.RTCPeerConnection as { prototype?: { createDataChannel?: unknown } } | undefined;
  if (!pc || typeof pc.prototype?.createDataChannel !== 'function') missing.push('WebRTC data channels');
  if (typeof env.WebSocket !== 'function') missing.push('WebSockets');
  if (!env.isSecureContext || !(env.crypto as Crypto | undefined)?.subtle) missing.push('a secure (HTTPS) connection');
  if (typeof env.WebAssembly !== 'object') missing.push('WebAssembly');
  return {
    ok: missing.length === 0,
    missing,
    canSaveToDisk: typeof env.showSaveFilePicker === 'function' && typeof env.showDirectoryPicker === 'function',
  };
}
