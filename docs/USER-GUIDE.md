# Atlas User Guide

**Status:** v1 draft — written from the app's own routes, UI-principles.md, and ADR-000, for the in-app AI help chat to ground its answers in. Please review this against how Atlas actually behaves and correct anything that's wrong before treating it as authoritative; it will only get more accurate the more it's checked against the real product.

This is the guide the in-app **Help** assistant reads to answer your questions — it isn't reference documentation for developers (that's `docs/ADR-000-foundations.md` and `docs/SPEC-data-model.md`), it's written for the people who use Atlas day to day: architects modelling a landscape, and directors/service owners checking in on it.

---

## What Atlas is

Atlas is an enterprise-architecture tool for organisations with one or two architects — councils, NHS boards, housing associations, universities — sized for teams currently getting by on Sparx, Visio, or spreadsheets. Two kinds of people use it:

- **An architect**, who lives in it: capturing systems and relationships, reviewing AI-assisted imports, proposing and merging changes, recording decisions.
- **A director or service owner**, who opens it a few times a quarter and should never need training to answer "what supports capability X, and what's changing about it?"

The core idea: **every fact in Atlas shows why you should believe it**, and **every diagram is a live query, never something hand-drawn**. There's no canvas anywhere that stores its own boxes and arrows — what you see is always the model, rendered.

## Signing in and organisations

When you sign in for the first time, Atlas asks how you want to start:

- **Just me** — a personal workspace, for working alone.
- **My organisation** — a named organisation you can invite colleagues into.

You can belong to more than one organisation. From the "Your organisations" page you can open any of them, or create another. Inside an organisation, one or more **models** hold your actual architecture — most organisations start with one.

Roles inside an organisation/model: **owner**, **architect**, **contributor**, and **viewer**, each with less editing power than the last. A viewer can look at everything but not change it; a contributor can propose changes; an architect and owner can also edit directly on the main line and manage settings.

## The building blocks

Atlas models four kinds of thing:

- **Capability** — something the organisation does (a business function), independent of any system.
- **System** — a named piece of software or a service.
- **Container** — something that lives inside a System (an application, a database, a service component).
- **Actor** — a person, team, or organisation that owns or uses things. Actors can be internal or external.

Anything can be marked **external** (owned by someone else, not modelled in detail) rather than being a different type of element.

Elements connect through relationships — "owns", "uses", "supports", and similar — and Systems/Containers sit inside Capabilities as structure, not as a fact you assert yourself.

## Finding your way around

Every model-scoped page shares the same navigation, grouped into four clusters:

| Group | Pages |
|---|---|
| **Model** | Home, Capability map, Landscape, Value streams, Elements |
| **Analyse** | Portfolio, Roadmap, Reports |
| **Work** | Changes, Decisions, Capture |
| **Record** | Versions |

- **Elements** is the full list of everything in the model, with filters and export.
- **Reports** gathers the standing checks — Boundary crossings, External interfaces and Duplicates — each with its current count and a link to the full report.
- **The review queue** lives inside **Changes**, as its *Review queue* tab. The Changes item in the navigation shows a number when items are waiting for review.

**Zooming in.** Atlas is one continuous zoom through four levels: **capability map** (all your capabilities) → **landscape** (systems grouped by the capability they support) → **system context** (one system and its neighbours) → **containers** (inside one system). Scrolling/pinching zooms the current level; zooming into a specific element crosses down a level, the same way you'd zoom into a map.

**The breadcrumb**, top-left on any canvas or element page, always shows where you are: `Org › Model › [ref] › Capability › System › Container`. The `[ref]` chip tells you which version of the model you're looking at — `main`, a tagged version like `v2026-Q1`, or a change branch like `Change: Housing CRM replacement`. Click it to switch.

**Every element has a URL.** You can bookmark or share a link to any capability, system, container, decision, or change, and it opens straight to that thing, in the right state.

## Bringing data in: capture

Rather than drawing your landscape by hand, you feed Atlas source material and it proposes facts for you to review:

1. Open **Capture** (from a model's capture page) and either upload a spreadsheet (CSV/XLSX/JSON), a PDF, or paste in free text — meeting notes, an email, anything describing systems, owners, or relationships.
2. Atlas's AI reads it, matches what it finds against your existing model, and produces a **capture draft** — proposed elements, relationships, and attribute values, each with its own confidence and a note on where it came from.
3. You review the draft in the **review queue**, accepting, editing, or rejecting each proposed fact before anything actually changes your model.

Nothing is written to your model without going through this review — an AI suggestion is never silently applied.

## Changes, branches, and merging

Editing directly on `main` is for small, uncontroversial edits. For anything bigger, you work on a **change** (a branch): a named, isolated set of edits you can review and discuss before merging. The **Changes** page lists your organisation's open and past changes; opening one shows what it touches and lets you merge it back into main once it's ready, going through the same kind of review a capture draft does.

## Decisions

Architectural decisions — "why did we choose this?" — are recorded as their own first-class objects, with the evidence and reasoning that led to them, not just left as a comment somewhere. The **Decisions** page lists them; each one links back to the elements it affects.

## Comments

You can leave comments directly on elements and other objects in the model — useful for flagging something that needs attention or discussing a change with a colleague, without leaving the page you're looking at.

## Versions

**Versions** are named, permanent snapshots of your model at a point in time (e.g. a quarterly baseline) — a tag on a specific state, not a separate copy you can drift out of sync with. Use the **Versions** page to create one, and the `[ref]` chip anywhere in the app to view the model as it stood at that version.

## Capability map, roadmap, and value streams

- The **Capability map** is the all-capabilities view — your organisation's business functions, and (via colour/heat) what's changing or at risk.
- **Roadmap** shows planned and in-flight change over time.
- **Value streams** show how the organisation delivers its outcomes, stage by stage.
- **Reports** (Analyse) lists **Boundary crossings** (links across the IT/OT boundary), **External interfaces** (where your model touches systems and organisations you don't own) and **Duplicates**.

## Getting help

Click **Help** in the top bar from any organisation or model page to ask a question. It knows this guide, and — for a model-scoped page — a little about what you're currently looking at, so you can ask things like "what does this page show me?" as well as general questions like "how do I start a change?" It can't see your actual data (which systems or capabilities you've modelled), only counts and context about the page you're on.
