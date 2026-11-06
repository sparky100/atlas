import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFileStorage, SESSION_FILE } from './sessionStore';

async function tempDir(): Promise<string> {
  return path.join(await mkdtemp(path.join(os.tmpdir(), 'atlas-mcp-')), 'cfg');
}

describe('createFileStorage', () => {
  it('saves and reads back a value, in a file only the user can read', async () => {
    const dir = await tempDir();
    const storage = createFileStorage(dir);
    expect(await storage.getItem('a')).toBeNull();
    await storage.setItem('a', '{"refresh_token":"r1"}');
    expect(await storage.getItem('a')).toBe('{"refresh_token":"r1"}');
    if (process.platform !== 'win32') {
      expect((await stat(path.join(dir, SESSION_FILE))).mode & 0o777).toBe(0o600);
      expect((await stat(dir)).mode & 0o777).toBe(0o700);
    }
  });

  it('replaces the value when the token rotates and keeps other keys', async () => {
    const storage = createFileStorage(await tempDir());
    await storage.setItem('a', 'one');
    await storage.setItem('b', 'two');
    await storage.setItem('a', 'three');
    expect(await storage.getItem('a')).toBe('three');
    expect(await storage.getItem('b')).toBe('two');
  });

  it('removes the file when the last value goes, and tolerates removing nothing', async () => {
    const dir = await tempDir();
    const storage = createFileStorage(dir);
    await storage.removeItem('missing');
    await storage.setItem('a', 'one');
    await storage.removeItem('a');
    await expect(readFile(path.join(dir, SESSION_FILE))).rejects.toThrow();
  });

  it('treats a damaged file as signed out, and the next save replaces it', async () => {
    const dir = await tempDir();
    const storage = createFileStorage(dir);
    await storage.setItem('a', 'one');
    await writeFile(path.join(dir, SESSION_FILE), '{not json');
    expect(await storage.getItem('a')).toBeNull();
    await storage.setItem('a', 'two');
    expect(await storage.getItem('a')).toBe('two');
  });
});
