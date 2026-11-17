# Atlas User Guide

**Status:** restructured 2026-11-16 and brought up to date with every change to #513 on 2026-11-17, in the words of `docs/VOCABULARY.md`. Whenever a change alters what people see, this guide changes in the same pull request. Written for the in-app AI help chat to ground its answers in — if something here doesn't match what you see, the app is right and this guide needs correcting.

Atlas's words (element types, the six relationship types, planned action, the date rule, roles and health findings) are defined once in `docs/VOCABULARY.md`; this guide uses them exactly, and so do Help, Ask Atlas, the Claude Desktop connection and the import template.

This is the guide the in-app **Help** assistant reads to answer your questions. It isn't reference documentation for developers (that's `docs/ADR-000-foundations.md` and `docs/SPEC-data-model.md`); it's written for the people who use Atlas: architects who maintain the model, and the senior people who read it.

**Words used throughout.** A role is Viewer, Contributor, Architect or Owner (what you may do). An element's owner is someone recorded as owning it (business, technical or service owner). The **live model** is the current agreed model; a **change** is a separate set of edits reviewed before it reaches the live model; a **version** is a named snapshot of the live model.

**What is where.**

1. Start here: what Atlas is, your first 10 minutes, signing in and roles.
2. The model: the building blocks and how things connect.
3. Finding your way around, then looking at the model: Home, Views, Element pages, Elements.
4. Where you are heading: Goals, Principles.
5. Changing the model: Import, Changes, Decisions, Projects.
6. Reporting and AI: Reports, Ask Atlas, Connect Claude Desktop.
7. Keeping it trustworthy: Planned action, Still accurate, Comments, History.
8. Settings, licence and help.

---

## What Atlas is

Atlas is an enterprise-architecture tool for organisations with one or two architects — councils, NHS boards, housing associations, universities — sized for teams currently getting by on Sparx, Visio or spreadsheets. Two kinds of people use it:

- **An architect**, who lives in it: recording systems and relationships, reviewing AI-assisted imports, proposing and merging changes, recording decisions.
- **A senior reader** — a director or other stakeholder — who opens it a few times a quarter and should never need training to answer "what supports capability X, and what's changing about it?"

These are ways of using Atlas, not settings: what someone can do depends only on their role (below). Who **owns** a system or capability — its business, technical or service owner — is something recorded in the model against that element, whatever that person's job title.

The core ideas:

- **Every fact shows why you should believe it.** Each value carries where it came from (a spreadsheet, an interview, someone's manual entry), how confident that source is, and how old it is.
- **Every diagram is a live view of the model, never something hand-drawn.** There's no canvas that stores its own boxes and arrows; what you see is always the model, laid out automatically.
- **Nothing is overwritten.** Every edit is recorded in the element's history, so you can always see what it said before and who changed it.

## Your first 10 minutes

**Where do I start?** It depends on your role.

- **Viewer:** you land on the capability map. Click a capability to see the systems that support it, then open a system to see its details. Use the search box at the top to find anything by name.
- **Contributor:** look around the capability map and landscape first. To change something, start a change from **Work → Changes**; it is reviewed before it reaches the live model.
- **Architect:** open Home and read **Where to focus**. Each row is a problem and links straight to it, with **Start a decision** or **Start a project** on the same row.
- **Owner:** as an architect, plus **Invite a colleague** in organisation settings.

**A new, empty model.** If your organisation has no models yet, you are offered **Look around first**, above **New model**: a made-up organisation to look around in. **Add this sample** opens its capability map and puts a separate copy in your organisation, and nothing you change in it affects anyone else. Home shows a **Get started** checklist: open the capability map (it offers a ready-made map for your sector, or you can add your own or import a spreadsheet), add a system, link it to the capability it supports, and (owners only) invite a colleague.

**A model that already has data.** Home shows a **Welcome** card with a few places to start, worded for your role. **Dismiss** hides it in that browser.

**Stuck?** Click the **Help** button at the top and ask. You can also choose a different start page for yourself.

## Signing in, organisations and roles

The first time you sign in, Atlas asks how you want to start:

- **Just me** — a personal workspace for working alone.
- **My organisation** — a named organisation you can invite colleagues into.

**Signing in with Microsoft.** The sign-in page has a **Sign in with Microsoft** button for work or school accounts. If your company's owner has recorded its Microsoft tenant ID (Organisation settings, **Microsoft sign-in**), you join that organisation as a **Viewer** the first time you sign in, and the owner can change your role afterwards. If no organisation has set it up yet, Home tells you your company hasn't set up Atlas and to ask your Atlas owner. Personal Microsoft accounts are not supported, and your Microsoft account needs an email address. Nobody is removed automatically: when someone leaves, their Microsoft account stops working, and an owner removes them from Members.

You can belong to more than one organisation; "Your organisations" lists them. Inside an organisation, one or more **models** hold your architecture — most organisations start with one.

Everyone in an organisation has one role:

| Role | Can |
|---|---|
| **Viewer** | See everything. Can't change the model, comment, or see the review queue. |
| **Contributor** | Everything a viewer can, plus comment, start changes and edit inside them, submit them for review, run an import, start decisions and projects, rate decision options and add what a decision concerns, and edit or cancel decisions they started or own. Can't edit the live model directly. |
| **Architect** | Everything a contributor can, plus edit the live model directly, approve and add changes to it, choose a decision's option, edit or cancel any proposed decision, create and archive models. |
| **Owner** | Everything an architect can, plus organisation settings, members and invites, custom attributes, Microsoft sign-in for the organisation, restoring or deleting archived models. |

## The building blocks

Atlas models these kinds of thing:

- **Capability** — something the organisation does (a business function), independent of any system. Capabilities nest inside each other (e.g. *Customer service › Contact › Complaints*); the capability map shows three levels.
- **System** — a named piece of software or a service. A system has a **kind**: application, integration platform, data platform, infrastructure, or **platform**.
- **Container** — something inside a system. Inside a **platform** (a large system such as an ERP), a container is a **module** — "Finance" inside "SAP", say. A module can set its own lifecycle, criticality, hosting, domain, run cost and planned action; where it leaves one unset it reads its platform's (except planned action, which is never inherited).
- **Interface** — a container inside an **integration platform** (MuleSoft, say) is an **interface**: an API, file drop, event topic, batch job, database feed or OT gateway the platform exposes or consumes. An interface records its **interface type** and, optionally, its **transformation** — what the platform does to the data (maps, enriches, combines, turns a file into an API). To add one, open the integration platform's page and use **+ Add interface** in its **Interfaces** section: name, type and transformation in one step.
- **Actor** — a person, team or organisation that owns or uses things. Actors can be internal or external.
- **Value stream** — how the organisation delivers an outcome, as a sequence of stages.

Anything can be marked **external** (owned by someone else) rather than being a different type of element.

Systems carry attributes such as lifecycle (planned, active, retiring, retired), criticality, run cost, planned action, hosting model and provider, IT/OT domain, **AI agent: how it acts** (suggests only, acts with approval, or acts alone; leave it blank if the system is not an AI agent), **Uses AI** (built-in AI features, or uses an AI model or service — for a system that uses AI but is not an agent), and a system counts as using AI if either is filled in, so you never fill in both for an agent. Either one shows a small **AI** tag on the system's page, the landscape, context diagrams and the integrations list, vendor, version, introduced, planned end and vendor support end. Owners can add **custom attributes** for their organisation (Organisation settings).

**Planned, active and retired.** Planned means not live yet. A system or module is **planned** until its **Introduced** date, **active** from then, and **retired** from its **Planned end** date (a module follows its platform; one marked retired with no end date counts as retired straight away). Views of today show only what is active: the landscape, the capability map and its supporting lists, Where to focus, Gaps, the Portfolio, integrations, boundary crossings, external interfaces, context diagrams, and reports and dashboards. A link (uses, flows to, via or supports) counts only when both of its ends are active, so an integration does not exist until it is live and goes with a retired system. Planned and retired items always show on their own page and in Elements, and planned items show on the Roadmap; all are marked with a **Planned · from <date>** or **Retired · to <date>** tag. A note on the landscape and capability map says how many were left out and links to the 2 year view, which shows planned items as **+ Added**. The Portfolio, and any report, has an **Include planned and retired** switch to bring them back.

How these things connect to each other is the next section.

## How things connect

Elements connect through **relationships**, which you record yourself. Each one reads as a short phrase from one element to another, and every relationship page and diagram uses the same wording. There are six types.

**The two that are easiest to mix up: uses and flows to.**

- **uses** means one thing *depends on or is used by* another. A system uses a platform it runs on or calls; a team or an outside organisation uses a system. It says nothing about data moving. Read it as "A relies on B". From the other side it reads **used by**. It can run between systems, between modules, and from a person, team or organisation to a system or module.
- **flows to** means *data moves* from one system to another. Read it as "A sends data to B". From the other side it reads **receives from**. It runs between systems or between modules, never from a person or team. A flow can go **via** an integration platform, or via one of its interfaces, and then records the protocol on each side: **protocol in** (source → platform) and **protocol out** (platform → target), for example a file over SFTP in and a REST API out.
- **Which one?** If the question is "does A need B?", record **uses**. If it is "does data travel from A to B?", record **flows to**. When both are true, record both: they are separate links, and the same pair can have one of each.
- Both can carry a short **verb** that says what it is for ("reads customer records from") and a **data classification**. Atlas asks for the verb when you add either, and Home's health findings flag any that are missing one, or a classification when the link crosses the IT/OT or enterprise boundary. On the landscape, context diagrams, the Integrations list and Reports, both appear as connections between systems, and a link that crosses the IT/OT boundary is marked.

**The other four.**

- **supports** — a system or module supports a capability. One of a system's supports links can be **primary** (it decides which lane the system sits in on the landscape). A supports link carries a **fit** rating: excellent, good, adequate or poor.
- **owns** — a person, team or organisation owns a capability, system or module, as its **business**, **technical** or **service** owner. This is a recorded fact about the element and has nothing to do with someone's organisation role (Owner, Architect and so on).
- **replaces** — one system or module replaces another (recorded when you retire something with a replacement). Retiring with a replacement **copies** the old one's capability links to the replacement and keeps the old ones. The old system still shows as supporting those capabilities until its planned end date, then stops showing; before then, nothing flags a capability as at risk because of a system that has a replacement. Integrations and other connections are not copied: they stay on the old system for you to review.
- **enables** — a capability enables a value-stream stage.

Several flows via the same interface is how reuse and combining show: the interface's page lists every flow via it, and the platform's context diagram groups its flows by interface. Health findings flag an integration platform, or an interface, that nothing flows via.

## Finding your way around

Every model page shares the same navigation, in five groups:

| Group | Pages |
|---|---|
| **Model** | Home, Capability map, Landscape, Value streams, Elements |
| **Analyse** | Portfolio, Roadmap, Reports, Ask Atlas |
| **Direction** | Goals, Principles |
| **Work** | Projects, Changes, Decisions, Import (the **Work** heading opens a page explaining them and offering **Start something**; it lists **Waiting for review**, then Projects, Decisions and Changes) |
| **Record** | History |

On a phone, the bar at the bottom shows Home, Capabilities, Landscape and Changes; everything else is under **More**. Two items show a number of open items: **Changes** — changes still open (draft, proposed, in review or approved) — and **Decisions** — decisions still proposed. Projects has no number. On a phone, a dot on **More** means Decisions has a number inside it.

**Search anywhere.** Press **Ctrl K** (**⌘K** on a Mac), or use **Search** at the top of the navigation (inside **More** on a phone), to find an element, a change or a decision by name and jump straight to it. A module is found by its platform and name together as well as by its own name — "SAP PM" and "SAP · PM" both find it. The search box on Home works the same way for elements, and is also where you create new ones — it checks for an existing element with that name first.

**Zooming in.** Atlas is one continuous zoom through four levels: **capability map** (all your capabilities) → **landscape** (systems grouped by the capability they support) → **system context** (one system and its neighbours) → **containers** (inside one system).

**The breadcrumb** at the top of a page shows where you are: `Org › Model › [ref] › …`. The `[ref]` chip says which state of the model you're looking at — the live model (shown as **live model**), a version like `v2026-Q1`, or a change like `Change: Housing CRM replacement`. Click it to switch. **Back to the live model** (in the banner shown while you look at a version or a change) returns you to the live model.

**Keyboard shortcuts.** Number keys and **j**/**k** are only used where you work through a queue of items one after another: **Gaps → Fill in** and the import review. Everywhere else — change forms, decisions, planned actions, Retire — you click. In both queues, **j** moves to the next item, **k** goes back, and a number picks that numbered answer.

**Every page has a URL.** You can bookmark or share a link to any element, change, decision, project or version, and it opens straight to it.

## Home

Home has two views; switch with **Overview** / **My work** at the top. They do different jobs: **Overview** is a briefing on the state of the business — what's weak and what's changing — and **My work** is a worklist for the people who maintain the model — what's waiting, what's part-done, and what's missing or wrong in the model. Anyone can use either — it changes what Home shows, never what you're allowed to do — and Atlas remembers your choice. Until you pick one, Owners and Architects start on My work and everyone else on Overview.

- **Overview** reads top to bottom: **Where to focus** (only the capabilities with a problem — a system at end of life, no system recorded, or a supporter rated a poor or adequate fit; healthy capabilities are on the capability map, not here. Each problem is one row: the system or capability as a link, what is wrong with it, and — only when nothing is in hand — its own "Start a decision" and "Start a project". If a project or decision is already about it, the tile says **Being handled by** and links to it, otherwise *No project or decision yet*), **What we're doing** — the projects in hand (owner, target date, progress, and any decision overdue) and the open decisions that belong to no project — and **What's recent**: the decisions made and projects closed since the newest version, then the versions themselves. Individual changes don't appear here: a project's changes show as its progress, and a correction or a record of something that already happened is housekeeping, not news. Its only create controls are **Start a project** and **Start a decision**; to start a change, use **Changes** (its form also records something that's already happened) or **Propose a change** on an element page.
- **My work** starts with a row of counts — the review queue, findings needing attention, assurance items, your own open changes, duplicates flagged, and **key facts missing** across the model (the same count as **Gaps**, and it links there) — then the review queue, **Health findings** and **Assurance**. Beside them: **My decisions** (open decisions you own, overdue first, each naming its project), **My projects** (projects you're accountable for, with their progress), your own open changes, and recent activity. Each finding names what it found and links to it; many offer **Start a decision →** or **Start a project →** pre-filled from the finding. When nothing is wrong, each group collapses to "N checks clear". Each view links to the other rather than repeating it: capabilities with nothing supporting them, or a supporter rated a poor or adequate fit, show on Overview only, and Overview points to My work for missing owners, links, labels and stale values.

**Your start page.** Opening a model from the model list takes you to your start page: the capability map for viewers and contributors, Home for owners and architects. Pick another (Home, Capability map or Landscape) under **Profile → Start page**, or press **Make this my start page** on any of those three pages. The choice follows you across organisations. On a phone, the **Search** button in the header searches elements, changes, decisions and projects from any page.

**Get started.** A model with no capabilities, no systems or no system-to-capability links shows a **Get started** checklist on Home (for people who can add to the model). Owners also get an **Invite a colleague** step, which ticks once an invite has been sent. A model that already has data shows a **Welcome** card instead. Each step ticks itself from the model's real contents and links to the screen that does it (the capabilities step opens the capability map, with Import as a second link); **Dismiss** hides it in that browser.

Health findings are named as follows: **Systems not linked to a capability**; **Platform supports that could move to a module**; **Capabilities with no owner**; **Items not checked recently**; **Systems with no technical owner**; **AI agents that act alone with no technical owner**; **Critical systems with no business owner**; **Critical systems exposed with no replacement**; **Unused integration platforms**; **Unused integration interfaces**; **Essential systems with no technical owner**; **Critical systems past or near support end**; **Capabilities with no supporters**; **Planned to move or switch off, nothing retiring it**. Home also flags relationships that are missing a verb, or a data classification across the IT/OT or enterprise boundary.

## Views: capability map, landscape and more

- **Capability map** — every capability, in its hierarchy. **Colour by** coverage, oldest lifecycle stage, lifecycle exposure, criticality, OT share, fit, planned action, **AI share** or **Run cost**. **Run cost** shows the costliest run-cost band among the systems and modules supporting each capability, written on the tile (for example “costliest: £1m–£5m”) and shaded in one purple, used only for cost, darker for a dearer band. It never adds costs up, because run cost is recorded as a band, not a figure; a capability whose supporters have no cost recorded says “no run cost recorded”. The one-page whole-map view does not tint cost, because cost is an amount, not a problem. **AI share** shows how many of the systems supporting it use AI — for example "2/3 use AI" — and, once an agent is among them, the freest way any of them acts; each of the other colourings is the worst among the systems supporting it. If the model is empty, you can **start from a capability map** — a ready-made set for your sector. Owners can also **Export as starter map** (in the map's ⋯ actions), saving this model's capabilities as a draft starter map for seeding other models. **View as at** (above the map, same as the Landscape's): Today, 6 months, 1 year, 2 years or a later date shows the map as it is planned to be then — agreed planned changes with a date by then are applied, and systems appear or go by their own start and end dates, so the supporting-system counts, gaps and colours all follow. A tile whose supporting systems differ from today is outlined and marked "Changes by this date" (untick **Highlight what changes from today** to hide that). It is read-only: nothing can be edited or exported while a date is set.
- **Landscape** — systems in lanes by the capability they mainly support, with OT systems in their own zone. Colour by criticality, hosting model or IT/OT domain. Zoom into a system for its **context**, and into a platform for its **modules**. **Find on this landscape** (above the diagram) takes part of a name: choosing a match focuses that tile, with its connections, and centres it — on a phone it opens the group and highlights the row. In a change's **Diff** view, a **context** diagram marks what the change adds (+), removes (−, dashed) and changes (~) on its connections and tiles, with a legend; everything unchanged is dimmed. A platform's own **context** draws each flow as source → platform → target, numbered on both sides so a line leaving the platform can be matched to the one that entered it; hover a source or target to pick out its flows. The change's list of edits names a module as "Platform · Module", like everywhere else. **Map / Matrix** (wide screens) switches the same systems into a grid: systems down the side (a platform's modules indented beneath it), level 1 capabilities across the top, and in each cell the fit of that system for that capability — Excellent, Good, Adequate, Poor or Not rated — marked *primary* where it is the system's main link. A closed capability counts every link beneath it; **+** opens it into its child capabilities (with a column for links made to the capability itself), **−** closes it again. An empty column is a capability nothing supports; a column with many systems is overlap. Clicking a cell selects that system in the side panel, and clicking a name opens its page. The matrix uses the same filters and **View as at** date as the map. On a phone the grouped list stays. **Connections** (wide screens) shows which areas of the business send data to, or rely on, which others: the Landscape's lanes down the side and across the top, and in each cell a count of the links from the area on the left to the area across the top. Switch between **Data flows** ("A sends data to B") and **Dependencies** ("A relies on B"); click a count to list those links, each opening its systems, with a link on to the full Integrations list. The diagonal is links inside one area; internal actors sit in their own Actors area. It uses the same filters and **View as at** date as the map; on a phone the grouped list stays. Opened from a capability (its supporting-system count on the capability map), it lists just the systems supporting that capability, with **Export CSV** and **Export XLSX**.
- **Value streams** — how the organisation delivers its outcomes, stage by stage, and which capabilities enable each stage (weak supporting systems show up the stream). Keep stages short, one line each; Atlas suggests splitting a stream once it has more than 6 stages. Value-stream structure is edited on main, or in a **Correct** change.
- **Roadmap** — looks forward from today: systems' lifecycles (introduced, planned end, support end) and changes' target dates, **by capability**, **by value stream** or **by project**, in months, quarters or years, with filters, **Export table** (CSV) and **Export PNG**. A system that went live earlier shows a bar that runs in from the left edge, and its caption still gives the real start date. Systems already retired and changes already delivered are left off, and a note says how many. **Show the past year** starts the timeline a year back, shades the part before today, and brings back what was retired or delivered in that year, marked **Retired · to <date>**. The ← button stops at the earliest month shown. Export table and Export PNG follow what is on screen.
- **Portfolio** — every system and module with run cost against fit, criticality, planned action, lifecycle and capabilities served, sortable and filterable, with **signals** where the combination matters (for example *Costly, poor fit*, *Costly overlap*, *Invest, poor fit*, *Justified*) and a note when a row is missing the inputs to judge it.

Diagrams redraw to fit whenever you resize the window.

**IT/OT crossings.** On the landscape and context diagrams, a link that crosses the IT/OT boundary is drawn as a heavier grey line with an **IT/OT** tag, and the key explains it. Orange is used only for lifecycle (retiring or retired).

**Export PNG** and **Export PDF** on the capability map and the landscape download a picture of the view as you see it, with the current colour-by. Portfolio is a table, so it offers **Export Excel** (a spreadsheet of the rows with Portfolio's filters and sort applied, plus an About sheet with the stamp) and **Export PDF** instead of a PNG. Every picture is stamped with the model, which state you are looking at (main, a version, or a change by name) and the date. Any member can export. The landscape picture shows systems in their lanes but not the connections between them, and says so. A picture is a copy, not part of the model: it doesn't update when the model changes.

## Element pages

Open any element to see its **attributes**, **relationships**, **structure** (modules, or value-stream stages), the **changes touching it**, its **documents**, its **history**, its **decisions** and **comments**.

- Each value has a small **provenance badge**: where it came from and **Last checked**, how long ago someone last confirmed it — anything over 12 months old shows in the warning colour. There are no confidence ratings on values a person has reviewed. Hover or tap for the full source.
- **✎ Edit** changes its attributes; **+ Add …** under each relationship group adds a link.
- **✓ Still accurate** confirms that everything on it is still right — see below.
- To **rename** an element, click its name (a pencil appears beside it). The **⋯ menu** holds **Start a decision…** and **Start a project…**, then **Mark as retired…** (a planned end date, and optionally what replaces it — its capability links are copied to the replacement and kept on the old one until its planned end date, after which the old one no longer shows as supporting them; integrations and other connections are left on the old one for you to review), **Merge a duplicate into…** (when two elements are really the same thing; the old name stays findable by search), **Make this a module of…** (move a system inside a platform), and **Remove from model…** last.

- **Changes touching it** lists each change that touches the element, with its project when it has one. **Decisions** lists the decisions that concern it.
- **Documents** lists the documents behind an element — a design, a business case, a contract — as a name plus where it lives. Atlas never stores the document itself. Each entry is either a web link (Confluence, SharePoint and so on, which opens in a new tab) or a plain note of where to find it, such as "SharePoint › Business cases". Owners and architects use **+ Add a document**, **Edit** and **Remove**; everyone else can read them, and can leave a comment to ask for one to be added. Document changes save straight away and don't appear in History.

What you can do depends on your role and on whether you're looking at the live model or a change (see below). On the live model, a contributor sees **Propose a change** instead of Edit.

## The Elements page

**Elements** lists everything in the model. Search by name or owner, filter by type, planned action or a custom attribute, tick **AI agents only** or **Uses AI**, or pick a **Finding** to see just the elements a health finding flagged. Sort by any column (a **Completeness** column shows how many of a system's key facts are recorded, for example “4 of 6”, and sorting by it puts the least complete first; an **AI** column appears when any listed system uses AI: an agent shows how it acts, anything else shows **Built-in AI** or **AI service**), and **Export CSV** or **Export XLSX**. **Export everything (JSON)** downloads the whole model — every element, relationship (all six types), value, where each value came from, the sources, your custom attribute definitions, plus your goals and the capabilities that serve each — whatever filter is on. It is a backup and analysis file: **Import cannot read it back**, and it does not hold decisions, principles, projects, changes, comments or versions. To bring data back in through **Import**, use the workbook instead. The workbook carries each element's **Atlas ID** and its parent (a module's system, a capability's parent capability) and lists every relationship, so it can be brought back in through **Import**: modules keep their platform and systems keep their capability links.

**Key facts “N of M recorded”.** A system or module shows how many of its key facts are recorded as a plain count, never a score: its run cost; for a system also its owner, criticality, planned action and at least one capability link; and a fit rating on each capability link. The chip beside its name (for example “4 of 6 recorded”) says what is missing and opens **Fill in** on that system. A capability shows the same count added up over the systems that support it. Retired systems have none. The same count is the **Completeness** column on Elements, the **key facts missing** count on My work, and the list on **Gaps** (under Reports).

- **Edit in grid** turns the Lifecycle, Criticality and Planned action cells (and a custom attribute's column, when one is shown) into editable controls. **Save N changes** records them all as one edit — on the live model, or in the change you're working in. While editing, each row also has **✓ Still accurate**.
- **Import…** (architects and owners) takes you to Import.

## Goals

A **goal** is what your organisation is trying to achieve, such as "Cut the time to connect a new customer". Goals answer one question: *why does this capability matter?* **Direction → Goals** lists them. Each has a **title**, **what success looks like** in a sentence or two, and optionally **why now** (a regulation, a merger, a contract ending). Under each goal you see the capabilities that **serve** it, with how many systems support each, as plain numbers, never a score. Owners and architects add, edit and **retire** goals and choose which capabilities serve each one; everyone else can read them. A retired goal is never deleted, its wording is fixed while it is retired, and **Make active again** brings it back.

A capability's own page has a **Why it matters** section listing the goals it serves, where owners and architects can link another goal. A goal is a note about intent, not a part of the landscape: you cannot link a system or a relationship to one, and removing every goal changes nothing in the model.

Ask Atlas and Claude Desktop can answer "why does this capability matter?" from the same goals.

## Principles

A **principle** is a short rule your team agrees decisions will be checked against, such as "Reuse before buying, buy before building". A good principle can change which option you choose; a rule that only says "keep the record complete" is a gap to fix, not a principle. **Direction → Principles** lists them, each with a title, **the rule** in a sentence or two, and optionally **why** a team would accept it. Owners and architects add, edit and **retire** them; everyone else can read them. A retired principle is never deleted: it stays on the decisions that cite it, its wording is fixed while it is retired, and **Make active again** brings it back.

Each principle shows the decisions that **follow** it and the ones that **depart from** it, with the reason given for each departure, as plain counts and links. A decision can only cite an active principle from its own model, and only while the decision is still proposed. A departure always needs a reason; following one does not.

**Start from a set.** You never have to write principles from scratch. When Atlas has published sets of principles, owners and architects see **Start from a set** at the top of the page. Open a set, **tick** the principles you want (none are ticked for you) and choose **Add**. Each one becomes your own principle: reword it, retire it, or leave it, and the set itself is never changed. A card says which set and version it started from. A principle you already have with the same title is left alone, so adding a set twice does nothing. You can always write your own principles too.

**On a decision.** A decision has a **Principles** section after its concerns. While the decision is proposed, choose for each principle whether the decision **follows it**, **departs from it**, or **takes no view**. A departure needs a reason, because that reason is what makes a departure a deliberate choice rather than drift. Once the decision is made or cancelled the choices are fixed and listed as a record. They are decision-wide, not per option. **Copy as ADR markdown** and the project pack include a **Principles** section, and the Architect and Director homes show how many decisions depart from a principle when there is at least one.

## Bringing data in: import

Rather than typing your landscape in by hand, you can feed Atlas source material and review what it proposes:

1. Open **Import**. If you are starting from your own list, **Download a blank spreadsheet** gives you a workbook with the standard columns, a **Read me first** sheet that explains each one and the fixed choices (including what **uses** and **flows to** mean, and that supports, owners and replacements come from other columns, not from relationship rows), a Systems sheet and a Relationships sheet, with one clearly marked example row to delete. **AI prompt for preparing an import file** downloads instructions you can give an AI assistant to turn your notes into a file Atlas reads. Then upload a spreadsheet (CSV or XLSX), a JSON file or a PDF, or paste in free text — meeting notes, an email, anything describing systems, owners or relationships.
2. Atlas reads it (using AI for documents and text; the standard column headings in a spreadsheet are recognised without it), matches what it finds against your model, and produces an **import draft**: proposed elements, relationships and values, each with a confidence and a note on where in the source it came from. Spreadsheet columns such as "Criticality", "Run cost", "Planned action" or "Fit" (how well the system serves the capability named on the same row) are recognised (the older headings "TIME" and "Disposition" mean the same thing and are recognised too). Dates follow the planned, active and retired rule above: a system with no **Introduced** date counts as active straight away, and one with a future date stays planned (and out of today's views) until then. If the Lifecycle you typed and the dates disagree, the element page says so and offers the status the dates point to.
3. Review the draft — from Import, or the **Waiting for review** tab of Changes. Accept, reject, edit, split or merge each proposal; the keyboard works too (**j**/**k** to move to the next or previous row, **1**–**5** to pick a match, **a** accept, **r** reject, **e** edit, **x** to select several). Choose a **target change**, then **Apply decisions** to write the accepted facts into it. On a phone, tick **Select** on rows (or **Select all** on a group) and use **Accept selected** / **Reject selected**. If you rejected everything, there's nothing to apply: the button becomes **Finish review**, which closes the draft without creating a change. To throw a draft away without reviewing it, use **Discard this draft…** on the review page, or **Discard** in the review queue; if the same file was imported several times, the queue offers **Discard N older copies** to keep just the newest.

Nothing reaches your model without this review, and it always lands in a change you then submit like any other.

**Connecting a tool instead of uploading a file.** Owners can link Atlas to MuleSoft Anypoint once, in **Organisation settings → Connections** (the page explains each step, including what to create in Anypoint). After that, on **Import → MuleSoft Anypoint**, **Fetch from MuleSoft** replaces the export script and the upload. You still review everything before it changes your model, and the file route still works. The client secret is saved encrypted and never shown again; owners set the connection up and remove it, architects can test it. See `docs/import/mulesoft/connector.md`.

## Changes

Editing the live model directly is for architects and owners making small, uncontroversial edits. Everything else happens in a **change**: a named, separate set of edits you can review before it reaches the live model.

Every change says **why** it exists:

- **Record** — something already happened (with a delivered date).
- **Propose** — something is planned (with a target date).
- **Correct** — the record was wrong.
- **Explore** — a candidate future, created as an option inside a decision.

**Working in a change.** Create one from **Changes** (or **Propose a change** on an element page): type what the change is in the one box, "What's this change?" (for example *Retire the legacy CRM*), add an optional description, choose **Why** and, where asked, a date. Atlas makes any short code it needs itself, so there is no name to invent. Then use **Edit in this change** in the banner at the top of the page: every edit you make while it shows **Editing in this change** goes into the change, not main. The change page shows what it touches.

**The change page.** The main action for the change's stage sits in the header (**Submit for review**, **Approve & merge** and so on), so you don't have to hunt for it. The details are on the left (description, what the change does, its parts, comments) and the impact is on the right (affected capabilities and value streams, and other open changes touching the same elements). A section with nothing in it is hidden. The change's page also shows its project and the decisions it belongs to.

**Standard changes (no AI).** Under **New change**, choose **Add a new system** (the form asks **Is it an AI agent?** and **Does it use AI?**), **Retire a system** or **Change details of a system**. Atlas starts the change and opens the right screen on it: the add box, the Retire panel (replaced by an existing system or a module inside a platform, a new one, or nothing; the search finds both, with the planned end date; capability links are copied to the replacement and kept on the old system until its end date, other connections are left for you to review) or the system's edit form.

**Draft with AI.** If Ask Atlas is enabled for your organisation, open Changes and pick a common change under **New change** (Add an integration, Add a system to a capability), or choose **Describe your own**. For a common change, pick the systems and capabilities involved from your model and edit the wording if you like. From a system on main, choose **Draft with AI** to describe a change to that system. If the setting is off, Changes says so and tells owners where to switch it on. Review the suggested system and relationship edits, check their source passages, then select **Apply to draft Change**. Open the draft to review its impact, add a target date and submit it for review. For a phased move, record any removals or retirement separately in the draft once you know their scope.

**Getting it added to the live model.**

- **Record** and **Correct** changes need one architect or owner: **Approve & merge** on the change page.
- **Propose** and **Explore** changes go through review: **Submit for review**, pick the reviewers, and they appear in the **Waiting for review** tab of Changes, and in a **Waiting for review** section at the top of the Changes list (drafts stay in the intent groups below it). Reviewers **Approve**, **Request changes** or **Abstain**; once the required reviewers approve, an architect or owner **Merges**.
- If the live model has moved on since you started, the change page says **The model has changed since you started** and shows what clashes. Resolve each one, then press **Bring up to date**. A change already in review does the same from the review page, with **Bring up to date and resubmit**.
- A change in review can be **split**, sending some of its edits on ahead as their own change.
- A change still in draft or proposed can be **cancelled** (with a reason); **Duplicate into a new draft** starts again from it. The Changes page lists open changes (draft, proposed, in review or approved) grouped by intent — the number on the **Changes** menu item is how many there are. Merged, cancelled, and rejected or archived changes each have their own collapsed section at the bottom.

## Decisions

Architectural decisions — "why did we choose this?" — are first-class objects, not a comment somewhere. **Decisions** lists them as proposed, accepted, cancelled or superseded.

A decision has its **context**, the elements it **concerns**, and its **options**. Each option is an Explore change — a candidate future you can design in the model and **View diagram →** for. Rate each option against the **criteria** (cost, effort, delivery risk, timing, vendor and strategic fit) and compare what each option **changes** and what else it affects. An architect or owner **Chooses** an option, giving the reasons; the other options are closed, and **Work on this as a change** takes the chosen one forward. **Copy as ADR markdown** exports the decision.

While a decision is proposed, **✎ Edit decision** changes its title, context, owner, needed-by date and Lens map link (for whoever started it, or an architect or owner), and the **Concerns** panel has a search to add the capabilities and systems it's about (any contributor). A concern can't be removed once added. Once a decision is chosen or cancelled, nothing on it can be edited.

A decision that's no longer needed can be **cancelled** while it's still proposed — **Cancel decision…** on its page, by its owner or an architect or owner, giving the reason. It isn't deleted: it stays in the decision log marked cancelled, with who cancelled it, when and why, and any options still in draft are cancelled with it. A cancelled decision can't be reopened; start a new one instead. Cancelling is also how you clear a decision that's stopping its project from closing.

Start a decision from **Decisions**, from a project, or with **Start a decision →** on a Home finding, a weak capability or a value stream's panel. An element page's **Decisions** section shows the decisions that concern it.

## Projects

A **project** holds one piece of architecture work — "Housing CRM replacement", say — together with the decisions it raises and the changes that deliver it. Open **Projects** (under Work) to see every project, grouped as active, on hold, closed or cancelled.

- **Start a project** from the Projects page, from a health finding or weak capability ("Start a project →"), or from an element's ⋯ menu. Give it a title, its purpose, an **Architect** (who leads the design), an optional **Project manager** (pick an Atlas member, or type a name for someone who isn't on Atlas), optional start and target dates, and the capabilities and systems it's about (its **declared scope**).
- **Its decision log** lists the decisions that are part of the project. Start one from the project page, or move a proposed decision in with **Add to project…** (or **Move…**, if it's already in another project) on its page — its draft options move with it. Decisions made elsewhere that constrain the project are listed separately as **constraining decisions**; linking one isn't possible from the app yet. Decisions don't have to belong to a project.
- **Its changes** are its design deliverables, shown by stage: options being explored, the chosen design, in review, added to the live model. Start one from the project page, or use **Add to project…** on any open change.
- **Scope against what it touches.** The page compares the declared scope with what the project's changes actually touch, and lists any difference — it never changes either for you.
- **Evidence** — business cases, vendor documents and links — can be attached.
- **On hold, close or cancel.** Close or cancel only once nothing in the project is still open; the page lists anything that is. Cancelling asks why. A closed or cancelled project can't be reopened.
- **Project pack.** **Project pack (Markdown)** and **Project pack (PDF)** download the project as one document to hand over: its purpose, scope (and any gap with what the changes touch), the decision log — each decision written up as an ADR, the same as **Copy as ADR markdown** on the decision's page — the target state each change sets out (what it creates, changes and retires, and the capabilities it affects), and the evidence links. Any member can download it. It's a copy as of the moment you download it. The PDF uses a standard font; characters it can't show (for example non-Latin scripts) appear as "?" there, while the Markdown keeps them as written.

A project is part of how your team works, not part of the model itself: it never appears on the capability map or landscape, and it isn't in a version.

## Reports and gaps

**Reports** (Analyse) lists the standing checks, each with its current count:

- **Boundary crossings** — links across the IT/OT boundary.
- **External interfaces** — links that cross the enterprise boundary without a data classification, and external organisations with access to your systems.
- **Duplicates** — elements that look like the same thing recorded twice. **Check now** runs a fresh check; merge a pair, or dismiss it as not a duplicate.
- **Gaps** — the systems missing a fit rating, an owner, a run cost, a criticality or a planned action. **Fill in** walks them one at a time: press a number to pick an answer and move on, **j** to skip, **k** to go back. Each answer is saved as you go. On an **owner** gap, if the owner you want isn't in the list, type its name and choose **+ Add “name” as a new owner**, then say whether it is an organisation, a team or a person. The same option appears wherever you add an owner on a system, capability or module page.

### Saved reports, copies and dashboards

A saved report's summary is written in plain English, for example how many systems match and what is missing.

On **Elements** and **Portfolio**, **Save as report…** keeps the page's current search, filters and sort under a name. Tick **Share with the organisation** (owners and architects) to let everyone see it; otherwise it is private to you. Pick a saved report from **Saved reports** on either page to bring that view back. A report is live: it always shows main as it is now.

- **Reports → your report** shows the result, with **Download CSV**, **Download Excel**, **Export PNG** and **Export PDF** (the picture is stamped with the model, the state and the date).
- **Edit report settings…** (on the report's own page, for whoever may edit it) chooses how it is shown: **Table**, **Count only**, **Bar chart** or **Donut**, grouped by a field (lifecycle, criticality, owner, a custom attribute and so on) and optionally **split by** a second field for a stacked bar. A table can show only its first few rows. The same panel edits the description and, for owners and architects, sharing. A report only becomes a chart once it has a grouping, so this is how a dashboard gets bar, donut and stacked-bar tiles.
- To change which rows a report includes, open it from **Saved reports** on Elements or Portfolio, adjust the filters, and choose **Save changes to "…"**. Its chart settings are kept.
- **Click a bar, a donut slice or a stacked segment** (on a report or a dashboard) to see just the rows behind it. A strip says what you are looking at; **Show the whole report** goes back. Nothing is saved by doing this.
- **Save a copy now** keeps a frozen record of the result as at that moment. It never changes, even when the report or the model does, and opens under **Saved copies**. The person who made a copy can delete it (an owner or architect can delete a shared one) after a confirmation; deleting cannot be undone.
- **Add standard dashboards…** (on the Reports page) adds ready-made dashboards to the model: **Application portfolio overview** (applications, missing owners and planned actions, lifecycle, criticality, critical applications) and **Rationalisation (TIME)** (planned action, fit by run cost, eliminate and migrate candidates, costly applications that fit poorly), and **AI in use** (how many systems use AI, how many are agents, how many act alone, how many have no business owner, how AI is used, how agents act, and an **AI inventory** table with each system's owner and the capabilities it supports). "How it acts" and "Uses AI" are also fields in any report. Each comes with its saved reports, shared with the organisation when an owner or architect adds it, otherwise private. They are ordinary reports and dashboards: change or delete them as you like.
- **New dashboard…** (on the Reports page) shows several saved reports together, live. **Edit dashboard** adds a tile from a saved report (as a big number, bar chart, stacked bar chart, donut or table; one column, two or full width), changes a tile's chart type or how many rows a table tile shows, reorders, resizes and removes tiles. A big-number tile shows what share of the model it is. Hover over a donut or a stacked bar's legend to pick out one value. A dashboard shared with the organisation can only use shared reports.
- **Present** fills the screen with the dashboard and no editing controls; **Esc** or **Exit presenting** goes back. **Export PNG** and **Export PDF** download the dashboard as a picture.

A report that uses a health-finding filter cannot be saved yet; the page says so.

## Ask Atlas

**Analyse → Ask Atlas** (or press Ctrl-K and type "ask") lets you ask a question about the model in plain words, such as "Which systems are critical?".

- It is **off until an organisation owner switches it on**, in organisation settings under Ask Atlas. While it is on, your questions and the names, descriptions, attributes and relationships of the elements needed to answer them are sent to our AI provider. Comments and unreviewed imports are not sent.
- It can only read. It cannot change anything. It can answer about elements and how they connect, saved reports, data-quality findings, portfolio signals, and the changes, decisions, projects, goals and principles recorded for the model (summaries only; comments and unreviewed imports are not read).
- Every element it names is a link to that element's page. An answer that names no element is marked **Ungrounded**, and a reference it could not verify is removed and flagged. Open **What was looked up** under an answer to see each lookup and how many results it found.
- Answers come from the live model only (Claude Desktop, below, can also read a change). They are for today, like the Portfolio and the landscape: planned and retired systems are left out, and the answer says when it has left some out. Ask for them by name, or ask what is planned, and it includes them. It uses the words the app uses, for example **Planned action**, and explains **uses** and **flows to** as this guide does. Long lists are cut short, and the answer says so.
- Nothing is saved: reload the page, or press Clear, and the conversation is gone.

## Connect Claude Desktop

If you use Claude Desktop, you can ask it about your models directly. **Home** has a small "Use Atlas from Claude Desktop" line with the download, and a "How to set it up" fold-out (the line only appears when your Atlas has one published).

1. Download the Atlas extension and open the file. Claude Desktop asks you to install it.
2. Enter the email and password you use for Atlas when it asks. The password is kept in your computer's secure storage.
3. Ask a question in Claude Desktop, for example "Which of our systems support our most important capabilities?".

- It is **read-only** and shows only what you can already see in Atlas, because it signs in as you.
- It is **off until an organisation owner switches on Ask Atlas** (organisation settings). That switch covers connected apps too: while it is off, Claude Desktop is told your organisation has not turned on AI access and gets no model content.
- Claude Desktop is your own choice of AI app, so what it reads goes to it and to its provider, not through Atlas's AI provider. Anything you copy out of a reply is yours to handle as you would any other Atlas data.
- If you have more than one model, say which: "in the Council model, ...". Ask for a change by name to see a model as that change would leave it.
- It signs in with an Atlas email and password. If you only ever sign in with **Microsoft**, you have no Atlas password, so it cannot connect for you yet.
- It needs Node.js 20 or later on your computer. If it says you are not signed in, check the email and password in the extension's settings.
- **Check for updates** (off by default) makes it fetch one small version file when it starts, so it can tell you a newer download exists. It sends nothing about you or your models.

## Planned action (TIME)

Each system's **Planned action** can be **Keep as is**, **Invest**, **Move to another system** or **Switch off** (stored internally as Tolerate, Invest, Migrate, Eliminate); a module can set its own, but never takes its platform's. Unset reads **Not assessed**, never Tolerate. Elements and Portfolio show, sort and filter by it; the capability map can be coloured by it; spreadsheet capture reads a "TIME" or "Disposition" column. A system planned to move or switch off that nothing is retiring — no open change retires it, and it isn't already retiring — is a health finding on Home, linking to its project or offering to start one.

## Still accurate

Values age: anything not updated for 12 months (an owner or architect can change that in Organisation settings → Out-of-date information) shows its age in the warning colour, and My work lists the items not checked in that time, for every kind of element. On that list an owner or architect can press **Email owners a reminder**: each owner gets an email listing their items, each linking to the item, and anything with no owner on record goes to the architects. Nobody is emailed twice in a week, and you can switch these emails off on your Profile page. If you've checked an element and everything on it is still right, press **✓ Still accurate** beside **✎ Edit** on its page (or on its row in the Elements grid while editing). That records a confirmation — today's date, by you — for every value on it without changing any of them; its provenance shows ✓, and the original source stays in the element's history.

## Comments and notifications

Contributors, architects and owners can comment on elements, relationships, changes, decisions, projects and versions (viewers can read the threads). Reply in the thread, **@mention** a colleague to bring them in, and **resolve** a thread once it's dealt with (it can be reopened). The Elements list and the Changes list show how many unresolved threads each item has.

The **bell** in the top bar holds your notifications: when someone @mentions you, replies in a thread you're in, or assigns you as a reviewer. Turn each kind on or off in your profile.

## History

A **version** is a named, permanent snapshot of the live model at a point in time (e.g. a quarterly baseline) — a tag on that state, not a copy that can drift. On **Versions**, give one a name and an optional note, then press **Tag the live model now** to create it. Open any version read-only with the `[ref]` chip, or **compare two versions** to see what changed between them.

## Settings

- **Organisation settings** (owners): the organisation's name, **members** and their roles, **invite by email**, the **membership audit** log, **custom attributes**, and deleting the organisation.
- **Model settings**: name and description; **archive** a model you've finished with (architects and owners), and **restore** or **delete** an archived one (owners); **share with another organisation** — read-only access to the live model or to one version, never edit access.
- **Your profile** (the **•••** menu at the top right → Profile): your name, **notifications**, and your signed-in **sessions**.

## Licence and source code

Atlas is open source, licensed under the **GNU Affero General Public Licence, version 3 or later (AGPL-3.0-or-later)**. Anyone using Atlas can get the source: **Source code** and **Licence (AGPL-3.0)** are in the **•••** menu at the top right once you are signed in, and on the sign-in page.

## Getting help

Click **Help** (the **?** in the top bar) from any organisation or model page to ask a question. It knows this guide, Atlas's list of words (the vocabulary behind it) and — on a model page — the name of the page you're on and a few counts about the model (capabilities, systems and open changes), so you can ask "what does this page show me?" as well as "how do I start a change?" It can't see your actual data (the names of your systems or capabilities), only that context. If you use an older word ("disposition", "TIME", "main"), it answers in the words the app uses now (**Planned action**, **live model**).
