# Sector catalogue content — editorial handoff

Status: draft research, 21 November 2026. These files are not approved, loaded, or published.

The 16 new sector files contain 114 selected entries. The existing electricity-network catalogue remains at version 1, pinned to capability map version 4, with 19 entries and has not been edited here. Across all 17 files there are 133 entries. This is a broad starting selection, not an exhaustive market survey or a product recommendation.

Each new entry links to an official supplier or product-owner source checked on 21 November 2026. Its source date records the check date; most web pages do not give a reliable publication date. The one functional claim paraphrases what that source says. Vendor statements are **vendor evidence**, not independent proof of suitability, UK deployment, accessibility, procurement compliance, integration, security, or current support terms. A named editor must inspect the page and the capability mapping before approval.

Automated retrieval succeeded for 97 of 98 distinct new-source URLs on this date. The Ex Libris Alma page denied the fetcher, although the product-owner page appears in current search results. Verify it manually before signing that claim. The original ENSEK Ignition link failed; the draft now cites ENSEK's current Energy Orchestration Platform page.

| Sector | Map version | New entries | Main-area coverage |
| --- | ---: | ---: | --- |
| Any Organisation | 2 | 6 | 4 of 4 |
| Financial Services | 1 | 7 | 5 of 5 |
| Fire and Rescue | 1 | 6 | 5 of 5 |
| Higher Education | 2 | 7 | 4 of 4 |
| Housing | 2 | 9 | 4 of 4 |
| Local Government, England | 2 | 7 | 4 of 4 |
| Local Government, Scotland | 2 | 6 | 3 of 4 |
| Manufacturing | 1 | 7 | 5 of 5 |
| NHS | 2 | 7 | 4 of 4 |
| Police | 1 | 8 | 6 of 6 |
| Public Body | 2 | 6 | 3 of 3 |
| Rail Transport | 1 | 8 | 5 of 5 |
| Retail and E-commerce | 1 | 7 | 5 of 5 |
| Retail Energy | 1 | 9 | 8 of 8 |
| Utility | 3 | 7 | 5 of 5 |
| Water and Wastewater | 1 | 7 | 5 of 5 |

“Main area” means a sector-specific level-1 capability (normally codes 9 onward) with at least one linked entry. It does not mean all child capabilities are covered. Scottish education is deliberately absent: SEEMiS is still the national MIS, but Scotland has begun procurement to replace it. Add a current, properly caveated entry only after checking its status and fit with a Scottish education reviewer. The existing electricity-network draft does not cover its regulatory area; revisit that catalogue separately without changing Simon's prior review attribution.

The new draft claims use `reviewedBy: "Pending review"` as a deliberate publication-blocking marker because the current contract requires a reviewer and date even in drafts. **No person has signed these claims.** The `reviewedAt` value in these files is the draft research date, not a human review date. Replace both fields with an actual named editorial reviewer and actual review date only after review. The publication review script must fail until that happens. Most pinned map files are themselves draft in the repository; check their status in the live database before publication.

## Later data-design refactor

The same product is repeated across sectors. That is tolerable for this first editorial pass, but it can drift when a vendor renames or withdraws a product. Design a canonical product identity with sector-specific capability links and evidence, then migrate additively while preserving immutable published versions and saved option snapshots. Keep sector-specific fit distinct; do not imply that a product supporting one sector's capability automatically supports another's.

This is now implemented by `20261122120000_catalogue_admin.sql` and
`docs/ADR-038-product-catalogue-admin.md`: `/platform-admin` has one product
library and per-sector catalogue publications. Existing published snapshots
and saved citations are unchanged. New versions should be published from that
editor so the canonical product library stays authoritative.

The draft review fields also deserve a separate correction: drafts should permit an explicit unreviewed state without a fabricated review timestamp. Do not weaken the named-human publication gate. The no-money regex currently blocks legitimate product abbreviations such as “CAD” and capability names containing “Pricing”; a future contract change should distinguish sensitive values from ordinary names without exposing organisation money data.
