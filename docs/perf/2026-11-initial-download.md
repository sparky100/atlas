# Initial download

11 November 2026. Delivery plan item P-01.

Sign-in and the route guards remain in the startup bundle. The signed-in pages load on navigation. Pointing at or focusing the Elements or Portfolio navigation link starts downloading that page's code. Elements loads the spreadsheet writer when the user exports to XLSX. A failed page download offers a reload.

| Production asset measure | Before | After |
|---|---:|---:|
| Entry JavaScript and its static dependencies, uncompressed | 2,137,803 B | 747,214 B |
| Entry JavaScript and its static dependencies, gzip | 602,700 B | 217,544 B |
| Entry CSS and its static dependencies, gzip | 25,456 B | 4,223 B |

Both builds used `pnpm exec vite build --manifest` on Windows with Node 22.12.0. The baseline was main at `825f734`. The totals follow the Vite manifest's static imports and gzip each asset individually. They estimate startup download size. Server compression and caching will affect actual transfer.

From the optimized entry alone, the additional gzipped JavaScript was 3.0 kB for Home, 62.5 kB for Model Home, 69.1 kB for Elements and 48.4 kB for Portfolio. Those figures include each page's static dependencies. They overlap because the pages share code. The spreadsheet exporter and its dependencies account for up to 97.1 kB more and can already be cached by another spreadsheet action.

Chrome checks on the production build at 1280 and 390 pixels exercised sign-in with simulated responses, a protected deep link and recovery from a failed page download. Full app navigation and download tests and representative browser timings remain pending.
