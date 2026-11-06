# Plan: reports and dashboards, AI over the model, local MCP server

**Status:** Proposal for Simon's review. Nothing has been built or changed.
**Source:** the Atlas vs Ardoq gap assessment (gaps 4 and 5, plus the API/MCP gap), and Simon's request on 2026-11-06 to do them in the order: reports and dashboards, then AI over the model, then a local MCP server.
**Sprint names:** F14, F15, F16 (the last plan used F9 to F13). New ADRs: 027, 028, 029.

Every sprint follows CLAUDE.md as it stands. Schema changes ship migration, contract type and round-trip test together. Every flow gets a click-only golden path from Home at 1280 and 390. All suites run locally on the final commit (this sandbox cannot run the integration or Playwright suites, so PRs carry `needs-local-verify` and Simon runs them). Work stops for a summary after each numbered step.

---

## Why this order

1. **Reports and dashboards (F14)** is the most visible gap and needs no AI or new auth. It also produces the saved, named, parameterised queries that the AI and MCP tools can reuse ("run the *Systems past end of support* report").
2. **AI over the model (F15)** needs a read-only set of model tools. Building those tools once, as a shared layer, is most of the work.
3. **Local MCP server (F16)** then becomes thin: it exposes the same tools over stdio with the user's own login. If F15 is built well, F16 is small.

---

## F14: saved reports and dashboards (ADR-027)

**Goal:** an architect can filter Elements or Portfolio, save the result as a named report, pin reports as tiles on a dashboard, and share it with the organisation. No drag-and-drop canvas and no stored node lists (CLAUDE.md rules 2 and 3).

**Design stance (to be recorded in ADR-027, see decision 1):**
- A saved report is a **query definition**, not data. It holds a source (elements, portfolio rows, relationships, health findings), filters, columns, sort, optional group-by, and a presentation (table, count, bar by attribute). It carries a `specVersion`.
- It lives in the **workflow tier**, like projects and decisions, not in the fact model. Deleting every report loses no model information, which is the same litmus test as ADR-011. So no deltas are involved, and rule 5 (which lists specific tables) is untouched.
- It is **evaluated client-side** over the materialised head using the loaders the pages already use. That keeps rule 8 intact: model-scoped queries, filtered in the client, no growing `.in()` lists.
- If a report names a custom attribute that has since been removed, it shows "attribute removed" on that column and still runs.

**Point-in-time copies (added 2026-11-06 at Simon's request):** a report definition can be edited freely, but a user can also **generate a saved output** from it, and that output never changes afterwards, whatever happens to the definition or the underlying data. It is the report equivalent of a printed copy. Design:
- A `report_snapshots` row is **insert-only**. It stores the report name and a frozen copy of the definition as it was, the model ref and the **commit id** it was read at, who generated it and when, the column headings, and the **result rows themselves** (frozen jsonb). Opening, exporting (CSV, XLSX, PDF) or printing a snapshot reads only that stored copy, never the live model, so it stays identical forever.
- Editing or deleting the source report does not touch its snapshots (the foreign key is "set null on delete", and the name and definition are copied in, so a snapshot still makes sense when its report is gone).
- Snapshots are generated from **main only** in this version. Running against a draft change could copy content a viewer is not allowed to see into a permanent record, so that is left out until it is needed.
- Visibility follows the report: private to the creator or organisation-wide. Nobody can edit a snapshot. Only the creator or an organisation owner or architect can delete one, with a confirmation that says it cannot be undone. (Recorded as a small judgment call; say if you would rather snapshots could never be deleted.)
- The commit id is stored as well, so a later feature could offer "re-run this report as of then" and compare it with the saved copy. That is not in this sprint.
- A snapshot is a record of what was reported, not a layout hint, so ADR-011's litmus test is not the right test for it. Deleting snapshots loses no model information (history stays in the deltas), but it does lose the saved copy, which is why deletion is restricted.
- Result size is capped (for example 5,000 rows; larger reports say so and ask the user to narrow the filter).
- Dashboards are live. Snapshotting a whole dashboard is a possible follow-on, not part of F14.

**Data:** `saved_reports` (model, name, description, `spec` jsonb, `spec_version`, visibility `private | organisation`, created_by), `report_snapshots` (model, report nullable, name, `spec` copy, `spec_version`, ref, `commit_id`, `columns` jsonb, `rows` jsonb, row count, generated_by, generated_at, visibility), `dashboards` (model, name, visibility), `dashboard_tiles` (dashboard, report, tile kind, order, size). RLS: any member reads organisation-visible items; contributor and above create their own; the owner, architect or creator edits reports; only owner or architect can publish to the organisation. `report_snapshots` has insert and select policies and a delete policy as described above, and **no update grant at all**.

**Steps**
1. **ADR-027, docs only:** the stance above, tile kinds, visibility rules, what is deliberately out (free-form layout, cross-model dashboards, scheduled email).
2. **Report spec and evaluator:** `src/contracts/reportSpec.ts` (types and validation) and `src/engine/reportQuery.ts`, a pure function from head rows plus a spec to a result. Property tests for determinism and for "spec round-trips through JSON".
3. **Migration, types, RLS:** the three tables, `src/db/reports.ts` typed queries, integration tests for RLS per role and the round trip.
4. **Save from Elements and Portfolio:** "Save as report" captures the current filter, sort and columns; a saved report opens back into the same page state. This is the cheap win and ships on its own.
5. **Reports library:** under Analyse, a list of saved reports (mine and organisation), run, rename, duplicate, delete, export CSV and XLSX (reusing the existing export code). Each report has a **Save a copy now** button that creates a snapshot, and a **Saved copies** list per report (date, who, row count) that opens the frozen output and exports it. Round-trip and integration tests prove a snapshot is unchanged after the report is edited, after the report is deleted, and after the underlying elements change. The report page uses the finished layout described under "Visual quality": header with as-at stamp, summary strip, chart where the report has a grouping, then the table.
6. **Dashboards and charts (revised 2026-11-06, see "Visual quality" below):** split into three parts, each its own PR and stop.
   - **6a. Chart language.** Chart colour tokens (a categorical set of eight and a sequential ramp, light and dark, checked for contrast and for colour-blind safety), and a small set of chart components in `src/ui/charts/`: ranked bar, stacked bar, donut with a centre figure, and a big-number tile with a comparison. Direct labels, legends, hover and keyboard focus, click-through to the report behind a bar, empty and loading states, reduced-motion respected.
   - **6b. Dashboard page.** Tile kinds `kpi`, `bar`, `stackedBar`, `donut`, `table` (`findingCount` dropped until a findings source exists); a responsive grid (one, two or full-width tiles, stacking at 390); a proper page header (title, as-at stamp, share state).
   - **6c. Polish.** Present mode (full screen, no chrome), dashboard export to PDF and PNG with the standard stamp (model, state, date), and a visual review pass: I render real fixture data in the browser, look at it, and refine spacing, type and colour before the PR.
7. **Golden paths:** `golden-path-save-report` (filter Elements, save, find it in the library, run, save a copy, edit an element and the report, reopen the copy and see it unchanged), `golden-path-dashboard` (build a dashboard from two reports, open a tile through to its report). User guide section.

**Size:** medium to large. The evaluator and the dashboard page are the bulk. **Migration:** yes (step 3).

---

### Visual quality (added 2026-11-06 at Simon's request)

Simon's view is that what sets Ardoq apart is visually attractive dashboards and reports. That raises the bar for this sprint; it does not change the data design (ADR-027's report spec, copies and visibility are unaffected). What changes:

- **More than the original four tiles.** The original plan had count, bar, table and finding count, all drawn as plain inline SVG. That is now a floor. Added: stacked bar, donut and big-number tiles with a comparison. A stacked bar needs a second grouping field, so the report definition gains an optional `splitBy` field (added before anything is released, so no version bump).
- **A designed chart language, not default charts.** One set of colour tokens for charts, in both themes, checked against the existing rule that colour is never the only signal (UI-principles §6.3, §8.4): direct labels and patterns as well as colour. Consistent type, spacing and corner treatment taken from the existing tokens.
- **Reports look finished too, not only dashboards.** A report page gets a header with its name, an "as at" stamp and the commit it was read at, a summary strip of big numbers, a chart where the report has a grouping, then the table. Saved copies open in the same layout, and PDF export uses it (the standard export stamp from F13 is reused).
- **Interactivity that feels alive.** Hover detail, click a bar to open the matching rows, keyboard access, and short transitions that stop for people who ask for reduced motion.
- **Built and checked visually.** I can render pages with realistic data in the cloud sandbox's browser and look at screenshots at 1280 and 390 before each UI PR, then refine. I cannot see them on your machine in Claude Desktop, so a final visual check by you is still needed.
- **Library or not.** Recommended: build the five or six chart types ourselves as small SVG components. They are simple, they follow the theme tokens exactly, and they add no dependency. A charting library would give more chart types faster (treemaps, maps, flows) but adds a dependency and fights the theme. Revisit only if you want the more exotic types. This is a decision for Simon (below).
- **Effect on timing.** F14 step 6 grows from one step into three (6a to 6c). Steps 4 and 5 (save a report, the report library and report page layout) are unchanged in order, with the report page layout added to step 5. F15 and F16 are untouched.

## F15: AI over the live model (ADR-028)

**Goal:** a member can ask questions of the model in plain language ("which systems supporting Customer Onboarding reach end of support before 2028, and who owns them?") and get an answer grounded in the real model, with links to the elements it used. **Read-only in this sprint.** It cannot change the model.

**Design stance (to be recorded in ADR-028):**
- **A shared model-tools layer** in a new `src/tools/` directory. Each tool is a typed, read-only, bounded function over the same data the app already reads: no writes, results capped (for example 50 rows, with a `truncated` flag), always scoped to one model and one ref (main or a change). Both the in-app assistant (F15) and the MCP server (F16) call this layer. Candidate tools:
  - `search_elements` (name and alias)
  - `get_element` (attributes, relationships, owners, provenance, as-of commit)
  - `list_relationships` (for an element, by type)
  - `find_elements` (type plus attribute filters, using the F14 report evaluator)
  - `run_saved_report`
  - `list_health_findings`
  - `portfolio_signals`
  - `change_impact` (reusing the existing impact logic)
  - `list_projects`, `list_changes`, `list_decisions` (summaries)
- **Where the loop runs:** an edge function (`ask-model`) that runs the tool-use loop with the **caller's own JWT**, so RLS is the authorisation check and no service-role key is involved. It calls the model through the existing `llm-proxy` path so per-organisation logging and cost attribution come for free. The tools bundle for Deno the same way `capture-run` already does.
- **Grounding:** every answer must cite element ids, rendered as links. An answer that cites nothing is flagged as ungrounded in the UI. No canned or hard-coded answers (rule 7).
- **Untrusted content:** element names, descriptions and comments are data, not instructions. Tool results are wrapped and labelled as such. With no write tools, the blast radius of a prompt injection is a wrong answer, not a changed model.
- **Privacy and control:** model content is sent to the AI provider. Off by default; an organisation owner switches it on in organisation settings, with a plain statement of what is sent. Uses the existing LLM proxy config and rate limits.
- **UI (Simon, 2026-11-06):** a **separate "Ask Atlas" page** under Analyse, plus a Ctrl-K entry. The existing Help panel stays about how to use the app; this is about the model, so the two are kept apart. Streams the answer (reusing the Help panel's streaming client code), shows which tools were called, expandable, so answers can be checked.

**Steps**
1. **ADR-028, docs only,** including the "propose a change" follow-on sketched below.
2. **Tools layer:** `src/tools/*` with unit tests per tool against fixture models, including result caps and no `.in()` over growing lists.
3. **Edge function `ask-model`:** tool-use loop, streaming, per-org opt-in check, step and token limits, logging through the proxy. Unit tests with a fake `LlmClient`; integration test for RLS (a viewer cannot read what a viewer cannot read, and one org cannot reach another's model).
4. **UI:** the Ask Atlas page, citations as links, tool-call disclosure, ungrounded warning, owner toggle in organisation settings (migration for the org setting).
5. **Evaluation set:** 25 to 40 questions with expected element ids over a fixed fixture model, run on demand with `pnpm ai:eval`. It checks that the right tools were called and the right elements cited, not exact wording. Reported in the sprint summary.
6. **Golden path:** `golden-path-ask-model` against a stubbed provider in test setup only. User guide section.

**Later, separate approval (not in this plan):** "propose a change". The assistant could draft a change through the capture pipeline, as a `capture_draft` commit with an `ai_assistant` source and a confidence, landing in the existing review queue. It never writes to main and never to a head table (rule 4). Do not start this until read-only has been used for a while.

**Size:** large. The tools layer and the evaluation set are the bulk. **Migration:** small (the org opt-in setting).

---

## F16: local MCP server (ADR-029)

**Goal:** an architect can connect Claude Desktop, Claude Code or any MCP client on their own machine to Atlas and query their model, using their own login and only what they can already see.

**Design stance (to be recorded in ADR-029):**
- **Local means stdio on the user's machine,** started by the MCP client. No hosted endpoint and no new public attack surface in this sprint.
- **Same tools as F15,** imported from `src/tools/`. The server adds `list_models` and an optional `change` argument on each tool (read a change's head instead of main). It is **read-only**.
- **Authentication, recommended: sign in as the user.** `pnpm mcp:login` opens the browser for a normal Atlas sign-in and stores the refresh token in a file readable only by the user (OS keychain later). The server then talks to Supabase with the public anon key plus the user's JWT, so RLS is the only authorisation. No service-role key, no new token table, no new server code. The alternative, per-user API tokens minted in Atlas, needs a hashed-token table and an exchange function; it is only needed when we later host a remote MCP.
- **Output:** every result states the model, ref and commit it was read at, and provenance (source and confidence) where the tool returns facts. Size caps as in F15.
- **Package and install (Simon, 2026-11-06: standard local approach, installed by the user on their machine into Claude Desktop):** `mcp/` in this repo, built on the official MCP TypeScript SDK. The user installs it locally and adds a short entry to Claude Desktop's MCP configuration (the normal `command` plus `args` shape) pointing at the server. Claude Desktop starts it on demand over stdio. **Download from the app (Simon, 2026-11-06):** the bundle is built as a single downloadable Claude Desktop extension file and offered from the app's entry page (Home), so a user installs it with one click instead of cloning anything. Needs one new dependency (the SDK), still to be approved.

**Prior art in Simon's other products (Loop/sd-studio and Flow/Des-Studio), and what changes for Atlas:**
- **Same approach, reused:** a local stdio MCP server built on the official SDK, esbuild-bundled into one `.mjs` file, then packed into a Claude Desktop `.mcpb` extension with a manifest. The app serves both files from `public/downloads/`, and a "Connect AI app" dialog offers the one-click `.mcpb` download plus a copy-paste config snippet for other apps (Claude Code, Cursor, VS Code). A `version.json` lets an installed copy tell the user when it is out of date. An end-to-end test drives the server over stdio, and the tools carry a prefix (`loop_`, `flow_`), so Atlas's would be `atlas_`.
- **Build and publish, reused from Flow rather than Loop:** Flow builds the bundle in the app's own `prebuild` step and git-ignores the output, so every deploy serves a bundle from the same commit. Loop commits the built files and runs a CI check instead. Atlas should copy Flow: no binaries in git, nothing to keep in step by hand. The one change is that Atlas uses **pnpm**, not npm (CLAUDE.md), so the `mcp/` package gets pnpm scripts.
- **The big difference you pointed out: they have no database, Atlas does.** Loop and Flow models are plain JSON files in a folder on the user's computer. Nothing goes to a server and there is no sign-in. Atlas's model lives in Supabase and is protected by row-level security, so the Atlas server must **sign the user in and read over the network**. That is why the plan needs a sign-in return page, token storage, and read-only tools over the database, and why none of their file-folder tools (`save_model`, `edit_model`, `list_models` as files) carry over. Their "open in app" trick (model passed in the link's `#` part) is also not needed for reading.
- **Smaller points worth copying:** a bundled guide tool (`atlas_get_guide`: how the model is organised, which tool answers which question, how to cite elements), an optional update-check setting in the extension, and a bundled skill file. Whether to add them is a call for ADR-029.

**Steps**
1. **ADR-029, docs only:** auth choice, read-only scope, what a later hosted/remote server would change.
2. **Server skeleton and login:** stdio server, `mcp:login`, session refresh, clear errors when signed out or when no model is selected.
3. **Tool registration:** wire the F15 tools, add `list_models` and the `change` argument, enforce result caps.
4. **Tests:** unit tests with mocked tools; a smoke test that spawns the server over stdio and calls `tools/list` and `tools/call` through the SDK client; an integration test against local Supabase proving a viewer sees only what RLS allows (Simon runs it).
5. **Bundle and download:** a build step (`pnpm mcp:bundle`, run from the app's `prebuild`, as Flow does) bundles the server with esbuild, packs the `.mcpb`, and writes both plus a `version.json` into `public/downloads/`. They are git-ignored and rebuilt on every deploy, so the download always matches the commit. A "Connect Claude Desktop" card on Home shows the download button, the bundle version, and three install steps. It contains only the public Supabase URL and anon key (already shipped to every browser), never a secret. Shown to every signed-in member. First run opens the browser for a normal Atlas sign-in (a small sign-in return page is added to the app for this), and the token stays on the user's machine. A Playwright golden path clicks the card and checks the download is served; the Claude Desktop install itself is a manual check on Simon's machine.
6. **Docs:** a user guide section "Use Atlas from Claude Desktop or Claude Code" with a copy-paste client config, and a note on what data leaves the machine.

**Size:** small to medium (the sign-in return page and the download card add to it). **Migration:** none.

**Later, separate approval:** a hosted remote MCP with OAuth (what Ardoq ships), and write tools that only ever create capture drafts.

---

## Risks

| Risk | Mitigation |
|---|---|
| Report specs drift from the schema as attributes change | `specVersion`, tolerate removed attributes, round-trip tests |
| AI answers that sound right and are wrong | Mandatory citations, tool-call disclosure, evaluation set run before each release of F15 |
| Sending model content to a provider | Off by default, owner opt-in, plain wording, existing proxy logging |
| Prompt injection through element text | Read-only tools, results labelled as data, no write path |
| Verification load: this sandbox cannot run integration or Playwright | PRs carry `needs-local-verify`; Simon runs the suites |
| Scope creep into free-form dashboards | ADR-027 names it out of scope; positions are never data |

## Decisions needed from Simon

1. ~~**F14:** are saved reports allowed to live in the workflow tier (mutable, no deltas)?~~ **Yes, Simon, 2026-11-06**, with the addition of frozen point-in-time copies (see F14). Open sub-question: may a saved copy be deleted by its creator or an owner/architect? Proposed: yes, with a confirmation.
2. ~~**F14:** private-to-me plus organisation-wide visibility.~~ **Yes, Simon, 2026-11-06.**
3. ~~**F15:** sending model content to the AI provider with an owner opt-in.~~ **Yes, Simon, 2026-11-06.** Kept off by default until an organisation owner switches it on.
4. ~~**F15:** Help panel tab or separate page.~~ **Separate "Ask Atlas" page, Simon, 2026-11-06.**
5. ~~**F16:** local server approach.~~ **Standard local install into Claude Desktop, Simon, 2026-11-06.** Auth within that: the user signs in once with `pnpm mcp:login`-style command, so their own permissions apply (no tokens to paste into config). Per-user API tokens only if we later host a remote server.
6. **F16:** approve adding the MCP TypeScript SDK as a dependency.

## What I would do first

On approval, start with F14 steps 1 and 2 (ADR-027 and the pure evaluator): docs and a pure function, no migration. That settles the report model before any schema is committed.
