import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { crc32, zipFiles } from './zipFiles';

describe('zipFiles', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('is deterministic', () => {
    const entries = [{ name: 'a.txt', data: Buffer.from('hello hello hello') }];
    expect(zipFiles(entries).equals(zipFiles(entries))).toBe(true);
  });

  it('writes a zip that unzip can test and read back', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'zipfiles-'));
    try {
      const file = path.join(dir, 'x.zip');
      writeFileSync(file, zipFiles([{ name: 'manifest.json', data: Buffer.from('{"a":1}') }, { name: 'server/run.mjs', data: Buffer.from('x'.repeat(5000)) }]));
      let tested: string;
      try {
        tested = execFileSync('unzip', ['-tq', file], { encoding: 'utf8' });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; // no unzip on this machine: the structure checks above still ran
        throw e;
      }
      expect(tested).toMatch(/No errors/);
      expect(execFileSync('unzip', ['-p', file, 'manifest.json'], { encoding: 'utf8' })).toBe('{"a":1}');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
