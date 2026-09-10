/**
 * `true` when this module was invoked directly as a CLI entrypoint
 * (`tsx scripts/whatever.ts ...`), `false` when another module merely
 * `import`s something from it (e.g. `scripts/exportCapabilityMap.ts`
 * importing `regenerateCapabilityMapsReviewDoc` from
 * `scripts/reviewCapabilityMaps.ts`, or a test importing a pure function)
 * — the ESM equivalent of CommonJS's `require.main === module`.
 *
 * Found while verifying Sprint U4-2a item 4: every script in this repo
 * using the hand-rolled version of this check —
 * `import.meta.url === \`file://${process.argv[1].replace(/\\/g, '/')}\``
 * — silently never ran its own `main()` on Windows, because a Windows
 * absolute path's own file URL has three slashes after the scheme
 * (`file:///C:/Users/...`) while that string template only ever produces
 * two (`file://C:/Users/...`) — `pnpm content:review-capability-maps`
 * (among others) built its output once, then silently did nothing on
 * every later run, with no error to notice. `pathToFileURL` is Node's own
 * documented, cross-platform-correct way to build the same URL
 * `import.meta.url` uses, so the two sides of this comparison actually
 * agree on every OS.
 */
import { pathToFileURL } from 'node:url';

export function isCliEntrypoint(importMetaUrl: string): boolean {
  return process.argv[1] !== undefined && importMetaUrl === pathToFileURL(process.argv[1]).href;
}
