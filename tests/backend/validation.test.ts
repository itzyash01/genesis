import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../../functions/src/crypto';
import { fileDocumentId, filePathSchema, hashToken, projectIdSchema, projectNameSchema, promptSchema } from '../../functions/src/validation';

describe('encryption', () => {
  const key = Buffer.alloc(32, 9).toString('base64');
  it('round trips secrets with unique nonces', () => {
    const first = encryptSecret('private value', key);
    expect(decryptSecret(first, key)).toBe('private value');
    expect(encryptSecret('private value', key).iv).not.toBe(first.iv);
  });
  it('rejects invalid keys and tampered ciphertext', () => {
    expect(() => encryptSecret('x', 'bad')).toThrow('32-byte');
    const value = encryptSecret('x', key);
    expect(() => decryptSecret({ ...value, tag: Buffer.alloc(16).toString('base64') }, key)).toThrow();
  });
});

describe('input validation', () => {
  it.each(['index.html', 'src/app.js', 'styles/main.CSS', 'readme.md', 'file.json', 'icon.svg', 'a.txt'])('accepts safe path %s', path => {
    expect(filePathSchema.safeParse(path).success).toBe(true);
  });
  it.each(['/app.js', '../app.js', 'a/../app.js', 'a//b.js', 'a\\b.js', 'a.exe', ''])('rejects unsafe path %s', path => {
    expect(filePathSchema.safeParse(path).success).toBe(false);
  });
  it('bounds and trims identifiers and prompts', () => {
    expect(projectIdSchema.safeParse('a/b').success).toBe(false);
    expect(projectIdSchema.safeParse('a_B-2').success).toBe(true);
    expect(projectNameSchema.parse('  App  ')).toBe('App');
    expect(promptSchema.safeParse('   ').success).toBe(false);
    expect(promptSchema.safeParse('x'.repeat(8001)).success).toBe(false);
  });
  it('creates deterministic opaque identifiers', () => {
    expect(fileDocumentId('a/b.js')).toBe(Buffer.from('a/b.js').toString('base64url'));
    expect(hashToken('x')).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken('x')).not.toBe(hashToken('y'));
  });
});
