import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { AttributeDefinitionKind } from '../../../contracts/attributeSchema';
import { attributeDefinitionToFieldSchema } from '../../../contracts/attributeSchema';
import type { ElementType, UUID } from '../../../contracts/delta';
import { ELEMENT_TYPE_FILTER_OPTIONS, FINDING_FILTER_OPTIONS, type BrowseRow } from '../../../db/elementBrowse';
import type { AttributeDefinitionRow, BranchRow } from '../../../db/types';
import type { ThreadCount } from '../../comments/useThreadCounts';
import { attributesRecord, formatCustomAttributeValue } from '../../elements/attributesRecord';
import { moduleDisplayName } from '../../elements/moduleDisplayName';
import type { DraftValue } from '../../elements/useElementEditor';
import { RelationshipAdd } from '../RelationshipGroup/RelationshipAdd';
import { AttributeValueInput } from '../AttributeValueInput/AttributeValueInput';
import { Button } from '../Button/Button';
import { Chip } from '../Chip/Chip';
import { EmptyState } from '../EmptyState/EmptyState';
import { ElementTypeGlyph } from '../ElementTypeGlyph/ElementTypeGlyph';
import { Text } from '../Text/Text';
import { criticalityToneFor } from '../../elements/criticalityTone';
import { useElementExport } from '../../elements/useElementExport';
import { sortKeyEquals, type ElementBrowseSortKey, type ElementBrowseState } from '../../elements/useElementBrowse';
import { useIsNarrowViewport } from '../../landscape/useIsNarrowViewport';
import { ElementBrowseCards } from './ElementBrowseCards';
import styles from './ElementBrowseTable.module.css';

/** Same breakpoint every other "table/canvas → mobile list" swap in this app uses (`LandscapePage.tsx`/`ContextPage.tsx`/`ValueStreamsPage.tsx`, all `useIsNarrowViewport(768)`) — one convention, not a bespoke value per view. */
const MOBILE_BREAKPOINT_PX = 768;

/**
 * Sprint U4-1 B3: "the browse table filtered to unlinked systems with the
 * supports picker inline per row." Only ever passed when `?filter=
 * unlinked-systems` is active and the viewer can edit main (ElementsPage.tsx's
 * own gate, `canEditOnMain` — the same role floor every other main write
 * uses, ADR-015) — omitted entirely otherwise, same convention as
 * `CapabilityMapView`'s `reorderCapability`.
 */
export interface ElementBrowseLinkSupportsConfig {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  /** Called after a row's own picker successfully creates its `supports` edge — the caller's job to reload both the branch (a new head_commit_id) and this table's own rows (so the just-linked system drops out of the filter). */
  onLinked: () => void;
}

/** F1 ("custom attributes") PR4: which definition the picker has selected (`key`, or `null` for "no custom attribute") and, once chosen, the raw string value typed/picked to filter by (`null` means "shown but not yet filtering" — see this file's own `CustomAttributePicker` comment). Raw strings, not `Json`/`DraftValue`: this is exactly what round-trips through the URL (`ElementsPage.tsx`'s `?customAttr=`/`?customValue=`), which owns the actual parsing. */
export interface ElementBrowseCustomAttrSelection {
  key: string | null;
  value: string | null;
}

export interface ElementBrowseTableProps {
  state: ElementBrowseState;
  orgSlug: string;
  modelSlug: string;
  /** F8: the export loader reads facts/relationships/sources against this model — the one id the browse state doesn't already carry. */
  modelId: UUID;
  /** F8: the export filename's base fragment (the model name). */
  filenameBase: string;
  // `| undefined` explicitly, not just `?:` — exactOptionalPropertyTypes
  // treats "optional" and "may be undefined" as different things (same
  // convention `Text.tsx`'s own `className` prop documents).
  linkSupportsInline?: ElementBrowseLinkSupportsConfig | undefined;
  /** M1 close-out item 4: "unresolved counts on the browse table rows" — the caller's own `useThreadCounts` result, keyed by `element_id`. A row absent from the map (or `open === 0`) shows no badge at all; this is a count, not the hollow/ink marker distinction the landscape/capability map draw (a table row already reads as text, nothing there for a marker to compete with). */
  unresolvedCounts?: ReadonlyMap<UUID, ThreadCount> | undefined;
  /** F1 PR4: this org's own definitions — narrowed below to the ones applying to the current type filter, non-deprecated (the picker's own options). */
  attributeDefinitions: readonly AttributeDefinitionRow[];
  customAttr: ElementBrowseCustomAttrSelection;
  onCustomAttrChange: (next: ElementBrowseCustomAttrSelection) => void;
  /** The named `?filter=` finding, surfaced as a pickable dropdown (`FINDING_FILTER_OPTIONS` above) instead of only a deep link — `''` for none. Mutually exclusive with `customAttr` (the caller, `ElementsPage.tsx`, clears one whenever the other is set). */
  findingFilter: string;
  onFindingFilterChange: (next: string) => void;
  /**
   * Per-item-actions prompt: "each row [in a decision-shaped finding's
   * filtered list] carries its own pre-filled Start a decision" — the same
   * "one more filter-gated action column" shape `linkSupportsInline` above
   * already established (a new `<th>`/`<td>` pair, rendered only when this
   * is present). `ElementsPage.tsx` builds it from whichever `?filter=` is
   * active, since that's what decides which `decisionPrefill.ts` builder
   * (and therefore which element shape — system or capability) applies to
   * every row in this particular table. `null` for a row this filter's own
   * action doesn't apply to (never expected in practice — a decision-
   * shaped filter's own rows are already narrowed to the right element
   * type — but typed to allow it rather than assuming).
   */
  decisionRowAction?: ((row: BrowseRow) => ReactNode | null) | undefined;
  /** F2-lite: renders "Import…" beside Export when present, omitted (same presence-gates-visibility convention as `linkSupportsInline`) for a viewer who can't edit main. Owns opening the dialog itself — this table only renders the button. */
  onImportClick?: (() => void) | undefined;
}

// A narrower key type than `ElementBrowseSortKey` — this fixed column list
// never includes the `{ custom }` variant (that's the one dynamic column,
// added separately below), and `key={column.key}` needs a valid React key,
// which an object isn't.
const COLUMNS: { key: 'name' | 'type' | 'owner' | 'lifecycle' | 'criticality'; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'type', label: 'Type' },
  { key: 'owner', label: 'Owner' },
  { key: 'lifecycle', label: 'Lifecycle' },
  { key: 'criticality', label: 'Criticality' },
];

function customAttrValueToDraft(kind: AttributeDefinitionKind, raw: string | null): DraftValue {
  if (kind === 'boolean') return raw === 'true';
  return raw ?? '';
}

/** `null` (not an empty string) means "no filter value yet" — an empty text/number/date/link/select draft clears the filter while leaving the attribute selected (still shown as its own column), matching `AttributeValueInput`'s own "empty means not filled in" convention. */
function draftToCustomAttrValue(kind: AttributeDefinitionKind, draft: DraftValue): string | null {
  if (kind === 'boolean') return String(draft);
  const trimmed = typeof draft === 'string' ? draft.trim() : '';
  return trimmed === '' ? null : trimmed;
}

/**
 * F1 PR4's own facet picker (decision 6): a `<select>` of this org's own
 * non-deprecated definitions applying to the current type filter, plus —
 * once one is chosen — a kind-aware value input (`AttributeValueInput`,
 * reused verbatim, same as the element page's own edit form) that live-
 * updates the URL as it changes, same instant-filter feel `state.setQuery`
 * already has. Selecting a definition alone (before any value is typed)
 * doesn't filter anything yet — it only makes the attribute's own column
 * appear, sortable like any other column.
 */
function CustomAttributePicker({
  definitions,
  selection,
  onChange,
}: {
  definitions: readonly AttributeDefinitionRow[];
  selection: ElementBrowseCustomAttrSelection;
  onChange: (next: ElementBrowseCustomAttrSelection) => void;
}) {
  const selectedDefinition = selection.key ? definitions.find((d) => d.key === selection.key) : undefined;
  const valueInputId = useId();
  return (
    <>
      <select
        className={styles.select}
        aria-label="Custom attribute"
        value={selection.key ?? ''}
        onChange={(e) => {
          const key = e.target.value === '' ? null : e.target.value;
          onChange({ key, value: null });
        }}
      >
        <option value="">Custom attribute…</option>
        {definitions.map((definition) => (
          <option key={definition.id} value={definition.key}>
            {definition.label}
          </option>
        ))}
      </select>
      {selectedDefinition && (
        // A real `<label>`, same as `AttributeEditRow`'s own — without one,
        // `AttributeValueInput`'s `id` has nothing pointing `for` at it.
        <label htmlFor={valueInputId}>
          <Text as="span" size="sm">
            {selectedDefinition.label}
          </Text>
          <AttributeValueInput
            id={valueInputId}
            field={attributeDefinitionToFieldSchema(selectedDefinition)}
            value={customAttrValueToDraft(selectedDefinition.kind, selection.value)}
            onChange={(draft) => {
              onChange({ key: selectedDefinition.key, value: draftToCustomAttrValue(selectedDefinition.kind, draft) });
            }}
            invalid={false}
          />
        </label>
      )}
    </>
  );
}

/**
 * A system's own "+ Add supports" (RelationshipsSection.tsx's own control,
 * reused verbatim), pre-wired for exactly this table's row shape: every row
 * it's rendered on is by definition a system with zero existing `supports`
 * edges (that's the `unlinked-systems` filter itself), so `existingRows: []`
 * and `relationshipFacts: new Map()` are always correct here — B4's
 * "primary?" prompt only fires once a system already has one, which by
 * construction none of these do yet (the very-first-link path, always
 * `role: 'secondary'`, exactly matches what a from-scratch link should be).
 */
/** Exported for `ElementBrowseCards.tsx`'s own identical mobile call site — same picker, same pre-wired assumptions, never a second implementation. */
export function InlineSupportsPicker({ system, config, searchCommitId }: { system: { elementId: UUID; name: string }; config: ElementBrowseLinkSupportsConfig; searchCommitId: UUID }) {
  return (
    <RelationshipAdd
      slot={{ relationshipType: 'supports', targetTypes: ['capability'] }}
      direction="outbound"
      elementId={system.elementId}
      elementType="system"
      elementName={system.name}
      existingRows={[]}
      relationshipFacts={new Map()}
      modelId={config.modelId}
      orgId={config.orgId}
      userId={config.userId}
      searchCommitId={searchCommitId}
      branch={config.branch}
      expectedHeadCommitId={config.expectedHeadCommitId}
      onCreated={config.onLinked}
    />
  );
}

/** Sprint U3b: "filterable, sortable table of elements by type with owner and lifecycle." A real `<table>` — semantic tabular data, not a design-system gap (native `<table>`/`<th>`/`<td>` is the correct element here, the same way `<ul>`/`<li>` already is for plain lists elsewhere in this app). */
export function ElementBrowseTable({ state, orgSlug, modelSlug, modelId, filenameBase, linkSupportsInline, unresolvedCounts, attributeDefinitions, customAttr, onCustomAttrChange, findingFilter, onFindingFilterChange, decisionRowAction, onImportClick }: ElementBrowseTableProps) {
  // Called unconditionally (Rules of Hooks) — `commitId`/`rows` are only real
  // once `state.status === 'ready'`, and the export loader refuses to run on
  // the null/empty fallbacks until then.
  const exportState = useElementExport({ modelId, commitId: state.status === 'ready' ? state.commitId : null, definitions: attributeDefinitions, rows: state.status === 'ready' ? state.rows : [], filenameBase });

  // Below the breakpoint, `ElementBrowseCards` replaces the two-table
  // sticky-header block entirely, rather than trying to make one render
  // work at every width (`ElementBrowseCards.tsx`'s own module comment) —
  // same swap-the-whole-renderer shape `LandscapePage.tsx`/`ContextPage.tsx`
  // already use for their own canvas/table-vs-mobile-list split.
  const narrow = useIsNarrowViewport(MOBILE_BREAKPOINT_PX);

  // Sprint U4-1 findings item 5's own follow-up: the column header lives in
  // its own small table (`.headerClip`, ElementBrowseTable.module.css),
  // physically outside `.tableWrap` — the only way to make it stick to the
  // viewport while `.tableWrap` still scrolls the body horizontally on its
  // own (see that CSS file's own comment on why the two can't be one
  // table's `<thead>`/`<tbody>` and still both work). Both tables now
  // share one `<colgroup>` (that CSS file's own comment on why the body
  // table needs it too, not just the header) — this borrows the body
  // table's own real, content-driven column widths (there's no body row
  // here to auto-size the header table's own `table-layout: fixed`
  // against) from every currently-rendered body row's own cells (not just
  // the first — see the loop below), and re-measures whenever the row
  // set, custom column, or optional columns change — anything that could
  // change a column's natural width. `useLayoutEffect`, not `useEffect`:
  // the measure-and-set-state round trip has to land before the browser
  // paints, or the header would visibly snap widths on first render.
  //
  // Bug fix: a body column's own content can be narrower than its header
  // label ever is — every visible row's Owner cell reads as a bare "—"
  // (`FactBadge`-less unset marker) far more often than not, so the body's
  // own natural width for that column can end up narrower than the word
  // "Owner" itself. `.table th`'s `white-space: nowrap` (module CSS) then
  // has nowhere to put the overflow but visually on top of the next
  // header cell — exactly the "Owner"/"Lifecycle" overlap this was found
  // against. Each column's width is now the *larger* of the body's own
  // measured width and the header cell's own natural content width
  // (`scrollWidth`, not `getBoundingClientRect().width` — the header th's
  // rendered box is exactly the too-narrow value causing the bug, so its
  // own bounding rect can't be used as "how wide this label needs to be";
  // `scrollWidth` reports the unclipped content size regardless of how
  // narrow the box around it currently is).
  const headerIdBase = useId();
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const headerClipRef = useRef<HTMLDivElement>(null);
  const headerRowRef = useRef<HTMLTableRowElement>(null);
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);
  const [colWidths, setColWidths] = useState<number[] | null>(null);

  useLayoutEffect(() => {
    const tbody = tbodyRef.current;
    if (!tbody) {
      setColWidths(null);
      return;
    }
    const measure = () => {
      const headerRow = headerRowRef.current;
      // Measures each `<th>`'s own inner wrapper (its sort button, or the
      // plain `<span>` wrapping a non-sortable label like "Comments"), never
      // the `<th>` itself — a `<th>` already carrying a previous render's
      // `<col>` width can never report a *smaller* scrollWidth than that
      // width once applied, so measuring the cell directly creates a one-
      // way ratchet: an inflated width can never shrink back down on a
      // later render. Found live: the *first* render measures before any
      // `<colgroup>` exists at all, and `table-layout: fixed` with no
      // column hints divides the table's width equally across every column
      // — that already-wrong equal split is what starts the ratchet, and
      // every later render just measures its own previous mistake back.
      // The inner button/span is a shrink-wrapped inline element that
      // always reports its own true natural content width, regardless of
      // how wide its ancestor `<th>`/`<col>` currently is.
      const headerWidths = headerRow ? Array.from(headerRow.children).map((cell) => {
        const inner = cell.querySelector('button, span') ?? cell;
        // Add the `<th>`'s own horizontal padding back in — `inner` is
        // deliberately measured without it (that's what keeps the
        // measurement immune to the ratchet above), but the column itself
        // still needs room for it, or adjacent header labels render flush
        // against each other with no gap.
        const cellStyle = getComputedStyle(cell);
        return inner.scrollWidth + parseFloat(cellStyle.paddingLeft) + parseFloat(cellStyle.paddingRight);
      }) : [];
      // Every rendered row's own cell width, not just the first row's —
      // found live: Type/Owner/Lifecycle/Criticality all come from a
      // small, bounded vocabulary (short status words), so one row's
      // width used to stand in fine for the whole column, but Name is
      // open-ended user text with wildly varying length row to row.
      // Sizing the Name column from whichever name happened to be first
      // left every longer name further down the table overflowing
      // visually into the Type column next to it (no wrap, no clip —
      // `white-space: nowrap` with nothing catching the overflow). No
      // virtualization exists on this table (`state.rows.map(...)`
      // already renders every row), so every row is already in the DOM
      // being painted — reading their bounding rects here adds no new
      // DOM-scale exposure, just cheap reads over what's already there.
      //
      // `cell.scrollWidth`, not `getBoundingClientRect().width` — found
      // live: once `table-layout: fixed` is in effect (true from the very
      // first render, colgroup or not — the CSS spec has it size every
      // row's column from the *first* row alone when there's no colgroup
      // yet), every row in a column is already forced to the *same*
      // rendered box width, regardless of that row's own actual content.
      // `getBoundingClientRect()` on row 3's Name cell was reporting row
      // 0's own width back, every time — never row 3's real one.
      // `scrollWidth` is driven by the cell's own content alone (constant
      // per row, since `white-space: nowrap` means it never wraps to
      // begin with), so it reports each row's true natural width
      // regardless of what its column is currently constrained to.
      const colWidthsNext: number[] = [];
      for (const bodyRow of tbody.rows) {
        Array.from(bodyRow.children).forEach((cell, i) => {
          const width = Math.max(cell.scrollWidth, headerWidths[i] ?? 0);
          colWidthsNext[i] = Math.max(colWidthsNext[i] ?? 0, width);
        });
      }
      setColWidths(colWidthsNext);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(tbody);
    return () => {
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-measures on anything that could change a rendered cell's natural width (including the header's own sort-arrow toggling); `tbodyRef.current`/`headerRowRef.current` themselves aren't valid deps.
  }, [state.status === 'ready' ? state.rows : null, customAttr, linkSupportsInline, decisionRowAction, state.status === 'ready' ? state.sortKey : null, state.status === 'ready' ? state.sortDirection : null]);

  function syncHeaderScroll() {
    if (headerClipRef.current && tableWrapRef.current) {
      headerClipRef.current.scrollLeft = tableWrapRef.current.scrollLeft;
    }
  }

  if (state.status === 'loading') return <Text tone="muted">Loading…</Text>;
  if (state.status === 'error') return <Text as="p">{state.message}</Text>;
  if (state.status === 'refNotFound') return <Text as="p">Nothing here yet.</Text>;

  const elementHref = (elementId: string) => `/o/${orgSlug}/m/${modelSlug}/e/${elementId}`;
  // F1 PR4: this table's own picker options — non-deprecated, and applying
  // to whichever type the type filter currently shows (every definition
  // when it's "All types").
  const applicableCustomDefinitions = attributeDefinitions.filter(
    (d) => d.deprecated_at === null && (state.typeFilter === 'all' || d.applies_to.includes(state.typeFilter)),
  );
  const selectedCustomDefinition = customAttr.key ? applicableCustomDefinitions.find((d) => d.key === customAttr.key) : undefined;

  // Shared between the header table and the body table — both need the
  // *same* explicit widths, or a column whose header label needs more room
  // than the body's own actual content (e.g. "Owner" over a column of bare
  // "—"s) widens correctly in one table but silently not in the other,
  // desyncing their column boundaries column by column. `headerTableStyle`'s own
  // width (the colgroup's own sum) matters only for the header table —
  // `.tableWrap`'s real scrollbar already gives the body table room to be
  // this wide without it, but the header table has no scrollbar of its own
  // (`.headerClip`'s `overflow-x: hidden` only ever gets scrolled
  // programmatically, in sync with `.tableWrap`) and would otherwise be
  // squeezed to fit `width: 100%` of its clip container.
  const colgroupEl = colWidths && (
    <colgroup>
      {colWidths.map((width, i) => (
        // Column position, not identity, is what this keys — the set of
        // columns only ever changes by length (a conditional column
        // appearing/disappearing), never reorders, so an index key is safe
        // here.
        <col key={`col-${String(i)}`} style={{ width: `${String(width)}px` }} />
      ))}
    </colgroup>
  );
  const headerTableStyle = colWidths ? { width: colWidths.reduce((sum, width) => sum + width, 0) } : undefined;

  return (
    <div>
      <div className={styles.toolbar}>
        <input
          type="text"
          className={styles.search}
          placeholder="Search by name or owner…"
          value={state.query}
          onChange={(e) => { state.setQuery(e.target.value); }}
        />
        <select
          className={styles.select}
          aria-label="Element type"
          value={state.typeFilter}
          onChange={(e) => { state.setTypeFilter(e.target.value as ElementType | 'all'); }}
        >
          {ELEMENT_TYPE_FILTER_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option === 'all' ? 'All types' : option}
            </option>
          ))}
        </select>
        <select
          className={styles.select}
          aria-label="Finding"
          value={findingFilter}
          onChange={(e) => { onFindingFilterChange(e.target.value); }}
        >
          {FINDING_FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <CustomAttributePicker definitions={applicableCustomDefinitions} selection={customAttr} onChange={onCustomAttrChange} />
        {narrow && (
          // Cards have no clickable column headers to sort by (the desktop
          // table's own affordance) — without this, mobile would silently
          // lose sorting entirely rather than just losing the table shape.
          // `setSort` toggles direction on a re-pick of the *same* key
          // (`useElementBrowse.ts`'s own `sortKeyEquals` check), the same
          // behaviour clicking an already-sorted header column gives — the
          // direction button below reuses that by calling it with the
          // current key unchanged.
          <>
            <select
              className={styles.select}
              aria-label="Sort by"
              value={typeof state.sortKey === 'object' ? `custom:${state.sortKey.custom}` : state.sortKey}
              onChange={(e) => {
                const next = e.target.value;
                state.setSort(next.startsWith('custom:') ? { custom: next.slice('custom:'.length) } : (next as ElementBrowseSortKey));
              }}
            >
              {COLUMNS.map((column) => (
                <option key={column.key} value={column.key}>
                  {column.label}
                </option>
              ))}
              {selectedCustomDefinition && <option value={`custom:${selectedCustomDefinition.key}`}>{selectedCustomDefinition.label}</option>}
            </select>
            <Button variant="secondary" aria-label={`Sort direction: ${state.sortDirection === 'asc' ? 'ascending' : 'descending'}`} onClick={() => { state.setSort(state.sortKey); }}>
              {state.sortDirection === 'asc' ? '▲' : '▼'}
            </Button>
          </>
        )}
        <Button
          variant="secondary"
          disabled={state.rows.length === 0 || exportState.status === 'working'}
          onClick={() => {
            void exportState.exportCsv();
          }}
        >
          Export CSV
        </Button>
        <Button
          variant="secondary"
          disabled={state.rows.length === 0 || exportState.status === 'working'}
          onClick={() => {
            void exportState.exportXlsx();
          }}
        >
          Export XLSX
        </Button>
        {onImportClick && (
          <Button variant="secondary" onClick={onImportClick}>
            Import…
          </Button>
        )}
      </div>
      {exportState.error !== null && <Text as="p">{exportState.error}</Text>}

      {state.rows.length === 0 ? (
        <EmptyState>No elements match this filter.</EmptyState>
      ) : narrow ? (
        <ElementBrowseCards
          rows={state.rows}
          elementHref={elementHref}
          unresolvedCounts={unresolvedCounts}
          selectedCustomDefinition={selectedCustomDefinition}
          linkSupportsInline={linkSupportsInline}
          decisionRowAction={decisionRowAction}
          commitId={state.commitId}
        />
      ) : (
        <>
          <div className={styles.headerClip} ref={headerClipRef}>
            <table className={styles.table} style={headerTableStyle}>
              {colgroupEl}
              <thead>
                <tr ref={headerRowRef}>
                  {COLUMNS.map((column) => (
                    <th key={column.key} id={`${headerIdBase}-${column.key}`}>
                      <button type="button" className={styles.sortButton} onClick={() => { state.setSort(column.key); }}>
                        {column.label}
                        {sortKeyEquals(state.sortKey, column.key) && (state.sortDirection === 'asc' ? ' ▲' : ' ▼')}
                      </button>
                    </th>
                  ))}
                  {selectedCustomDefinition && (
                    <th id={`${headerIdBase}-custom`}>
                      <button type="button" className={styles.sortButton} onClick={() => { state.setSort({ custom: selectedCustomDefinition.key }); }}>
                        {selectedCustomDefinition.label}
                        {sortKeyEquals(state.sortKey, { custom: selectedCustomDefinition.key }) && (state.sortDirection === 'asc' ? ' ▲' : ' ▼')}
                      </button>
                    </th>
                  )}
                  <th id={`${headerIdBase}-comments`}>
                    <span>Comments</span>
                  </th>
                  {linkSupportsInline && (
                    <th id={`${headerIdBase}-link`}>
                      <span>Link to a capability</span>
                    </th>
                  )}
                  {decisionRowAction && (
                    <th id={`${headerIdBase}-decision`}>
                      <span>Decision</span>
                    </th>
                  )}
                </tr>
              </thead>
            </table>
          </div>
          <div className={styles.tableWrap} ref={tableWrapRef} onScroll={syncHeaderScroll}>
            <table className={styles.table}>
              {colgroupEl}
              <tbody ref={tbodyRef}>
                {state.rows.map((row) => {
                  const unresolvedCount = unresolvedCounts?.get(row.element.element_id)?.open ?? 0;
                  return (
                  <tr key={row.element.element_id}>
                    <td headers={`${headerIdBase}-name`}>
                      <Link to={elementHref(row.element.element_id)} className={styles.nameCell}>
                        <ElementTypeGlyph type={row.element.element_type} />
                        <Text as="span">{moduleDisplayName(row.element, row.parent)}</Text>
                      </Link>
                    </td>
                    <td headers={`${headerIdBase}-type`}>
                      <Text as="span" tone="muted" size="sm">
                        {row.element.element_type}
                      </Text>
                    </td>
                    <td headers={`${headerIdBase}-owner`}>
                      {row.owner ? (
                        <Link to={elementHref(row.owner.element_id)}>
                          <Text as="span" size="sm">
                            {row.owner.name}
                          </Text>
                        </Link>
                      ) : (
                        <Text as="span" tone="faint" size="sm">
                          —
                        </Text>
                      )}
                    </td>
                    <td headers={`${headerIdBase}-lifecycle`}>
                      {row.lifecycleStatus ? (
                        <Text as="span" size="sm">
                          {row.lifecycleStatus}
                        </Text>
                      ) : (
                        <Text as="span" tone="faint" size="sm">
                          —
                        </Text>
                      )}
                    </td>
                    <td headers={`${headerIdBase}-criticality`}>
                      {row.criticality ? (
                        <Chip tone={criticalityToneFor(row.criticality) ?? 'neutral'}>{row.criticality}</Chip>
                      ) : (
                        <Text as="span" tone="faint" size="sm">
                          —
                        </Text>
                      )}
                    </td>
                    {selectedCustomDefinition && (
                      <td headers={`${headerIdBase}-custom`}>
                        {(() => {
                          const formatted = formatCustomAttributeValue(attributesRecord(row.element.attributes)[selectedCustomDefinition.key]);
                          return formatted === '' ? (
                            <Text as="span" tone="faint" size="sm">
                              —
                            </Text>
                          ) : (
                            <Text as="span" size="sm">
                              {formatted}
                            </Text>
                          );
                        })()}
                      </td>
                    )}
                    <td headers={`${headerIdBase}-comments`}>
                      {unresolvedCount > 0 ? (
                        <Text as="span" size="sm" className={styles.unresolvedBadge}>
                          💬 {unresolvedCount}
                        </Text>
                      ) : (
                        <Text as="span" tone="faint" size="sm">
                          —
                        </Text>
                      )}
                    </td>
                    {linkSupportsInline && (
                      <td headers={`${headerIdBase}-link`}>
                        {row.element.element_type === 'system' && (
                          <InlineSupportsPicker system={{ elementId: row.element.element_id, name: row.element.name }} config={linkSupportsInline} searchCommitId={state.commitId} />
                        )}
                      </td>
                    )}
                    {decisionRowAction && <td headers={`${headerIdBase}-decision`}>{decisionRowAction(row)}</td>}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
