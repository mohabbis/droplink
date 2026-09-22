import { describe, expect, it } from 'vitest';
import { formatCode, generateCode, normalizeCode } from '../../shared/codes';
import { deviceLabel } from './device';
import { formatBytes, formatCountdown, formatEta } from './format';
import { extractFingerprint } from './peer';
import { verificationCode } from './sas';
import { checkSupport } from './support';

describe('room codes', () => {
  it('normalizes user input', () => {
    expect(normalizeCode(' k7q-m4p ')).toBe('K7QM4P');
    expect(normalizeCode('K7Q M4P')).toBe('K7QM4P');
    expect(normalizeCode('K7QM4')).toBeNull();
    expect(normalizeCode('K7QM4O')).toBeNull(); // O is not in the alphabet
    expect(formatCode('K7QM4P')).toBe('K7Q-M4P');
    expect(generateCode(() => 0)).toBe('222222');
  });
});

describe('verificationCode', () => {
  const fpA = 'sha-256 AA:BB:CC';
  const fpB = 'sha-256 11:22:33';
  it('is the same on both sides regardless of order', async () => {
    const one = await verificationCode(fpA, fpB);
    expect(one).toMatch(/^\d{3} \d{3}$/);
    expect(await verificationCode(fpB, fpA)).toBe(one);
  });
  it('changes when a fingerprint changes (interception)', async () => {
    expect(await verificationCode(fpA, fpB)).not.toBe(await verificationCode(fpA, 'sha-256 11:22:34'));
  });
  it('extracts fingerprints from SDP', () => {
    const sdp = 'v=0\r\na=ice-ufrag:x\r\na=fingerprint:sha-256 ab:cd:EF\r\na=setup:actpass\r\n';
    expect(extractFingerprint(sdp)).toBe('sha-256 AB:CD:EF');
    expect(extractFingerprint('v=0\r\n')).toBeNull();
  });
});

describe('formatting', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1500)).toBe('1.5 KB');
    expect(formatBytes(26_214_420)).toBe('26.2 MB');
    expect(formatBytes(2_000_000_000)).toBe('2 GB');
  });
  it('formats time remaining', () => {
    expect(formatEta(null)).toBe('Estimating…');
    expect(formatEta(0.2)).toBe('Almost done');
    expect(formatEta(12.1)).toBe('13 s left');
    expect(formatEta(600)).toBe('About 10 min left');
    expect(formatCountdown(125_000)).toBe('2:05');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});

describe('deviceLabel', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 Edg/130', 'Edge on Windows'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', 'Safari on iPhone'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36', 'Chrome on Android'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox on Mac'],
  ])('%s → %s', (ua, label) => expect(deviceLabel(ua)).toBe(label));
});

describe('checkSupport', () => {
  const full = {
    RTCPeerConnection: class {
      createDataChannel() {}
    },
    WebSocket: class {},
    isSecureContext: true,
    crypto: { subtle: {} },
    WebAssembly: {},
  };
  it('accepts a capable browser', () => {
    expect(checkSupport(full as never)).toEqual({ ok: true, missing: [], canSaveToDisk: false });
  });
  it('lists what is missing', () => {
    const r = checkSupport({ ...full, RTCPeerConnection: undefined, isSecureContext: false } as never);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['WebRTC data channels', 'a secure (HTTPS) connection']);
  });
  it('detects save-to-disk support', () => {
    expect(checkSupport({ ...full, showSaveFilePicker() {}, showDirectoryPicker() {} } as never).canSaveToDisk).toBe(true);
  });
});
