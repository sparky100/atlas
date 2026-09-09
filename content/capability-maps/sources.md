# Sources consulted for the starter capability maps

Licence for every map in this directory: **CC BY 4.0**
(https://creativecommons.org/licenses/by/4.0/). Attribute as "Atlas
starter capability maps".

## How these maps were made

All eight maps were drafted on 2026-09-07 from general professional
familiarity with the reference models named below. **Nothing in any map is
copied verbatim from any of them**: no level-1 or level-2 name, and no
definition, is reproduced from a source document. The models were
consulted only to check *scope* — that a sector map covers what an
organisation of that kind actually has to be able to do — and for sector
*vocabulary* (the ordinary words practitioners use, e.g. "void",
"flexibility market", "Integration Joint Board"). Where a source is a
process model rather than a capability model (APQC, the functional
standards), it was used for scope coverage only and no process names were
adopted; see the review document's process-shaped-name check.

Each map's own `sources[]` array names the subset relevant to it, with
`reviewedBy` set to "Pending human review — drafted by Claude Code" and
`status: draft`. That is deliberate: a source row is a claim that a named
person checked the map against that reference, and no one has yet. A map
should move to `published` only when a real reviewer's name replaces that
placeholder.

## Reference models consulted

| Model | Used for | Maps |
|---|---|---|
| UK Government Functional Standards (GovS 001–016) | Scope of the eight shared corporate capabilities (Finance, HR, Procurement, Information Management, Customer Contact, Estates, Digital & Technology, Governance & Assurance); the generic public-body shape | all |
| Socitm Local Public Services Business Capability Model | Scope and level-1 shape of the two local-government maps | `local_government_scotland`, `local_government_england` |
| Local Government etc. (Scotland) Act 1994; Public Bodies (Joint Working) (Scotland) Act 2014 | Scottish statutory duties (Integration Joint Boards, Council Tax Reduction, Scottish Welfare Fund) | `local_government_scotland` |
| Care Act 2014; Children Act 1989/2004; Local Government Finance Act 1992 | English statutory duties (adult social care, SEND, Council Tax Support, business rates) | `local_government_england` |
| NHS England enterprise-architecture business capability model | Scope and level-1 shape of the health map | `nhs` |
| Health and Care Act 2022; National Health Service (Scotland) Act 1978 | Board/trust duties, kept neutral between the two systems | `nhs` |
| HACT UK Housing Data Standards | Housing-sector vocabulary | `housing` |
| Regulator of Social Housing consumer and economic standards; Scottish Social Housing Charter | Landlord regulatory duties | `housing` |
| UCISA Higher Education Capability Model | Scope and level-1 shape of the HE map | `hei` |
| Office for Students conditions of registration; Scottish Funding Council outcome agreements | HE regulatory duties | `hei` |
| HM Treasury Green Book | Policy appraisal vocabulary | `public_body` |
| APQC Process Classification Framework | Scope coverage check only — a process model; no process names adopted | `public_body` (as the cross-check for the shared set) |
| Ofgem RIIO price-control framework; Ofwat PR24 methodology | Regulatory reporting and price-control shape for a generic utility | `utility` |
| ISO 55000 | Asset-management vocabulary | `utility` |
| Ofgem RIIO-ED2 framework; the Distribution Code and Grid Code | Electricity regulatory and operational vocabulary | `electricity_network` |
| Energy Networks Association Open Networks project | DSO and flexibility-market vocabulary | `electricity_network` |
| IEC 61970/61968 Common Information Model | Network-asset and operations vocabulary | `electricity_network` |

## Editorial rules applied

- Two levels only: 8–12 level-1 capabilities, 3–6 level-2 under each.
- Every capability has a one-sentence definition of at least eight words.
- Names describe *what the organisation is able to do*, not a process
  (no verb phrases or lifecycle steps) and not an org unit (no teams,
  departments or directorates). Each map was reviewed against that rule
  before being saved; `docs/review/capability-maps.md` re-checks it
  mechanically on every regeneration.
- The eight shared capabilities (codes 1–8) use byte-identical names,
  definitions and level-2 sets in every map — `shared-capabilities.json`
  is the single copy, and `src/contracts/capabilityMaps.content.test.ts`
  fails if any map drifts from it.
- `utility` and `electricity_network` share level-1 wording exactly for
  their four sector capabilities; the electricity map's level-2 entries
  are electricity-specific rather than restatements, except Connections
  and Emergency Response, which are the same capability in both and keep
  the same wording.

## electricity_network v2 (2026-09-09)

Sprint U4-1's own "Electricity map additions" item, done once
`content:export-capability-map` (C6) existed to support the review loop
this addition goes through. Six level-2 items added under the four
sector-specific level-1s (9–12); codes 1–8 and every level-2 item v1
already had are untouched, so nothing seeded from v1 is affected. Found
two ways, both against material already in this directory rather than a
fresh source pass:

- Three (`10.6 Control Room & Real-Time Operations`, `11.5 Billing &
  Settlement`, `11.6 Vulnerable Customer Support`) have a direct
  counterpart in `utility/1.json`'s own level-2 set for the same
  level-1 (`10.1`, `11.2`, `11.3`) that v1's electricity map never
  gave an electricity-specific equivalent to — the same comparison
  method v1's own `sourceDescription` used to justify why its level-2
  entries diverge from `utility`'s at all, run the other way, against
  the one map it has a level-1-wording sibling to.
- One (`9.6 Vegetation Management`) is in neither map: a distinct,
  safety-critical capability for a network with overhead lines that
  general-utility wording (deliberately generic across water, gas and
  electricity) wouldn't be expected to name.

Drafted from the same sources named above for `electricity_network`,
consulted the same way (scope and vocabulary only, nothing copied
verbatim) — no new reference model added. `status: draft`,
`reviewedBy: "Pending human review — drafted by Claude Code"`, same as
every map's own first draft: it stays draft, seedable for review
alongside the published v1, until a named reviewer edits that field and
runs `pnpm content:publish-capability-map electricity_network 2`.
