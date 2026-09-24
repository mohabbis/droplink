import { CODE_ALPHABET, CODE_LENGTH } from './limits.js';

/**
 * Normalize user input into a canonical room code: uppercase, separators and
 * whitespace removed. Returns null if the result is not a well-formed code.
 */
export function normalizeCode(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[\s\-_.]/g, '');
  if (cleaned.length !== CODE_LENGTH) return null;
  for (const ch of cleaned) {
    if (!CODE_ALPHABET.includes(ch)) return null;
  }
  return cleaned;
}

/** Display form: `K7QM4P` → `K7Q-M4P`. */
export function formatCode(code: string): string {
  const half = Math.ceil(code.length / 2);
  return `${code.slice(0, half)}-${code.slice(half)}`;
}

/** Generate a code using the supplied random-index function (0 ≤ n < max). */
export function generateCode(randomIndex: (max: number) => number): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[randomIndex(CODE_ALPHABET.length)];
  }
  return out;
}
