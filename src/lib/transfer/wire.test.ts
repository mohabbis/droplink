import { describe, expect, it } from 'vitest';
import { parseWireMessage, randomId, sanitizeFileName } from './wire';

describe('wire messages', () => {
  it('parses a valid manifest and sanitizes names', () => {
    const msg = parseWireMessage(
      JSON.stringify({
        t: 'manifest',
        transferId: 'abc',
        files: [{ id: 'f1', name: '../../etc/passwd', size: 10, type: 'text/plain' }],
      }),
    );
    expect(msg).toEqual({
      t: 'manifest',
      transferId: 'abc',
      files: [{ id: 'f1', name: '__.._etc_passwd', size: 10, type: 'text/plain' }],
    });
  });

  it('rejects manifests with bad sizes, duplicate ids, or no files', () => {
    const base = { t: 'manifest', transferId: 'abc' };
    expect(parseWireMessage(JSON.stringify({ ...base, files: [] }))).toBeNull();
    expect(parseWireMessage(JSON.stringify({ ...base, files: [{ id: 'a', name: 'x', size: -1 }] }))).toBeNull();
    expect(parseWireMessage(JSON.stringify({ ...base, files: [{ id: 'a', name: 'x', size: 1.5 }] }))).toBeNull();
    expect(
      parseWireMessage(JSON.stringify({ ...base, files: [{ id: 'a', name: 'x', size: 1 }, { id: 'a', name: 'y', size: 1 }] })),
    ).toBeNull();
  });

  it('requires a hex SHA-256 on file-end', () => {
    expect(parseWireMessage(JSON.stringify({ t: 'file-end', transferId: 'a', fileId: 'b', sha256: 'nope' }))).toBeNull();
    const sha = 'a'.repeat(64);
    expect(parseWireMessage(JSON.stringify({ t: 'file-end', transferId: 'a', fileId: 'b', sha256: sha }))).toEqual({
      t: 'file-end',
      transferId: 'a',
      fileId: 'b',
      sha256: sha,
    });
  });

  it('ignores garbage and unknown types', () => {
    expect(parseWireMessage('{')).toBeNull();
    expect(parseWireMessage('[]')).toBeNull();
    expect(parseWireMessage(JSON.stringify({ t: 'rm -rf' }))).toBeNull();
  });

  it('trims device labels', () => {
    const msg = parseWireMessage(JSON.stringify({ t: 'hello', v: 1, label: 'x'.repeat(200) }));
    expect(msg?.t === 'hello' && msg.label.length).toBe(60);
  });

  it('sanitizes empty and dot-only names', () => {
    expect(sanitizeFileName('')).toBe('file');
    expect(sanitizeFileName('..')).toBe('_');
    expect(sanitizeFileName('.bashrc')).toBe('_bashrc');
  });

  it('generates URL-safe ids', () => {
    expect(randomId()).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });
});
