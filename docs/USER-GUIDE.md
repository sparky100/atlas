# Atlas User Guide

**Status:** reviewed against the app on 2026-10-17, with the first-10-minutes section added 2026-11-10 (after F13 view exports and the project pack, cancelling and editing decisions, the Home split, capture review, and integration interfaces). Written for the in-app AI help chat to ground its answers in — if something here doesn't match what you see, the app is right and this guide needs correcting.

This is the guide the in-app **Help** assistant reads to answer your questions. It isn't reference documentation for developers (that's `docs/ADR-000-foundations.md` and `docs/SPEC-data-model.md`); it's written for the people who use Atlas: architects who maintain the model, and the senior people who read it.

---

## Your first 10 minutes

**Where do I start?** It depends on your role.

- **Viewer:** you land on the capability map. Click a capability to see the systems that support it, then open a system to see its details. Use the search box at the top to find anything by name.
- **Contributor:** look around the capability map and landscape first. To change something, start a change from **Work → Changes**; it is reviewed before it reaches the live model.
- **Architect:** open Home and read **Where to focus**. Each row is a problem and links straight to it, with **Start a decision** or **Start a project** on the same row.
- **Owner:** as an architect, plus **Invite a colleague** in organisation settings.

**A new, empty model.** Home shows a **Get started** checklist: import your capabilities, add a system, link it to the capability it supports, and (owners only) invite a colleague.

**A model that already has data.** Home shows a **Welcome** card with a few places to start, worded for your role. **Dismiss** hides it in that browser.

**Stuck?** Click the **Help** button at the top and ask. You can also choose a different start page for yourself.

## What Atlas is

Atlas is an enterprise-architecture tool for organisations with one or two architects — councils, NHS boards, housing associations, universities — sized for teams currently getting by on Sparx, Visio or spreadsheets. Two kinds of people use it:

- **An architect**, who lives in it: capturing systems and relationships, reviewing AI-assisted imports, proposing and merging changes, recording decisions.
- **A senior reader** — a director or other stakeholder — who opens it a few times a quarter and should never need training to answer "what supports capability X, and what's changing about it?"

These are ways of using Atlas, not settings: what someone can do depends only on their role (below). Who **owns** a system or capability — its business, technical or service owner — is something recorded in the model against that element, whatever that person's job title.

The core ideas:

- **Every fact shows why you should believe it.** Each value carries where it came from (a spreadsheet, an interview, someone's manual entry), how confident that source is, and how old it is.
- **Every diagram is a live view of the model, never something hand-drawn.** There's no canvas that stores its own boxes and arrows; what you see is always the model, laid out automatically.
- **Nothing is overwritten.** Every edit is recorded in the element's history, so you can always see what it said before and who changed it.

## Signing in, organisations and roles

The first time you sign in, Atlas asks how you want to start:

- **Just me** — a personal workspace for working alone.
- **My organisation** — a named organisation you can invite colleagues into.

You can belong to more than one organisation; "Your organisations" lists them. Inside an organisation, one or more **models** hold your architecture — most organisations start with one.

Everyone in an organisation has one role:

| Role | Can |
|---|---|
| **Viewer** | See everything. Can't change the model, comment, or see the review queue. |
| **Contributor** | Everything a viewer can, plus comment, start changes and edit inside them, submit them for review, run a capture, start decisions and projects, rate decision options and add what a decision concerns, and edit or cancel decisions they started or own. Can't edit main directly. |
| **Architect** | Everything a contributor can, plus edit main directly, approve and merge changes, choose a decision's option, edit or cancel any proposed decision, create and archive models. |
| **Owner** | Everything an architect can, plus organisation settings, members and invites, custom attributes, restoring or deleting archived models. |

## The building blocks

Atlas models these kinds of thing:

- **Capability** — something the organisation does (a business function), independent of any system. Capabilities nest inside each other (e.g. *Customer service › Contact › Complaints*); the capability map shows three levels.
- **System** — a named piece of software or a service. A system has a **kind**: application, integration platform, data platform, infrastructure, or **platform**.
- **Container** — something inside a system. Inside a **platform** (a large system such as an ERP), a container is a **module** — "Finance" inside "SAP", say. A module can set its own lifecycle, criticality, hosting, domain, run cost and disposition; where it leaves one unset it reads its platform's (except disposition, which is never inherited).
- **Interface** — a container inside an **integration platform** (MuleSoft, say) is an **interface**: an API, file drop, event topic, batch job, database feed or OT gateway the platform exposes or consumes. An interface records its **interface type** and, optionally, its **transformation** — what the platform does to the data (maps, enriches, combines, turns a file into an API). To add one, open the integration platform's page and use **+ Add interface** in its **Interfaces** section: name, type and transformation in one step.
- **Actor** — a person, team or organisation that owns or uses things. Actors can be internal or external.
- **Value stream** — how the organisation delivers an outcome, as a sequence of stages.

Anything can be marked **external** (owned by someone else) rather than being a different type of element.

Elements connect through **relationships**, which you record yourself:

- **supports** — a system or module supports a capability. One of a system's supports links can be **primary** (it decides which lane the system sits in on the landscape). A supports link carries a **fit** rating: excellent, good, adequate or poor.
- **owns** — an actor owns a capability, system or module, as its **business**, **technical** or **service** owner.
- **uses** and **flows to** — between systems and modules (and actors using systems), optionally with a verb and a data classification. A flow can go **via** an integration platform, or via one of its interfaces, and then records the protocol on each side — **protocol in** (source → platform) and **protocol out** (platform → target), e.g. file over SFTP in, REST API out. Several flows via the same interface is how reuse and combining show: the interface's page lists every flow via it, and the platform's context diagram groups its flows by interface. Health findings flag an integration platform, or an interface, that nothing flows via.
- **replaces** — one system or module replaces another (recorded when you retire something with a replacement).
- **enables** — a capability enables a value-stream stage.

Systems carry attributes such as lifecycle (planned, active, retiring, retired), criticality, run cost, planned action, hosting model and provider, IT/OT domain, AI agent (how it acts: suggests only, acts with approval, or acts alone; a system with this filled in shows a small **AI** tag on its page, the landscape, context diagrams and the integrations list), vendor, version, introduced, planned end and vendor support end. Owners can add **custom attributes** for their organisation (Organisation settings).

## Finding your way around

Every model page shares the same navigation, in four groups:

| Group | Pages |
|---|---|
| **Model** | Home, Capability map, Landscape, Value streams, Elements |
| **Analyse** | Portfolio, Roadmap, Reports, Ask Atlas |
| **Work** | Projects, Changes, Decisions, Import (the **Work** heading opens a page explaining the three and offering **Start something**) |
| **Record** | History |

On a phone, the bar at the bottom shows Home, Capabilities, Landscape and Changes; everything else is under **More**. Two items show a number of open items: **Changes** — changes still open (draft, proposed, in review or approved) — and **Decisions** — decisions still proposed. Projects has no number. On a phone, a dot on **More** means Decisions has a number inside it.

**Search anywhere.** Press **Ctrl K** (**⌘K** on a Mac), or use **Search** at the top of the navigation (inside **More** on a phone), to find an element, a change or a decision by name and jump straight to it. A module is found by its platform and name together as well as by its own name — "SAP PM" and "SAP · PM" both find it. The search box on Home works the same way for elements, and is also where you create new ones — it checks for an existing element with that name first.

**Zooming in.** Atlas is one continuous zoom through four levels: **capability map** (all your capabilities) → **landscape** (systems grouped by the capability they support) → **system context** (one system and its neighbours) → **containers** (inside one system).

**The breadcrumb** at the top of a page shows where you are: `Org › Model › [ref] › …`. The `[ref]` chip says which state of the model you're looking at — `main`, a version like `v2026-Q1`, or a change like `Change: Housing CRM replacement`. Click it to switch.

**Every page has a URL.** You can bookmark or share a link to any element, change, decision, project or version, and it opens straight to it.

## Home

Home has two views; switch with **Overview** / **My work** at the top. They do different jobs: **Overview** is a briefing on the state of the business — what's weak and what's changing — and **My work** is a worklist for the people who maintain the model — what's waiting, what's part-done, and what's missing or wrong in the model. Anyone can use either — it changes what Home shows, never what you're allowed to do — and Atlas remembers your choice. Until you pick one, Owners and Architects start on My work and everyone else on Overview.

- **Overview** reads top to bottom: **Where to focus** (only the capabilities with a problem — a system at end of life, no system recorded, or a supporter rated a poor or adequate fit; healthy capabilities are on the capability map, not here. Each problem is one row: the system or capability as a link, what is wrong with it, and — only when nothing is in hand — its own "Start a decision" and "Start a project". If a project or decision is already about it, the tile says **Being handled by** and links to it, otherwise *No project or decision yet*), **What we're doing** — the projects in hand (owner, target date, progress, and any decision overdue) and the open decisions that belong to no project — and **What's recent**: the decisions made and projects closed since the newest version, then the versions themselves. Individual changes don't appear here: a project's changes show as its progress, and a correction or a record of something that already happened is housekeeping, not news. Its only create controls are **Start a project** and **Start a decision**; to start a change, use **Changes** (its form also records something that's already happened) or **Propose a change** on an element page.
- **My work** starts with a row of counts — the review queue, findings needing attention, assurance items, your own open changes, and duplicates flagged — then the review queue, **Health findings** and **Assurance**. Beside them: **My decisions** (open decisions you own, overdue first, each naming its project), **My projects** (projects you're accountable for, with their progress), your own open changes, and recent activity. Each finding names what it found and links to it; many offer **Start a decision →** or **Start a project →** pre-filled from the finding. When nothing is wrong, each group collapses to "N checks clear". Each view links to the other rather than repeating it: capabilities with nothing supporting them, or a supporter rated a poor or adequate fit, show on Overview only, and Overview points to My work for missing owners, links, labels and stale values.

**Your start page.** Opening a model from the model list takes you to your start page: the capability map for viewers and contributors, Home for owners and architects. Pick another (Home, Capability map or Landscape) under **Profile → Start page**, or press **Make this my start page** on any of those three pages. The choice follows you across organisations. On a phone, the **Search** button in the header searches elements, changes, decisions and projects from any page.

**Get started.** A model with no capabilities, no systems or no system-to-capability links shows a **Get started** checklist on Home (for people who can add to the model). Owners also get an **Invite a colleague** step, which ticks once an invite has been sent. A model that already has data shows a **Welcome** card instead. Each step ticks itself from the model's real contents and links to the screen that does it; **Dismiss** hides it in that browser.

Health findings include: systems not linked to a capability, capabilities with no owner, stale values, critical systems with no business owner or nearing end of life, critical systems near the end of vendor support, relationships missing a verb or a data classification across the IT/OT or enterprise boundary, and systems planned to move or switch off that nothing is retiring.

## Element pages

Open any element to see its **attributes**, **relationships**, **structure** (modules, or value-stream stages), the **changes touching it**, its **documents**, its **history**, its **decisions** and **comments**.

- Each value has a small **provenance badge**: where it came from, its confidence (dots) and its age — anything over 12 months old shows in the warning colour. Hover or tap for the full source.
- **✎ Edit** changes its attributes; **+ Add …** under each relationship group adds a link.
- **✓ Still accurate** confirms that everything on it is still right — see below.
- To **rename** an element, click its name (a pencil appears beside it). The **⋯ menu** holds **Start a decision…** and **Start a project…**, then **Mark as retired…** (a planned end date, and optionally what replaces it — its capabilities move to the replacement), **Merge a duplicate into…** (when two elements are really the same thing; the old name stays findable by search), **Make this a module of…** (move a system inside a platform), and **Remove from model…** last.

- **Documents** lists the documents behind an element — a design, a business case, a contract — as a name plus where it lives. Atlas never stores the document itself. Each entry is either a web link (Confluence, SharePoint and so on, which opens in a new tab) or a plain note of where to find it, such as "SharePoint › Business cases". Owners and architects use **+ Add a document**, **Edit** and **Remove**; everyone else can read them, and can leave a comment to ask for one to be added. Document changes save straight away and don't appear in History.

What you can do depends on your role and on whether you're looking at main or a change (see below). On main, a contributor sees **Propose a change** instead of Edit.

## The Elements page

**Elements** lists everything in the model. Search by name or owner, filter by type, planned action or a custom attribute, tick **AI agents only**, or pick a **Finding** to see just the elements a health finding flagged. Sort by any column (a **How it acts** column appears when any listed system is an AI agent), and **Export CSV** or **Export XLSX**. The workbook carries each element's **Atlas ID** and its parent (a module's system, a capability's parent capability) and lists every relationship, so it can be brought back in through **Capture**: modules keep their platform and systems keep their capability links.

- **Edit in grid** turns the Lifecycle, Criticality and Planned action cells (and a custom attribute's column, when one is shown) into editable controls. **Save N changes** records them all as one edit — on main, or in the change you're working in. While editing, each row also has **✓ Still accurate**.
- **Import…** (architects and owners) takes you to Import.

## Bringing data in: capture

Rather than typing your landscape in by hand, you can feed Atlas source material and review what it proposes:

1. Open **Import** and upload a spreadsheet (CSV or XLSX), a JSON file or a PDF, or paste in free text — meeting notes, an email, anything describing systems, owners or relationships.
2. Atlas reads it (using AI for documents and text), matches what it finds against your model, and produces a **capture draft**: proposed elements, relationships and values, each with a confidence and a note on where in the source it came from. Spreadsheet columns such as "Criticality", "TIME" or "Disposition" are recognised.
3. Review the draft — from Import, or the **Waiting for review** tab of Changes. Accept, reject, edit, split or merge each proposal; the keyboard works too (**j**/**k** to move, **a** accept, **r** reject, **e** edit, **x** to select several). Choose a **target change**, then **Apply decisions** to write the accepted facts into it. On a phone, tick **Select** on rows (or **Select all** on a group) and use **Accept selected** / **Reject selected**. If you rejected everything, there's nothing to apply: the button becomes **Finish review**, which closes the draft without creating a change. To throw a draft away without reviewing it, use **Discard this draft…** on the review page, or **Discard** in the review queue; if the same file was captured several times, the queue offers **Discard N older copies** to keep just the newest.

Nothing reaches your model without this review, and it always lands in a change you then submit like any other.

**Connecting a tool instead of uploading a file.** Owners can link Atlas to MuleSoft Anypoint once, in **Organisation settings → Connections** (the page explains each step, including what to create in Anypoint). After that, on **Import → MuleSoft Anypoint**, **Fetch from MuleSoft** replaces the export script and the upload. You still review everything before it changes your model, and the file route still works. The client secret is saved encrypted and never shown again; owners set the connection up and remove it, architects can test it. See `docs/import/mulesoft/connector.md`.

## Changes

Editing directly on **main** is for architects and owners making small, uncontroversial edits. Everything else happens in a **change**: a named, isolated set of edits you can review before it reaches main.

Every change says **why** it exists:

- **Record** — something already happened (with a delivered date).
- **Propose** — something is planned (with a target date).
- **Correct** — the record was wrong.
- **Explore** — a candidate future, created as an option inside a decision.

**Working in a change.** Create one from **Changes** (or **Propose a change** on an element page), then use **Edit in this change** in the banner at the top of the page: every edit you make while it shows **Editing in this change** goes into the change, not main. The change page shows what it touches.

**Standard changes (no AI).** Under **New change**, choose **Add a new system**, **Retire a system** or **Change details of a system**. Atlas starts the change and opens the right screen on it: the add box, the Retire panel (replaced by an existing system, a new one, or nothing, with the planned end date) or the system's edit form.

**Draft with AI.** If Ask Atlas is enabled for your organisation, open Changes and pick a common change under **New change** (Add an integration, Add a system to a capability), or choose **Describe your own**. For a common change, pick the systems and capabilities involved from your model and edit the wording if you like. From a system on main, choose **Draft with AI** to describe a change to that system. If the setting is off, Changes says so and tells owners where to switch it on. Review the suggested system and relationship edits, check their source passages, then select **Apply to draft Change**. Open the draft to review its impact, add a target date and submit it for review. For a phased move, record any removals or retirement separately in the draft once you know their scope.

**Getting it merged.**

- **Record** and **Correct** changes need one architect or owner: **Approve & merge** on the change page.
- **Propose** and **Explore** changes go through review: **Submit for review**, pick the reviewers, and they appear in the **Waiting for review** tab of Changes, and in a **Waiting for review** section at the top of the Changes list (drafts stay in the intent groups below it). Reviewers **Approve**, **Request changes** or **Abstain**; once the required reviewers approve, an architect or owner **Merges**.
- If main moved on meanwhile, the review page shows any conflicts and lets you resolve them and **Push refresh** before merging.
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

- **Start a project** from the Projects page, from a health finding or weak capability ("Start a project →"), or from an element's ⋯ menu. Give it a title, its purpose, an owner, optional start and target dates, and the capabilities and systems it's about (its **declared scope**).
- **Its decision log** lists the decisions that are part of the project. Start one from the project page, or move a proposed decision in with **Add to project…** (or **Move…**, if it's already in another project) on its page — its draft options move with it. Decisions made elsewhere that constrain the project are listed separately as **constraining decisions**; linking one isn't possible from the app yet. Decisions don't have to belong to a project.
- **Its changes** are its design deliverables, shown by stage: options being explored, the chosen design, in review, merged. Start one from the project page, or use **Add to project…** on any open change.
- **Scope against what it touches.** The page compares the declared scope with what the project's changes actually touch, and lists any difference — it never changes either for you.
- **Evidence** — business cases, vendor documents and links — can be attached.
- **On hold, close or cancel.** Close or cancel only once nothing in the project is still open; the page lists anything that is. Cancelling asks why. A closed or cancelled project can't be reopened.
- **Project pack.** **Project pack (Markdown)** and **Project pack (PDF)** download the project as one document to hand over: its purpose, scope (and any gap with what the changes touch), the decision log — each decision written up as an ADR, the same as **Copy as ADR markdown** on the decision's page — the target state each change sets out (what it creates, changes and retires, and the capabilities it affects), and the evidence links. Any member can download it. It's a copy as of the moment you download it. The PDF uses a standard font; characters it can't show (for example non-Latin scripts) appear as "?" there, while the Markdown keeps them as written.

A project is part of how your team works, not part of the model itself: it never appears on the capability map or landscape, and it isn't in a version.

## Views

- **Capability map** — every capability, in its hierarchy. **Colour by** coverage, oldest lifecycle stage, lifecycle exposure, criticality, OT share, fit, disposition or **Agent share** (how many of the systems supporting it are AI agents, and the freest way any of them acts; each of the others is the worst among the systems supporting it). If the model is empty, you can **start from a capability map** — a ready-made set for your sector. Owners can also **Export as starter map** (in the map's ⋯ actions), saving this model's capabilities as a draft starter map for seeding other models.
- **Landscape** — systems in lanes by the capability they mainly support, with OT systems in their own zone. Colour by criticality, hosting model or IT/OT domain. Zoom into a system for its **context**, and into a platform for its **modules**. **Find on this landscape** (above the diagram) takes part of a name: choosing a match focuses that tile, with its connections, and centres it — on a phone it opens the group and highlights the row. In a change's **Diff** view, a **context** diagram marks what the change adds (+), removes (−, dashed) and changes (~) on its connections and tiles, with a legend; everything unchanged is dimmed. A platform's own **context** draws each flow as source → platform → target, numbered on both sides so a line leaving the platform can be matched to the one that entered it; hover a source or target to pick out its flows. The change's list of edits names a module as "Platform · Module", like everywhere else. Opened from a capability (its supporting-system count on the capability map), it lists just the systems supporting that capability, with **Export CSV** and **Export XLSX**.
- **Value streams** — how the organisation delivers its outcomes, stage by stage, and which capabilities enable each stage (weak supporting systems show up the stream). Value-stream structure is edited on main, or in a **Correct** change.
- **Roadmap** — systems' lifecycles over time (introduced, planned end, support end) and changes' target dates, **by capability**, **by value stream** or **by project**, in months, quarters or years, with filters, **Export table** (CSV) and **Export PNG**.
- **Portfolio** — every system and module with run cost against fit, criticality, disposition, lifecycle and capabilities served, sortable and filterable, with **signals** where the combination matters (for example *Costly, poor fit*, *Costly overlap*, *Invest, poor fit*, *Justified*) and a note when a row is missing the inputs to judge it.

**Export PNG** and **Export PDF** on the capability map and the landscape download a picture of the view as you see it, with the current colour-by. Portfolio is a table, so it offers **Export Excel** (a spreadsheet of the rows with Portfolio's filters and sort applied, plus an About sheet with the stamp) and **Export PDF** instead of a PNG. Every picture is stamped with the model, which state you are looking at (main, a version, or a change by name) and the date. Any member can export. The landscape picture shows systems in their lanes but not the connections between them, and says so. A picture is a copy, not part of the model: it doesn't update when the model changes.

## Reports and gaps

**Reports** (Analyse) lists the standing checks, each with its current count:

- **Boundary crossings** — links across the IT/OT boundary.
- **External interfaces** — links that cross the enterprise boundary without a data classification, and external organisations with access to your systems.
- **Duplicates** — elements that look like the same thing recorded twice. **Check now** runs a fresh check; merge a pair, or dismiss it as not a duplicate.
- **Gaps** — the systems missing a fit rating, an owner, a run cost, a criticality or a disposition. **Fill in** walks them one at a time: press a number to pick an answer and move on, **j** to skip, **k** to go back. Each answer is saved as you go.

### Saved reports, copies and dashboards

On **Elements** and **Portfolio**, **Save as report…** keeps the page's current search, filters and sort under a name. Tick **Share with the organisation** (owners and architects) to let everyone see it; otherwise it is private to you. Pick a saved report from **Saved reports** on either page to bring that view back. A report is live: it always shows main as it is now.

- **Reports → your report** shows the result, with **Download CSV**, **Download Excel**, **Export PNG** and **Export PDF** (the picture is stamped with the model, the state and the date).
- **Edit report settings…** (on the report's own page, for whoever may edit it) chooses how it is shown: **Table**, **Count only**, **Bar chart** or **Donut**, grouped by a field (lifecycle, criticality, owner, a custom attribute and so on) and optionally **split by** a second field for a stacked bar. A table can show only its first few rows. The same panel edits the description and, for owners and architects, sharing. A report only becomes a chart once it has a grouping, so this is how a dashboard gets bar, donut and stacked-bar tiles.
- To change which rows a report includes, open it from **Saved reports** on Elements or Portfolio, adjust the filters, and choose **Save changes to "…"**. Its chart settings are kept.
- **Click a bar, a donut slice or a stacked segment** (on a report or a dashboard) to see just the rows behind it. A strip says what you are looking at; **Show the whole report** goes back. Nothing is saved by doing this.
- **Save a copy now** keeps a frozen record of the result as at that moment. It never changes, even when the report or the model does, and opens under **Saved copies**. The person who made a copy can delete it (an owner or architect can delete a shared one) after a confirmation; deleting cannot be undone.
- **Add standard dashboards…** (on the Reports page) adds ready-made dashboards to the model: **Application portfolio overview** (applications, missing owners and dispositions, lifecycle, criticality, critical applications) and **Rationalisation (TIME)** (disposition, fit by run cost, eliminate and migrate candidates, costly applications that fit poorly), and **AI agents** (how many there are, how many act alone, how they act, and an **AI agent inventory** table with each agent's owner and the capabilities it supports). "How it acts" is also a field in any report. Each comes with its saved reports, shared with the organisation when an owner or architect adds it, otherwise private. They are ordinary reports and dashboards: change or delete them as you like.
- **New dashboard…** (on the Reports page) shows several saved reports together, live. **Edit dashboard** adds a tile from a saved report (as a big number, bar chart, stacked bar chart, donut or table; one column, two or full width), changes a tile's chart type or how many rows a table tile shows, reorders, resizes and removes tiles. A big-number tile shows what share of the model it is. Hover over a donut or a stacked bar's legend to pick out one value. A dashboard shared with the organisation can only use shared reports.
- **Present** fills the screen with the dashboard and no editing controls; **Esc** or **Exit presenting** goes back. **Export PNG** and **Export PDF** download the dashboard as a picture.

A report that uses a health-finding filter cannot be saved yet; the page says so.

## Ask Atlas

**Analyse → Ask Atlas** (or press Ctrl-K and type "ask") lets you ask a question about the model in plain words, such as "Which systems are critical?".

- It is **off until an organisation owner switches it on**, in organisation settings under Ask Atlas. While it is on, your questions and the names, descriptions, attributes and relationships of the elements needed to answer them are sent to our AI provider. Comments and unreviewed imports are not sent.
- It can only read. It cannot change anything. It can answer about elements and how they connect, saved reports, data-quality findings, portfolio signals, and the changes, decisions and projects recorded for the model (summaries only; comments and unreviewed imports are not read).
- Every element it names is a link to that element's page. An answer that names no element is marked **Ungrounded**, and a reference it could not verify is removed and flagged. Open **What was looked up** under an answer to see each lookup and how many results it found.
- Answers come from the live estate (main) only. Long lists are cut short, and the answer says so.
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

A **version** is a named, permanent snapshot of main at a point in time (e.g. a quarterly baseline) — a tag on that state, not a copy that can drift. On **Versions**, give one a name and an optional note to create it. Open any version read-only with the `[ref]` chip, or **compare two versions** to see what changed between them.

## Settings

- **Organisation settings** (owners): the organisation's name, **members** and their roles, **invite by email**, the **membership audit** log, **custom attributes**, and deleting the organisation.
- **Model settings**: name and description; **archive** a model you've finished with (architects and owners), and **restore** or **delete** an archived one (owners); **share with another organisation** — read-only access to main or to one version, never edit access.
- **Your profile** (the **•••** menu at the top right → Profile): your name, **notifications**, and your signed-in **sessions**.

## Getting help

Click **Help** (the **?** in the top bar) from any organisation or model page to ask a question. It knows this guide and — on a model page — which page you're on and a few counts about the model, so you can ask "what does this page show me?" as well as "how do I start a change?" It can't see your actual data (the names of your systems or capabilities), only that context.
