/**
 * Short authentication string: a 6-digit code both devices derive from the two
 * DTLS certificate fingerprints of their connection. If someone intercepted
 * the setup (for example a compromised signaling server), each device would be
 * talking to the attacker with different certificates, and the codes shown on
 * the two screens would not match.
 */
export async function verificationCode(fingerprintA: string, fingerprintB: string): Promise<string> {
  // Sort so both sides hash the same input regardless of which one is "local".
  const input = [fingerprintA, fingerprintB].sort().join('|');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`droplink-sas-v1|${input}`)));
  const n = ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0;
  const code = String(n % 1_000_000).padStart(6, '0');
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}
