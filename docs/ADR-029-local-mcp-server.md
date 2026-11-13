# ADR-029: A local MCP server for Claude Desktop, Claude Code and other MCP apps

**Status:** **Proposed 2026-11-06.** Sign-in method decided by Simon 2026-11-06: email and password (open point 1, option a). Built in steps 2 to 6 on PR #375; moves to Accepted when that merges.
**Depends on:** ADR-028 (the read-only tools layer in `src/tools/` this server reuses), ADR-017 (tenancy), ADR-009 (RLS is the tenancy check), rules 4, 7 and 8 of `CLAUDE.md`, `docs/PLAN-2026-11-reports-ai-mcp.md` (F16).

## Context

An architect who already works in Claude Desktop or Claude Code should be able to ask it about their Atlas model and get answers read from the real data, without copying anything out of Atlas. F15 built the read-only tools; this ADR decides how to expose the same tools to an MCP app running on the user's own machine.

Two facts shape it:

1. **Atlas's model lives behind sign-in.** The sibling products (Loop, Flow) read plain files in a folder, so their local servers need no login. Atlas's rows are protected by row-level security, so the server must sign the user in and read over the network as that user.
2. **The tools already take a context, not a client.** `createToolContext(supabase, model, commitId)` builds everything from a Supabase client and a commit id. A server that holds a signed-in client reuses every tool unchanged.

## Decision

### 1. Local, over stdio, read-only

The server is started by the MCP app on the user's machine and talks over stdio. There is no hosted endpoint and no new public surface. Every tool is the F15 tool (the eleven in `MODEL_TOOLS`), so it is read-only, capped (50 rows, text cut at 500 characters, `truncated` and the true `total`) and stamps the model, ref and commit it read. Names carry the prefix `atlas_` (`atlas_search_elements`, and so on), as the sibling products do, so they do not collide with other servers' tools.

Added for this server only:

- **`atlas_list_models`**: the models the signed-in user can see, with organisation and slug. Every other tool takes an optional `model` (id or slug) and uses the only model when there is exactly one; if there are several and none is named it answers with the list rather than guessing.
- **`atlas_get_guide`**: a short bundled text: how the model is organised (capabilities, systems, actors, relationships), which tool answers which kind of question, and how to cite (name the element and give its link). No model data.
- **An optional `change` argument on each tool** (a change's id from `atlas_list_changes`) to read that change's work-in-progress instead of live main. The tools take a commit, so this is a different commit id and a ref in the stamp (`ToolStamp.ref` widens from `'main'` to `'main' | { change: id }`). Reading a change is allowed only if the change is visible to the user under the same row-level security the app uses. Default is main.

No tool writes. A later, separately approved step could add tools that only ever create capture drafts for review.

### 2. Sign-in: the user's own session, no service key

The server talks to Supabase with the public URL and anon key plus the user's own session, so row-level security is the only authorisation. It never holds a service-role key, and no new token table or server function is added.

The session must be the user's *own, separate* one. It must not reuse the browser's refresh token: Supabase refresh tokens rotate and are single-use, so two clients sharing one would sign each other out. So the server signs in itself, with the same methods the app already offers (email and password, or an emailed one-time code).

Recommended mechanism (open point 1 has the alternatives):

- **Email and password, everywhere.** One command, `atlas-mcp login`, for Claude Code and any app with a terminal: it asks for email and password once, signs in, and stores **only the refresh token** (never the password) in a file readable only by the user (mode 0600) in their config folder. The server refreshes from it and rotates the stored token. In the Claude Desktop extension, the manifest declares email and password as `sensitive` user settings, which Claude Desktop keeps in the operating system's keychain; the server signs in from them at start-up.
- Accounts that signed up by emailed link and have no password set one first, through the app's normal "forgot password" flow.
- Clear, plain errors when signed out, when the session cannot be refreshed, and when the user belongs to no organisation.

Why not a browser sign-in return page: it can only hand the browser's own session to the local program, which causes the sign-out problem above, unless a server function mints a second session with the service role. That is new server code, a new secret-holding function and a new attack surface for no gain over a password the user already has.

### 3. What leaves the machine

The tool results go to whichever AI app the user connected (their own choice of Claude Desktop, Claude Code, Cursor and so on), not to Atlas's AI provider. ADR-028's owner switch is about Atlas sending content to *our* provider, so it does not strictly cover this. Recommended: **the server honours the same owner switch** (`organisations.ai_assistant_enabled`, one column the user can already read) and answers "Your organisation has not turned on AI access" while it is off, and the switch's wording in settings is extended to say it covers AI apps members connect. This is conservative and consistent ("nothing is sent while it is off"); it cannot stop a member copying text by hand, and the user guide says so plainly. Open point 2.

### 4. Package and install

`mcp/` in this repository, a small package built on the official MCP TypeScript SDK (`@modelcontextprotocol/sdk`), with its own pnpm scripts (the repository's only package manager is pnpm). It imports `src/tools/` and `src/contracts/` directly and is bundled with esbuild into one file, the same technique the edge functions use.

- `pnpm mcp:bundle` produces `mcp.mjs` plus a Claude Desktop extension (`.mcpb`) with a manifest, and a `version.json`, into `public/downloads/`. The outputs are git-ignored and built in the app's `prebuild` step, so every deploy serves a bundle from the same commit (Flow's approach; no binaries in git, nothing to keep in step by hand).
- A **quiet "Use Atlas from Claude Desktop" line on Home** (steps folded under "How to set it up") offers the download, shows the bundle version, and gives three install steps and a copy-paste config snippet for other apps. It contains only the public Supabase URL and anon key, which every browser already receives.
- An update check compares the installed version with `version.json` and says when a newer one exists (optional, off by a setting).

**Dependency:** `@modelcontextprotocol/sdk` (and `zod`, already present). Approved by Simon on 2026-11-06 (he answered yes to the question in the thread; record here if this was read wrongly).

### 5. Limits that follow from "local"

- One question at a time per tool call; the same per-result caps as F15. There is no model call in this server (the user's AI app does the reasoning), so there is no cost to Atlas and the `llm-proxy` limits do not apply.
- The user's JWT is the only credential in memory. Logs never print tokens, passwords, or model content.
- The server makes requests only to the configured Supabase URL.

## Out of scope

A hosted or remote MCP server with OAuth (what some competitors ship); write tools; reading comment bodies and capture drafts (as in ADR-028); more than one signed-in account at a time; a separate organisation-wide kill switch beyond the existing owner switch.

## Consequences

- A small widening of the tools layer: the stamp's ref, and the optional `change` argument. The in-app Ask Atlas page keeps asking about main only.
- Home gains a download card; the app gains no sign-in return page (the plan's earlier sketch is dropped, see Decision 2).
- No migration and no new server function.
- Verification the sandbox cannot do: the install in Claude Desktop, and an integration test that a viewer through this server sees only what row-level security allows (Simon runs both).

## Open points (recommended answers in brackets)

1. **Sign-in method.** **Decided: (a).** (a) Email and password, with `atlas-mcp login` for terminals and keychain-held settings for Claude Desktop [recommended: works today, no server change]; (b) emailed one-time code through two tools in the chat, which needs the email template changed to include the code and is more steps for the user; (c) a browser return page with a minted second session, which needs new server code holding a privileged key [not recommended].
2. **Owner switch covers the MCP server.** [yes, with the settings wording extended]
3. **Tool prefix `atlas_`.** [yes]
4. **Include `atlas_get_guide` and the update check.** [guide yes; update check yes, off by default]

## Built in step 2

`mcp/src/`: `main.ts` (commands `login`, `logout`, `status`, or no command to serve on stdio), `serverCore.ts` (the server, with its dependencies passed in so a test drives it over an in-memory transport), `auth.ts`, `sessionStore.ts` (the 0600 session file, behind Supabase's own `storage` interface, so a rotated refresh token is saved by the library), `config.ts`, `client.ts`, `models.ts`, `loginCli.ts`, `stdioGuard.ts` (console output goes to stderr, because stdout is the protocol). The SDK is a root `devDependency` (it is bundled, as the edge functions' libraries are). Step 3 registers `atlas_list_models`, `atlas_get_guide` and the 12 F15 tools as `atlas_<name>`. `pnpm mcp`, `pnpm mcp:login` and `pnpm mcp:status` run it from source. The tests under `mcp/` run in `pnpm test`.

## Built in step 3

`atlasTools.ts` wraps each F15 tool: it adds optional `model` (id, name or slug; optional when one live model is visible) and `change` (a changeId) arguments, resolves the model with the user's own session, checks the owning organisation's `ai_assistant_enabled` (open point 2, recommended answer taken: off means "Your organisation has not turned on AI access"), then reads main's head or the named change's head commit. `ToolStamp.ref` is now `'main' | { change: id }`; the in-app Ask Atlas page still asks about main only. A result over 60,000 characters is refused with a "narrow the lookup" message. `serverCore.ts` moved from `McpServer` to the SDK's low-level `Server`, because the tools already carry JSON Schema and `registerTool` wants Zod. `guide.ts` holds the `atlas_get_guide` text. The organisation settings wording now says the switch covers connected AI apps. Not yet exercised against a real database: a change id the user cannot see comes back as "No change with that id", which relies on row-level security on `branches`.

## Built in step 4

`mcp/src/stdio.smoke.test.ts` starts the real `main.ts` over stdio with the SDK's client, with no network, and checks the tool list, the guide and the signed-out message (so nothing but protocol reaches stdout). `mcp/src/mcpAccess.integration.test.ts` runs the tools as real users against local Supabase: an outsider sees no models and cannot read one by id, the owner switch refuses until it is on, and an unknown change id is refused. The integration config now also picks up `mcp/**/*.integration.test.ts`; the unit config excludes it. The integration file has been written but not run here (no Docker); run `pnpm db:start` then `pnpm test:integration`.

## Built in step 5

`pnpm mcp:bundle` (`scripts/bundleMcp.ts`, run by `prebuild`) bundles `mcp/src/main.ts` with esbuild into `public/downloads/atlas-mcp.mjs` (plain `node`, nothing to install), packs `atlas.mcpb` (manifest plus that file) and writes `mcp-version.json`. All three are git-ignored build output. The public Supabase URL and anon key are baked in from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (or `SUPABASE_URL` / `SUPABASE_ANON_KEY`); with neither set the script warns and the download will say it does not know which Atlas to use. The manifest template is `mcp/bundle/manifest.json`; its tool list and version are filled in from the code so they cannot drift. The sign-in is the extension's `email` and (sensitive) `password` settings; `check_for_updates` is off by default and only works when `ATLAS_APP_URL` was set at build time.

**No packaging dependency was added.** A `.mcpb` is a plain zip, so `scripts/zipFiles.ts` writes it with `node:zlib` (deterministic, tested with `unzip -t` where available). Only the MCP SDK was approved as a new dependency. The trade-off: the official `mcpb validate` is not run; the manifest is checked by `scripts/bundleMcp.test.ts` instead, and the first real install in Claude Desktop is the true check.

Home shows the Claude Desktop line only when `/downloads/mcp-version.json` exists and parses; otherwise nothing is rendered. Playwright: `e2e/golden-path-connect-claude-desktop.spec.ts`.

## Built in step 6

`docs/USER-GUIDE.md` has a "Connect Claude Desktop" section (install, sign-in, read-only, the owner switch covering connected apps, where the content goes, the optional update check). It says plainly that content read by a connected app goes to that app's provider, not Atlas's. Still open for a person to do: install the real `.mcpb` in Claude Desktop once (the manifest is checked by a test, not by Claude Desktop), and run the integration and Playwright specs named in the earlier sections.

