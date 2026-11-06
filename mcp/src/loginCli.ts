/**
 * ADR-029 §2: `atlas-mcp login | logout | status`. The password is asked for
 * once, hidden, used to sign in, and never written anywhere; only the
 * session Supabase returns is saved (`sessionStore.ts`).
 */
import readline from 'node:readline';
import type { Client } from '../../src/db/client';
import { ensureSignedIn, NOT_SIGNED_IN, signIn, type AuthApi } from './auth';
import type { McpSettings } from './config';

function ask(question: string, hidden: boolean): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    if (hidden) {
      // Echo nothing while the password is typed.
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
        if (s.includes(question)) process.stderr.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stderr.write('\n');
      resolve(answer.trim());
    });
  });
}

const authOf = (supabase: Client): AuthApi => supabase.auth;

export async function runLogin(supabase: Client, settings: McpSettings): Promise<number> {
  const email = settings.email ?? (await ask('Atlas email: ', false));
  const password = settings.password ?? (await ask('Atlas password: ', true));
  if (email === '' || password === '') {
    console.error('An email and a password are both needed.');
    return 1;
  }
  const result = await signIn(authOf(supabase), email, password);
  if (!result.ok) {
    console.error(result.message);
    return 1;
  }
  console.error(`Signed in as ${result.user.email ?? result.user.userId}. Your AI app can now use Atlas. Only the session is saved on this computer, in ${settings.configDir}; your password is not.`);
  return 0;
}

export async function runLogout(supabase: Client): Promise<number> {
  const { error } = await authOf(supabase).signOut();
  if (error) {
    console.error(`Could not sign out cleanly: ${error.message}. The saved session was still removed from this computer.`);
    return 1;
  }
  console.error('Signed out. The saved session was removed from this computer.');
  return 0;
}

export async function runStatus(supabase: Client, settings: McpSettings): Promise<number> {
  const result = await ensureSignedIn(authOf(supabase), { email: null, password: null });
  if (!result.ok) {
    console.error(NOT_SIGNED_IN);
    return 1;
  }
  console.error(`Signed in as ${result.user.email ?? result.user.userId}. Session folder: ${settings.configDir}`);
  return 0;
}
