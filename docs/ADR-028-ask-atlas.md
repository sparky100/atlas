# ADR-028: Ask Atlas — plain-language questions over the model

**Status:** **Proposed 2026-11-06.** Moves to Accepted when the first code step (the tools layer) merges.
**Depends on:** ADR-014 (the shared LLM proxy), ADR-017 (tenancy), ADR-009 (RLS is the tenancy check), ADR-027 (the report evaluator the tools reuse), rules 4, 7 and 8 of `CLAUDE.md`, `docs/PLAN-2026-11-reports-ai-mcp.md` (F15).
**Plan:** F15 in that file. F16 (the local MCP server, ADR-029) reuses the tools layer this ADR defines.

## Context

A member should be able to ask "which systems supporting Customer Onboarding reach end of support before 2028, and who owns them?" and get an answer taken from the real model, with links to the elements it used. Today the Help panel answers how to *use the app* from the user guide; nothing answers questions *about the model*.

Three things make this risky if done casually: a plausible wrong answer is worse than no answer; model text (names, descriptions) is written by many people and can contain anything; and the content goes to an outside AI provider. The design below is built around those three.

Two facts about the existing code shape it:

1. **`llm-proxy` is text-only.** Its request carries plain string messages; it has no tool definitions and cannot return tool-call blocks. A question-and-lookup loop needs both.
2. **`capture-run` switches to the service role** after checking the caller. Ask Atlas must not: it reads on behalf of a user and must see exactly what that user could see.

## Decision

### 1. A shared, read-only tools layer in `src/tools/`

Each tool is a typed function over data the app already reads. Properties every tool has:

- **Read-only.** No tool writes anything, anywhere. There is no write tool in this sprint and the loop is given none.
- **Bounded.** Results are capped (50 rows, 20 relationships per element, text fields cut at 500 characters) and carry `truncated: true` with the true count when cut. No tool returns an unbounded list, and none uses `.in()` over a list that grows with the model (rule 8): they read the model scope once and filter in memory, like the pages do.
- **Scoped.** One model, and one ref. In F15 the ref is always **main**; the parameter exists so F16 can add "a change" without changing the tools.
- **Stamped.** Every result states the model, the ref and the commit it was read at, and returns provenance (source, confidence) wherever it returns a fact.
- **Typed in and out.** Inputs are validated (unknown fields refused, strings length-limited). A bad call returns a plain error the model can read and correct, never a thrown exception.

First set (all read-only): `search_elements`, `get_element`, `list_relationships`, `find_elements` (type and attribute filters, using the ADR-027 evaluator), `run_saved_report`, `list_health_findings`, `portfolio_signals`, `change_impact`, `list_projects`, `list_changes`, `list_decisions`. *Built in steps 2 and 2c:* all eleven, `list_changes`, `change_impact`, `list_decisions` and `list_projects` returning summaries only. Their ids are named `changeId`, `decisionId`, `projectId` and `reportId` (never `id`), and the citation check ignores ids under those keys, so a work record cannot be cited as an element. Comment bodies and capture drafts are **not** exposed in this version: they are the most free-form text in the system and the least needed to answer questions about the model.

**Layering consequence.** The row builders the report evaluator needs today live under `src/ui/` (the Elements and Portfolio row builders). `src/tools/` must not import from `src/ui/`. Step 2 therefore starts by moving the pure builders to a layer-neutral place with behaviour and tests unchanged; the pages import them from there.

### 2. The loop runs in a new edge function, `ask-model`, as the caller

`ask-model` receives the conversation, runs the question-and-lookup loop, and streams progress back. It uses the **caller's own forwarded JWT** for every database read, so RLS is the authorisation check. It never holds or uses the service-role key. A viewer cannot read what a viewer cannot read, and one organisation cannot reach another's model; an integration test proves both (rule 1's counterpart for access).

It is bundled for Deno the way `capture-run` is (one flat file, generated and git-ignored, built by `pnpm functions:bundle:ask-model` before each deploy; the deploy workflow only pushes migrations). The tools layer is pure TypeScript and imports only what the bundle can include.

### 3. Model calls go through `llm-proxy`, which gains tool support

The proxy is where provider auth, per-organisation rate limits and cost logging already live (ADR-014), so Ask Atlas uses it rather than a second path to the provider. The proxy contract gains, **additively** (a new contract version, existing callers unchanged):

- optional `tools` (definitions), and message content that may be text, a tool call or a tool result;
- a response that returns the provider's tool calls and stop reason.

`ask-model` calls the proxy once per round. Each round is therefore logged and rate-limited by the proxy with no new accounting. Tool rounds are buffered. *Built in step 3:* the final round is buffered too and the answer arrives whole, with the lookups streamed as progress events; streaming the answer text through the proxy passthrough (which now accepts `toolChoice: 'none'` for this) is a later refinement. `ask-model` interleaves its own small events with that stream: "calling `get_element`…", "done", then the answer tokens, then the citations.

The alternative, having `ask-model` call the provider directly and duplicate the key lookup, rate limit and logging, was rejected: it creates a second place that holds the provider key and a second audit trail.

### 4. Limits

A question stops at **6 lookup rounds**, **2,000 output tokens per round**, and a combined tool-result budget of about 60,000 characters; hitting a limit produces an honest "I couldn't finish; here is what I found" answer, not a silent cut. The organisation's existing hourly proxy cap applies, and a message says plainly when it is reached. Conversations are limited to the last 10 turns sent per question.

### 5. Grounding and citations

The assistant must cite elements as `[[element:<id>]]`. After the answer is written, `ask-model` checks every cited id against the ids that tools actually returned **in this question**. A cited id that no tool returned is removed and the answer is marked "contains an unverified reference". An answer with no valid citation at all is marked **ungrounded** in the UI. Citations render as links to the element page; the model's text is never rendered as HTML or as free links, so it cannot insert an outside link or image.

No canned or hard-coded answers (rule 7). If the tools return nothing relevant, the answer says so.

### 6. Model text is data, not instructions

Tool results are wrapped in clearly labelled blocks, and the system prompt states that text inside them is data to be reported on, never instructions to follow. Because no tool can write, the worst outcome of a successful injection is a wrong or misleading answer, which the citation check and the visible tool-call list are there to catch. There is no web fetch, no link following, and no tool that sends anything anywhere.

### 7. Privacy and control

Sending model content to the AI provider is **off by default**. An organisation **owner** switches it on in organisation settings, under a plain statement:

> When Ask Atlas is on, the questions members ask, and the names, descriptions, attributes and relationships of the elements needed to answer them, are sent to our AI provider to produce each answer. Comments and unreviewed imports are not sent. Nothing is sent while it is off.

Data: a single column `ai_assistant_enabled boolean not null default false` on `organisations`, with update granted on that column only; the existing owner-only update policy is the permission. `ask-model` reads it with the caller's JWT and refuses when it is false. (Migration, contract type and round-trip test shipped in step 3, because the function reads the column. The switch is checked on the model's **owning** organisation. Ask Atlas is for members: a reader of a model shared from another organisation is not a member of the owner and is refused by the proxy.)

**No conversations are stored on the server** in this version. The page keeps the conversation in memory for the session; reloading clears it. The proxy log keeps counts and timing only, as today. This avoids a new table and a retention question; saved conversations are a possible later addition with their own decision.

### 8. The page

A separate **Ask Atlas** page under Analyse, plus a Ctrl-K entry; the Help panel is unchanged and stays about using the app. The page shows the conversation, streams the answer, shows each tool call in an expandable list (what was asked and what came back, so an answer can be checked), shows citations as links, flags ungrounded and unverified answers, and shows the "off for this organisation" state with a pointer to the owner when disabled. At 390 it is a single column.

### 9. Evaluation

A fixed fixture model and **25 to 40 questions** with the element ids a correct answer must cite and the tools it should use (`pnpm ai:eval`, run on demand against the real provider by whoever holds the key). It checks the right tools were called and the right elements cited, not exact wording, and is reported in the sprint summary. It is not part of `pnpm test`: it costs money and depends on a provider. *Built in step 5:* 30 questions in `src/tools/eval/evalSet.ts` over the fixture model in `src/tools/fixtures/evalEstate.ts`, scored by `src/tools/eval/scoreEval.ts`. A unit test checks the set itself (size, real tool names, real ids, and that the expected ids for the filter questions match what `find_elements` returns), so the expectations cannot drift from the data. The questions include unanswerable ones, a planted instruction inside a record, and a request to delete something. `pnpm ai:eval [--id <question>] [--model <id>] [--json]` needs `ANTHROPIC_API_KEY`, calls the provider directly with the real loop and tools, and exits 1 on any failure. No score has been recorded yet: it has not been run against a real provider.

## Out of scope

Writing or proposing changes (a later, separately approved step: drafts through the capture pipeline into the review queue, never to main or a head table); stored conversations; questions across several models; comment bodies and capture drafts as sources; asking about a draft change (F16 adds the ref); voice; any provider other than the proxy's.

## Consequences

- One shared contract change (`llm-proxy` tool support), additive and versioned; capture and the Help chat are untouched.
- A move of pure row builders out of `src/ui/` before the tools can use them.
- One small migration (the opt-in column) and a new edge function bundled and deployed like `capture-run`.
- The evaluation set is the main cost and the main protection against answers that sound right and are not.

## Open points (recommended answers in brackets)

1. Per-question limits: 6 rounds, 2,000 tokens a round, ~60,000 characters of tool results. [as above; revisit after the evaluation set runs]
2. Which model: the proxy's configured default, not chosen by the caller. [yes]
3. Stored conversations. [not in this version]
