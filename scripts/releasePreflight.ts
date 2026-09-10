/**
 * Sprint U4-2a item 7: "`pnpm release` pre-flight fails on unapplied
 * migrations." `pnpm release` pushes `supabase/migrations` straight to the
 * live project (`supabase db push`) — nothing before this script ever
 * confirmed those same migration files had actually been applied to the
 * *local* database first. Item 1's own bug (a migration's `create or
 * replace` silently reverted an earlier fix, and nothing caught it because
 * nobody had re-run `pnpm db:reset` since editing it) is exactly the
 * failure mode this closes: a migration file that only exists on disk,
 * never replayed against a real Postgres, is unverified by definition —
 * CLAUDE.md's own DoD line ("if a migration only works against an
 * already-running project, it's broken") is the same rule stated the other
 * way round. This is a hard failure: `pnpm release` stops here.
 *
 * A second, real case this same item's own investigation turned up:
 * `20260906360000_seed_from_map_genesis_check_fix.sql`/`...370000...` exist
 * live on the "Architecture" project but, until this sprint backported
 * them, had no migration file in this repo at all — someone applied a
 * hotfix directly against the live database and never captured it. That's
 * drift in the *other* direction (remote has something local doesn't), and
 * this script checks for it too — as a warning, not a hard failure,
 * because it needs `supabase link` (a one-time, machine-local setup this
 * script can't assume) to even ask the remote project anything.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

/**
 * Every migration file's own version prefix (`YYYYMMDDHHMMSS`) — the same
 * token `supabase migration list` keys its own rows by. Warns (does not
 * fail) on a prefix whose hour component isn't a real hour (00-23) —
 * Prompt 7g's own A3 close-out: several of this sprint's own migrations
 * (2026-09-06, hours 24 through 37) used a fake incrementing "hour" purely
 * to keep same-day files sorted, not a real timestamp. Left as-is here
 * (renaming an already-applied migration's version is exactly the drift
 * `supabase migration repair` exists to fix, not something to do casually
 * after the fact), but flagged so a *new* migration doesn't repeat it —
 * same-day ordering has 59 real minutes and 59 real seconds per hour to
 * work with instead.
 */
function localMigrationVersions(): string[] {
  return readdirSync('supabase/migrations')
    .filter((name) => name.endsWith('.sql'))
    .map((name) => {
      const match = /^(\d{14})_/.exec(name);
      const version = match?.[1];
      if (!version) throw new Error(`releasePreflight: migration file "${name}" doesn't start with a 14-digit version prefix`);
      const hour = Number(version.slice(8, 10));
      if (hour > 23) {
        console.warn(`releasePreflight: migration "${name}" has version prefix "${version}" whose hour component (${String(hour)}) isn't a real hour (00-23) — fine for an already-applied migration, but new migrations should use real timestamps.`);
      }
      return version;
    });
}

type MigrationListRow = Record<string, unknown>;

/** Whichever of these keys a `supabase migration list --output json` row actually uses for "this version is applied" in the column asked about — tolerant of the CLI renaming its own JSON shape across versions (real, seen elsewhere in this repo: 20260906270000_commit_titles.sql's own comment on `p_title`/`p_message`). */
const APPLIED_KEYS: Record<'local' | 'remote', string[]> = {
  local: ['Local', 'local', 'local_version', 'LocalVersion'],
  remote: ['Remote', 'remote', 'remote_version', 'RemoteVersion'],
};

function versionApplied(row: MigrationListRow, version: string, column: 'local' | 'remote'): boolean {
  for (const key of APPLIED_KEYS[column]) {
    const value = row[key];
    if (typeof value === 'string' && value.trim() === version) return true;
  }
  return false;
}

/** Any string field on the row equalling `version` at all — a looser fallback for when neither `APPLIED_KEYS` guess matches (an unrecognised CLI shape), used only to decide "does this version appear on this row in some form," never to distinguish local from remote. */
function versionAppearsAnywhere(row: MigrationListRow, version: string): boolean {
  return Object.values(row).some((value) => typeof value === 'string' && value.trim() === version);
}

function runMigrationList(args: string[]): unknown[] | null {
  let stdout: string;
  try {
    stdout = execFileSync('supabase', ['migration', 'list', ...args, '--output', 'json'], { encoding: 'utf8' });
  } catch (e) {
    console.error(`releasePreflight: \`supabase migration list ${args.join(' ')}\` failed:`);
    console.error(e instanceof Error ? e.message : String(e));
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    console.error(`releasePreflight: could not parse \`supabase migration list ${args.join(' ')} --output json\` — CLI output format may have changed.`);
    console.error(stdout);
    return null;
  }
  if (!Array.isArray(parsed)) {
    console.error(`releasePreflight: expected \`supabase migration list ${args.join(' ')} --output json\` to return an array, got:`);
    console.error(stdout);
    return null;
  }
  const rows: unknown[] = parsed;
  return rows;
}

function main(): void {
  const versions = localMigrationVersions();
  if (versions.length === 0) {
    console.log('releasePreflight: no migration files found — nothing to check.');
    return;
  }

  const localRows = runMigrationList(['--local']);
  if (!localRows) {
    console.error('releasePreflight: could not confirm local migrations are applied — is your local Supabase running? (`pnpm db:start`)');
    process.exit(1);
    return;
  }

  const missingLocally = versions.filter(
    (version) => !localRows.some((row) => typeof row === 'object' && row !== null && (versionApplied(row as MigrationListRow, version, 'local') || versionAppearsAnywhere(row as MigrationListRow, version))),
  );
  if (missingLocally.length > 0) {
    console.error(`releasePreflight: ${String(missingLocally.length)} migration(s) exist on disk but are not applied to your local database:`);
    for (const version of missingLocally) console.error(`  - ${version}`);
    console.error('Run `pnpm db:reset` (or `pnpm db:start` if this is a fresh checkout), confirm it applies cleanly, then re-run `pnpm release`.');
    process.exit(1);
    return;
  }
  console.log(`releasePreflight: all ${String(versions.length)} local migration(s) confirmed applied to your local database.`);

  // Remote drift is a warning, not a hard failure: it needs `supabase
  // link` (a one-time, machine-local setup) to ask the remote project
  // anything at all, which this script can't assume every environment has
  // done. When it *can* check, it's worth checking — see this file's own
  // module comment for a real case it would have caught. `linked` tracks
  // whether this and the dry-run check below actually ran, versus were
  // skipped for lack of a link — neither is allowed to short-circuit the
  // rest of `main` (the backfill reminder below still always prints; a
  // dev who hasn't linked yet shouldn't lose that too).
  const remoteRows = runMigrationList(['--linked']);
  const linked = remoteRows !== null;
  if (!linked) {
    console.warn('releasePreflight: could not check the linked remote project for drift (not linked? run `supabase link`) — proceeding without that check.');
  } else {
    const remoteOnly = remoteRows.filter((row) => {
      if (typeof row !== 'object' || row === null) return false;
      const r = row as MigrationListRow;
      const remoteVersion = APPLIED_KEYS.remote.map((key) => r[key]).find((v) => typeof v === 'string');
      if (typeof remoteVersion !== 'string' || remoteVersion === '') return false;
      return !versions.includes(remoteVersion);
    });
    if (remoteOnly.length > 0) {
      console.warn(`releasePreflight: the linked remote project has migration(s) with no matching local file — likely an ad hoc hotfix applied directly and never captured (exactly what happened with seed_from_map this sprint):`);
      console.warn(JSON.stringify(remoteOnly, null, 2));
      console.warn('Consider backporting these into supabase/migrations before pushing more changes on top.');
    }
  }

  // Prompt 7g's own A3 close-out: `db push --dry-run` against the same
  // linked project the check above either confirmed reachable or warned
  // about — this is the actual push's own preview, so a failure here (bad
  // SQL, a migration that only works against a schema shape this project
  // no longer has, a permissions problem) means the real
  // `supabase db push` a few lines later in `pnpm release` would fail
  // too, just later and after this script's own green light. Catching
  // that here, before the real push runs, is the whole point of a
  // pre-flight. Skipped, not failed, when there's no link (same
  // limitation as the drift check just above) — not run standalone either
  // (this repo has no `pnpm release:dry-run` — it's one more check inside
  // the existing pre-flight, not a separate command to remember).
  if (linked) {
    try {
      execFileSync('supabase', ['db', 'push', '--dry-run'], { stdio: 'inherit' });
      console.log('releasePreflight: `supabase db push --dry-run` succeeded — the real push should too.');
    } catch (e) {
      console.error('releasePreflight: `supabase db push --dry-run` failed — the real push would fail the same way. Fix the migration(s) above before running `pnpm release` for real.');
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
      return;
    }
  }

  // Sprint U4-2a item 3: "capability order backfill run against dev,
  // idempotent, in `pnpm release` until done everywhere." A genuinely
  // automatic version can't exist as written — `atlas.commit_deltas`
  // derives its author from `auth.uid()` with no grant to `service_role`
  // at all (ADR-007/ADR-015: no fact without provenance, only owner/
  // architect commits to main), so there's no session for a release
  // script to write through for a model it doesn't already have a signed-
  // in owner/architect's credentials for. This reminder — not an
  // automatic run — is the deliberate answer, until "every model" no
  // longer needs saying because every model created since Sprint U4-1 C1
  // already gets `order` at creation (`useCapabilityCreate.ts`) and
  // nothing predates it any more; remove this block then.
  console.log('releasePreflight: reminder — if any model still predates Sprint U4-1 C1 (capabilities created without an explicit order), run `pnpm backfill:capability-order <modelId> <email> <password>` for it. Idempotent (reports "nothing to backfill" once done); no automatic way to run this for every model at once — see this script\'s own comment for why.');
}

main();
