# Atlas vocabulary

**Status:** the one place Atlas's words are defined (2026-11-17). The user guide, the Help assistant, Ask Atlas, the MCP server's guide and the import template are written from this file and use these words exactly. If a word here is wrong, fix it here first, then everywhere that uses it. `src/ui/help/vocabulary.test.ts` checks the names below against the code, so a renamed option or finding cannot slip past unnoticed.

Plain English, no engine words. Where the stored name differs from what people see, the stored name is shown once, in brackets, and only because spreadsheets, files and tools use it.

## What the model holds

| Word | Means |
|---|---|
| **Capability** | Something the organisation does, whatever supports it. Capabilities nest. |
| **System** | A named piece of software or service. Its **kind** is Application, Integration platform, Data platform, Infrastructure or Platform. |
| **Module** | Something inside a **Platform** (a module of an ERP, say). It can set its own values; where it leaves one unset it reads its platform's, except planned action. |
| **Interface** | A module of an **Integration platform**: an API, file drop, event topic, batch job, database feed or OT gateway. |
| **Actor** | A person, team or organisation. Internal or external. |
| **Value stream** | How the organisation delivers an outcome, as stages. |

There is no element for data, services, processes, goals or projects. A **project**, **decision**, **change** and **principle** are records kept beside the model, not parts of it.

## Relationship types

Each reads as a short phrase from one element to another. There are six.

| Type | Read as | Between |
|---|---|---|
| **uses** | "A relies on B" (from B's side: **used by**). Says nothing about data moving. | system or module to system or module; person, team or organisation to system or module |
| **flows to** | "A sends data to B" (from B's side: **receives from**). Can go **via** an integration platform or one of its interfaces, with a **protocol in** and **protocol out**. | system or module to system or module, never from a person or team |
| **supports** | A system or module supports a capability, with a **fit** rating. One link per system can be **primary**. | system or module to capability |
| **owns** | A person, team or organisation owns something as its **business**, **technical** or **service** owner. Nothing to do with someone's organisation role. | actor to capability, system or module |
| **replaces** | One system or module replaces another. | system or module to system or module |
| **enables** | A capability enables a value-stream stage. | capability to stage |

**Which one, uses or flows to?** If the question is "does A need B?", record **uses**. If it is "does data travel from A to B?", record **flows to**. When both are true, record both. The same pair can have one of each.

Import and spreadsheets carry two of these as relationships (uses, flows to). Supports arrives through the **Capability** column, owns through the **owner** columns, and replaces by retiring a system with a replacement. Enables is edited in the app.

## Values on a system

| Word | Means | Choices (stored name if different) |
|---|---|---|
| **Lifecycle** | Where it is in its life. | Planned, Active, Retiring, Retired |
| **Criticality** | How much the business depends on it. | Critical, High, Medium, Low |
| **Run cost** | A **band**, never a figure, so it is never added up. | None / included, Under £50k, £50k–£250k, £250k–£1m, £1m–£5m, Over £5m |
| **Fit** | How well a system serves one capability. | Excellent, Good, Adequate, Poor |
| **Planned action** | What we intend to do with it. Also called **TIME**; the stored name is **disposition**. | Keep as is (tolerate), Invest (invest), Move to another system (migrate), Switch off (eliminate). Unset reads **Not assessed**. |
| **AI agent: how it acts** | Set only for an AI agent. | Suggests only, Acts with approval, Acts alone |
| **Uses AI** | For a system that uses AI but is not an agent. | Built-in AI features, Uses an AI model or service |
| **IT/OT domain**, **Hosting model**, **Vendor**, **Introduced**, **Planned end**, **Vendor support ends** | As named. | |

**Planned, active and retired.** A system or module is **planned** until its **Introduced** date, **active** from then, and **retired** from its **Planned end** date. Views of today show only what is active. A link counts only when both ends are active. Planned and retired items still show on their own page and in Elements, tagged **Planned · from <date>** or **Retired · to <date>**.

**Key facts "N of M recorded".** A plain count of how many key facts are recorded on a system, never a score.

## Work records

| Word | Means |
|---|---|
| **Live model** | The current agreed model. Never called "main" to people. |
| **Change** | A separate set of edits reviewed before it reaches the live model. Why it exists: **Record**, **Propose**, **Correct** or **Explore**. |
| **Version** | A named, permanent snapshot of the live model. |
| **Decision** | An architectural choice with context, options and reasons. Proposed, accepted, cancelled or superseded. |
| **Project** | One piece of architecture work, with its decisions and changes. Active, on hold, closed or cancelled. |
| **Principle** | A short rule decisions are checked against. Active or retired. |

## Roles

**Viewer**, **Contributor**, **Architect**, **Owner**: what you may do. An element's **owner** (business, technical or service) is a recorded fact about the element, not a role.

## Health findings

Home's checks, in the words the app uses:

- Systems not linked to a capability
- Platform supports that could move to a module
- Capabilities with no owner
- Items not checked recently
- Systems with no technical owner
- AI agents that act alone with no technical owner
- Critical systems with no business owner
- Critical systems exposed with no replacement
- Unused integration platforms
- Unused integration interfaces
- Essential systems with no technical owner
- Critical systems past or near support end
- Capabilities with no supporters
- Planned to move or switch off, nothing retiring it

## Where things are

- **Model:** Home, Capability map, Landscape, Value streams, Elements
- **Analyse:** Portfolio, Roadmap, Reports, Ask Atlas
- **Work:** Projects, Changes, Decisions, Principles, Import
- **Record:** History

(Goals and a Direction menu are being added by a separate piece of work. When they merge, this list and the Principles entry move with them.)
