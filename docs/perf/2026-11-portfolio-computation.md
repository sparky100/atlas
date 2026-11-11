# Portfolio calculation results

11 November 2026. Delivery plan item P-02.

Portfolio rows now index support and ownership relationships once. Each capability's cost bands are calculated once, and the list of other supporters is built when a row is expanded.

| Systems | Support relationships | Before | After |
|---:|---:|---:|---:|
| 200 | 600 | 25.8 ms | 6.4 ms |
| 2,000 | 6,000 | 1,536.7 ms | 38.2 ms |
| 10,000 | 30,000 | 49,646.1 ms | 186.1 ms |

Both runs used `pnpm exec tsx scripts/benchmarkAudit.ts` on the same Windows workstation with Node 22.12.0. Figures are the median of three runs after one warm-up. The fixture uses three support relationships per system, with no modules or owners. The timed section builds the rows used by the page, reports and exports. Database reads, rendering and opening row details were outside the timed section.

Expanded result values matched the baseline exactly for the 200- and 2,000-system comparisons and a dense fixture with 300 systems sharing one capability. The existing overlap tests and a new regression fixture cover owner choice, fit, supporter ordering and the highest cost band when a platform and its module support the same capability. The Portfolio browser test now checks that the other supporters appear when a row is expanded. End-to-end timings on a representative model remain pending.
