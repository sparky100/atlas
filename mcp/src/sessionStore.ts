/**
 * ADR-029 §2: where the signed-in session is kept between runs. Only the
 * session Supabase hands back (which holds the refresh token) is stored,
 * never the password. The file is private to the user (mode 0600, in a
 * 0700 folder) and written in one step, so a crash cannot leave half a
 * file. This is Supabase's own `storage` interface, so every refresh that
 * rotates the token is saved without any code of ours in the way.
 */
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface AuthStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

export const SESSION_FILE = 'session.json';

export function createFileStorage(dir: string): AuthStorage {
  const file = path.join(dir, SESSION_FILE);

  async function readAll(): Promise<Record<string, string>> {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      return {};
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    } catch {
      // A damaged file is treated as signed out; the next sign-in replaces it.
      return {};
    }
  }

  async function writeAll(values: Record<string, string>): Promise<void> {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = `${file}.${String(process.pid)}.tmp`;
    await writeFile(temp, JSON.stringify(values), { mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, file);
  }

  return {
    getItem: async (key) => (await readAll())[key] ?? null,
    setItem: async (key, value) => {
      await writeAll({ ...(await readAll()), [key]: value });
    },
    removeItem: async (key) => {
      const all = await readAll();
      if (!(key in all)) return;
      const rest = Object.fromEntries(Object.entries(all).filter(([k]) => k !== key));
      if (Object.keys(rest).length === 0) await rm(file, { force: true });
      else await writeAll(rest);
    },
  };
}
