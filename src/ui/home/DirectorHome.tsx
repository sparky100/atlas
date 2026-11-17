import { HomeViewLink } from './HomeViewLink';
import { useState } from 'react';
import { Link } from 'react-router';
import { BlueprintFrame } from '../components/BlueprintFrame/BlueprintFrame';
import { Button } from '../components/Button/Button';
import { LinkButton } from '../components/Button/LinkButton';
import { domainCoverageSummary } from '../capabilityMap/domainSummary';
import { Chip } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import type { UUID } from '../../contracts/delta';
import type { MemberRole } from '../../db/types';
import { formatDate } from '../time';
import { CapabilityMapImportPanel } from '../capabilityMap/CapabilityMapImportPanel';
import { attributesRecord } from '../elements/attributesRecord';
import { decisionPrefillToSearchParams, prefillFromCapabilityNoSupportersFinding, prefillFromWeakFitCapabilities, prefillFromSystemAtEndOfLife } from '../decisions/decisionPrefill';
import { StartDecisionLink } from '../decisions/StartDecisionLink';
import { GoalsWithoutCapabilityNote } from '../goals/GoalsWithoutCapabilityNote';
import { PrincipleDeparturesNote } from '../principles/PrincipleDeparturesNote';
import { importanceLabel } from './capabilityImportance';
import { compareWeakTiles, formatWeakFitPillLabel, isCapabilityTileWeak, tileSeverity, weakFitPillTone } from './capabilityTileFit';
import { ValueStreamsOutcomeView } from '../valueStreams/ValueStreamsOutcomeView';
import { canStartDecision } from '../orgs/useMembership';
import { canStartProject } from '../orgs/roleGates';
import { StartProjectLink } from '../projects/StartProjectLink';
import type { CapabilityTileData } from '../../db/modelHome';
import type { DirectorHomeData } from './useDirectorHome';
import type { OpenDecisionSummary, ProjectSummary, RecentRecord } from './whatWeAreDoing';
import { isNothingInHand, type TileInHand } from './tileInHand';
import { formatProjectProgress, projectStatusLabel, projectStatusTone } from '../projects/projectModel';
import styles from './DirectorHome.module.css';

export interface DirectorHomeProps {
  data: DirectorHomeData;
  reload: () => void;
  modelId: UUID;
  userId: UUID | null;
  /** Gates the door's only create controls — "Start a project" / "Start a decision" ("What we're doing") and each weak tile's own actions — the same way every other entry point to them is gated. */
  role: MemberRole | null;
  orgSlug: string;
  modelSlug: string;
  /** The director door's own already-resolved main head commit id — passed straight to `ValueStreamsOutcomeView` (the "By outcome" reading) the same way `useDirectorHome` already uses it. */
  mainCommitIdHint: UUID | null;
  /** Switches Home to My work — UI-principles §3's one-home-per-finding rule: model-quality findings live on My work, so this door links across to them rather than repeating them. */
  onShowMyWork: () => void;
}

/**
 * The director's door (UI-principles §3.1, built to Handoff 7d —
 * `docs/HANDOFF-7d-director-door.md`, revised by UI-principles §3 on
 * 2026-10-04): one vertical read — weakness first, then what we're doing
 * about it (projects in hand and open decisions, never raw changes), then
 * what's recent. No branch selector and no inline edit; its only create
 * controls start a project or a decision (the search box lives in
 * `ModelHome`'s shared title row, common to
 * both doors — see this component's own module comment in the handoff
 * doc for the one place this build simplified the literal layout: the
 * title/search chrome stays the existing shared header rather than a
 * director-only redesign of it, to avoid touching the architect door).
 */
export function DirectorHome({ data, reload, modelId, userId, role, orgSlug, modelSlug, mainCommitIdHint, onShowMyWork }: DirectorHomeProps) {
  const capabilityMapHref = `/o/${orgSlug}/m/${modelSlug}/capability-map`;
  // F6 Step 6 (ADR-023 "Views" item 2): the director door's own "By
  // capability / By outcome" toggle — plain unpersisted component state
  // (the "route via platforms" precedent), not a `user_preferences` column.
  const [weaknessView, setWeaknessView] = useState<'capability' | 'outcome'>('capability');
  const modelHref = `/o/${orgSlug}/m/${modelSlug}`;
  const { whatWeAreDoing } = data;
  const openDecisionCount = whatWeAreDoing.decisionsOutsideProjects.length + whatWeAreDoing.projects.reduce((n, p) => n + p.progress.openDecisions, 0);

  if (data.tiles.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyTiles} aria-hidden="true">
          <span className={styles.emptyTile} />
          <span className={styles.emptyTile} />
          <span className={styles.emptyTile} />
          <span className={styles.emptyTile} />
        </div>
        <Text as="h2" size="xl">
          The map is empty
        </Text>
        <Text as="p" tone="muted">
          Exposure, changes, and versions all read off the capability map — there's nothing to show until it has at least one capability.
        </Text>
        <CapabilityMapImportPanel modelId={modelId} userId={userId} onImported={reload} />
      </div>
    );
  }

  // F6.1 ("make capability fit-for-purpose visible to directors"): a tile
  // is weak when its exposure tone says so *or* it has a poor-fit
  // capability — a display rule only (`isCapabilityTileWeak`'s own doc
  // comment); fit itself never becomes part of `tone` (ADR-023).
  // Ordering only (the task's own rule): importance high → low, unset
  // last, then fit/exposure severity, then name — `compareWeakTiles`'s
  // own doc comment (`capabilityTileFit.ts`). Healthy capabilities are not listed here at all —
  // the capability map shows every capability; this list is only the
  // ones a director is actually deciding what to do about.
  const weakTiles = data.tiles.filter((t) => isCapabilityTileWeak(t)).sort(compareWeakTiles);

  return (
    <div className={styles.door}>
      <section aria-label="Where to focus">
        <div className={styles.sectionHeader}>
          <Text as="h2" size="xl" className={styles.sectionTitle}>
            Where to focus
          </Text>
          <Link to={capabilityMapHref} className={styles.sectionLink}>
            <Text as="span" size="sm">
              Open capability map →
            </Text>
          </Link>
        </div>
        {/* UI-principles §3: model-quality findings are My work's to show, not repeated here. */}
        <HomeViewLink onClick={onShowMyWork}>Missing owners, links, labels and stale values are on My work →</HomeViewLink>
        <div className={styles.viewToggle} role="group" aria-label="Weakness view">
          <Button variant={weaknessView === 'capability' ? 'primary' : 'ghost'} onClick={() => { setWeaknessView('capability'); }} aria-pressed={weaknessView === 'capability'}>
            By capability
          </Button>
          <Button variant={weaknessView === 'outcome' ? 'primary' : 'ghost'} onClick={() => { setWeaknessView('outcome'); }} aria-pressed={weaknessView === 'outcome'}>
            By value stream
          </Button>
        </div>
        {weaknessView === 'capability' && (
          <>
            {/* Visual pass item 4: these are the first thing a director should
                read, so they get the same big-number/muted-label stat
                treatment ArchitectHome.tsx's own Review queue count already
                uses — a Chip communicates state at a glance, not "read me
                first". Colour still carries the tone (green/plain when 0). */}
            <div className={styles.statsRow}>
              <div className={styles.stat}>
                <Text as="span" size="2xl" className={data.exposedCount > 0 ? styles.statWarn : undefined}>
                  {data.exposedCount}
                </Text>{' '}
                <Text as="span" tone="muted" size="sm">
                  {data.exposedCount === 1 ? 'capability depends' : 'capabilities depend'} on a system at end of life
                </Text>
              </div>
              <div className={styles.stat}>
                <Text as="span" size="2xl" className={data.unrecordedCount > 0 ? styles.statNeutral : undefined}>
                  {data.unrecordedCount}
                </Text>{' '}
                <Text as="span" tone="muted" size="sm">
                  with no system recorded
                </Text>
              </div>
            </div>

            {weakTiles.length === 0 && (
              <Text as="p" tone="muted" size="sm">
                No capability needs attention. The capability map shows all of them.
              </Text>
            )}
            <div className={styles.tileGrid}>
              {weakTiles.map((tile) => (
                <CapabilityTile key={tile.capability.element_id} tile={tile} orgSlug={orgSlug} modelSlug={modelSlug} emphasised role={role} inHand={data.inHandByTile.get(tile.capability.element_id) ?? NO_IN_HAND} />
              ))}
            </div>
          </>
        )}
        {weaknessView === 'outcome' && (
          <ValueStreamsOutcomeView modelId={modelId} orgSlug={orgSlug} modelSlug={modelSlug} mainCommitIdHint={mainCommitIdHint} />
        )}
      </section>

      <div className={styles.lowerRow}>
        <section className={styles.changesColumn} aria-label="Work in progress">
          <div className={styles.sectionHeader}>
            <Text as="h2" size="xl" className={styles.sectionTitle}>
              Work in progress
            </Text>
            <Text as="span" tone="muted" size="sm">
              {plural(whatWeAreDoing.projects.length, 'project', 'projects')} in hand · {plural(openDecisionCount, 'open decision', 'open decisions')}
            </Text>
            {/* UI-principles §3 (2026-10-04): how a director starts work —
                a project or a decision. Starting a change is My work's and
                the Changes page's, not a briefing's. */}
            {canStartProject(role) && (
              <LinkButton variant="ghost" to={`${modelHref}/projects`}>
                Start a project
              </LinkButton>
            )}
            {canStartDecision(role) && (
              <LinkButton variant="ghost" to={`${modelHref}/decisions`}>
                Start a decision
              </LinkButton>
            )}
          </div>
          <GoalsWithoutCapabilityNote modelId={modelId} goalsHref={`${modelHref}/goals`} />
          <PrincipleDeparturesNote modelId={modelId} principlesHref={`${modelHref}/principles`} />
          {whatWeAreDoing.projects.length === 0 && whatWeAreDoing.decisionsOutsideProjects.length === 0 ? (
            <EmptyState>No projects or open decisions right now.</EmptyState>
          ) : (
            <>
              {whatWeAreDoing.projects.length > 0 && (
                <ul className={styles.workList} aria-label="Projects in hand">
                  {whatWeAreDoing.projects.map((summary) => (
                    <ProjectWorkRow key={summary.project.id} summary={summary} modelHref={modelHref} />
                  ))}
                </ul>
              )}
              {whatWeAreDoing.decisionsOutsideProjects.length > 0 && (
                <>
                  <Text as="h3" size="lg" className={styles.subsectionTitle}>
                    Decisions outside a project
                  </Text>
                  <ul className={styles.workList} aria-label="Decisions outside a project">
                    {whatWeAreDoing.decisionsOutsideProjects.map((summary) => (
                      <DecisionWorkRow key={summary.decision.id} summary={summary} modelHref={modelHref} />
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </section>

        <section className={styles.versionsColumn} aria-label="What's recent">
          <Text as="h2" size="xl" className={styles.sectionTitle}>
            What's recent
          </Text>
          {/* UI-principles §3 (2026-10-04, step 4): what's moved since the
              last version — decisions made, projects closed — before the
              version stamps themselves. */}
          <Text as="h3" size="lg" className={styles.subsectionTitle}>
            {data.recentSince ? `Since ${data.recentSince.name}` : 'Decided and closed'}
          </Text>
          {data.recentRecords.length === 0 ? (
            <EmptyState>{data.recentSince ? `No decisions made or projects closed since ${data.recentSince.name}.` : 'No decisions made or projects closed yet.'}</EmptyState>
          ) : (
            <ul className={styles.workList} aria-label="Decided and closed">
              {data.recentRecords.slice(0, RECENT_SHOWN).map((record) => (
                <li key={`${record.kind}-${record.id}`} className={styles.workRow}>
                  <Link to={`${modelHref}/${record.kind === 'decision' ? 'decisions' : 'projects'}/${record.id}`}>
                    <Text as="span">{record.title}</Text>
                  </Link>
                  <Text as="p" tone="muted" size="sm">
                    {RECENT_OUTCOME_LABEL[record.outcome]} {formatDate(record.at)}
                  </Text>
                </li>
              ))}
              {data.recentRecords.length > RECENT_SHOWN && (
                <li className={styles.workRow}>
                  <Text as="span" tone="muted" size="sm">
                    +{data.recentRecords.length - RECENT_SHOWN} more
                  </Text>
                </li>
              )}
            </ul>
          )}
          <Text as="h3" size="lg" className={styles.subsectionTitle}>
            Versions
          </Text>
          {data.versions.length === 0 ? (
            <EmptyState>No versions tagged yet.</EmptyState>
          ) : (
            <div className={styles.versionPlates}>
              {data.versions.map((version, index) => {
                const body = (
                  <>
                    <Text as="p" size="lg">
                      {version.tag.name}
                    </Text>
                    <Text as="p" tone="muted" size="sm">
                      tagged {formatDate(version.tag.created_at)} by {version.authorDisplay}
                      {version.commitsSincePrevious !== null ? ` · ${version.commitsSincePrevious.toString()} changes since previous version` : ''}
                    </Text>
                  </>
                );
                return (
                  <Link key={version.tag.id} to={`${capabilityMapHref}?ref=tag:${version.tag.name}`} className={styles.versionLink}>
                    {index === 0 ? <BlueprintFrame>{body}</BlueprintFrame> : <div className={styles.versionPlate}>{body}</div>}
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** How many recent records "What's recent" lists before "+N more". */
const RECENT_SHOWN = 5;

const RECENT_OUTCOME_LABEL: Record<RecentRecord['outcome'], string> = {
  decided: 'Decision made',
  closed: 'Project closed',
  cancelled: 'Project cancelled',
};

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** One project in hand: title (to its page), status when not simply active, owner, target date, progress counts, and its decisions' timing — overdue ones flagged in words, never colour alone. */
function ProjectWorkRow({ summary, modelHref }: { summary: ProjectSummary; modelHref: string }) {
  const { project, ownerDisplay, progress, overdueDecisions, nextDecisionDue } = summary;
  return (
    <li className={styles.workRow}>
      <div className={styles.workRowTitle}>
        <Link to={`${modelHref}/projects/${project.id}`}>
          <Text as="span" size="lg">
            {project.title}
          </Text>
        </Link>
        {project.status !== 'active' && <Chip tone={projectStatusTone(project.status)}>{projectStatusLabel(project.status)}</Chip>}
        {overdueDecisions > 0 && (
          <Link to={`${modelHref}/projects/${project.id}`}>
            <Chip tone="warn">{plural(overdueDecisions, 'decision overdue', 'decisions overdue')}</Chip>
          </Link>
        )}
      </div>
      <Text as="p" tone="muted" size="sm">
        {ownerDisplay}
        {project.target_date !== null ? ` · target ${formatDate(project.target_date)}` : ''}
        {nextDecisionDue !== null ? ` · next decision due ${formatDate(nextDecisionDue)}` : ''}
      </Text>
      <Text as="p" tone="faint" size="xs">
        {formatProjectProgress(progress)}
      </Text>
    </li>
  );
}

/** One open decision that belongs to no project — a portfolio-level decision (ADR-024 §1). */
function DecisionWorkRow({ summary, modelHref }: { summary: OpenDecisionSummary; modelHref: string }) {
  const { decision, ownerDisplay, overdue } = summary;
  return (
    <li className={styles.workRow}>
      <div className={styles.workRowTitle}>
        <Link to={`${modelHref}/decisions/${decision.id}`}>
          <Text as="span">{decision.title}</Text>
        </Link>
        {overdue && <Chip tone="warn">overdue</Chip>}
      </div>
      <Text as="p" tone="muted" size="sm">
        {ownerDisplay}
        {decision.needed_by !== null ? ` · needed by ${formatDate(decision.needed_by)}` : ''}
      </Text>
    </li>
  );
}

const NO_IN_HAND: TileInHand = { projects: [], decisions: [] };
/** How many in-hand items a tile names before "+N more" — a tile is a glance, the project page and the decision list hold the rest. */
const IN_HAND_SHOWN = 2;

/** A weak tile's "In hand" line: the projects and decisions already addressing it, each a link to its own page — or, plainly, "No project or decision yet". Real links, rendered as siblings after the tile's own primary link (never inside it). */
function TileInHandLine({ inHand, modelHref }: { inHand: TileInHand; modelHref: string }) {
  if (isNothingInHand(inHand)) {
    return (
      <Text as="p" tone="muted" size="xs" className={styles.inHand}>
        No project or decision yet
      </Text>
    );
  }
  const items = [
    ...inHand.projects.map((p) => ({ key: `p-${p.id}`, href: `${modelHref}/projects/${p.id}`, label: `Project: ${p.title}` })),
    ...inHand.decisions.map((d) => ({ key: `d-${d.id}`, href: `${modelHref}/decisions/${d.id}`, label: `Decision: ${d.title}` })),
  ];
  const shown = items.slice(0, IN_HAND_SHOWN);
  const more = items.length - shown.length;
  return (
    <div className={styles.inHand}>
      <Text as="span" tone="muted" size="xs">
        Being handled by:
      </Text>
      <ul className={styles.inHandList}>
        {shown.map((item) => (
          <li key={item.key}>
            <Link to={item.href}>
              <Text as="span" size="xs">
                {item.label}
              </Text>
            </Link>
          </li>
        ))}
        {more > 0 && (
          <li>
            <Text as="span" tone="muted" size="xs">
              +{more} more
            </Text>
          </li>
        )}
      </ul>
    </div>
  );
}

interface CapabilityTileProps {
  tile: CapabilityTileData;
  orgSlug: string;
  modelSlug: string;
  emphasised: boolean;
  /** Prompt pack F3 PR6: gates the "Start a decision →" action below an emphasised (weak) tile — omitted entirely, not shown disabled, for a viewer; never rendered at all on a healthy tile. */
  role: MemberRole | null;
  /** The open projects and decisions already addressing this tile (`tileInHand.ts`) — named on a weak tile, and when there are any, the tile's own start actions are dropped. */
  inHand: TileInHand;
}

/** One issue on a weak tile: the item as a link, what is wrong with it beside it, and its own "Start a decision" / "Start a project" (only when nothing is in hand and the person may act). */
function IssueRow({ item, problem, actions }: { item: { name: string; to: string }; problem: string; actions: { decision: string; project: string | null } | null }) {
  return (
    <li>
      <Link to={item.to}>
        <Text as="span" size="sm">
          {item.name}
        </Text>
      </Link>{' '}
      <Text as="span" tone="muted" size="sm">
        {problem}
      </Text>
      {actions !== null && (
        <div className={styles.tileActions}>
          <StartDecisionLink href={actions.decision} />
          {actions.project !== null && <StartProjectLink href={actions.project} />}
        </div>
      )}
    </li>
  );
}

function CapabilityTile({ tile, orgSlug, modelSlug, emphasised, role, inHand }: CapabilityTileProps) {
  const href = `/o/${orgSlug}/m/${modelSlug}/e/${tile.capability.element_id}`;
  // Visual pass item 1: "no known supporters" specifically, not every weak
  // tile — `buildCapabilityTiles` (`modelHome.ts`) sets `tone: 'neutral'`
  // exactly when `supportingSystems.length === 0`, so this reuses that
  // existing classification rather than re-deriving it from the list.
  const severity = tileSeverity(tile);
  // Prompt pack F3 PR6: F3's own second named golden path, "from the
  // director door's weak-capability tile, start a decision" — gated on
  // the tile's own exposure tone specifically (not `emphasised`, which
  // F6.1 widened to also cover a tone-ok/poor-fit-only tile — the exact
  // "shows no known exposure" copy `prefillFromWeakCapability` writes
  // would be wrong for a tile that's only weak because of fit), and
  // rendered as a sibling *after* the tile's own primary link, not nested
  // inside it (an `<a>` cannot legally contain another `<a>`).
  // A "nothing recorded" tile is the capability-no-supporters finding,
  // whose one home is this grid since 2026-10-03 (UI-principles §3) — it
  // keeps that finding's own, more specific prefill ("Who supports X?",
  // `sourceFindingKey: 'capability-no-supporters'`) rather than the
  // generic weak-capability one.
  const tileCapability = { id: tile.capability.element_id, name: tile.capability.name };
  const canAct = tile.tone !== 'ok' && canStartDecision(role);
  const decisionsBase = `/o/${orgSlug}/m/${modelSlug}/decisions?`;
  // A "no system recorded" tile is the capability-no-supporters finding, whose one home is this grid since 2026-10-03 (UI-principles §3) — its row keeps that finding's own prefill ("Who supports X?").
  const noSystemHref = tile.tone === 'neutral' && canAct ? `${decisionsBase}${decisionPrefillToSearchParams(prefillFromCapabilityNoSupportersFinding(tileCapability)).toString()}` : null;
  // F6.1: a second, independent "Start a decision" for the fit reason —
  // concerns are the individual poor-fit capabilities under this tile
  // (`prefillFromWeakFitCapabilities`), never the level-1 tile itself.
  // Suppressed once every poor-fit edge already has a planned
  // replacement recorded (`weakFitAllReplacementPlanned`) — the fit pill
  // reads "replacement planned" instead in that case, nothing left to
  // start a decision about.
  const startFitDecisionHref =
    tile.weakFitCapabilities.length > 0 && !tile.weakFitAllReplacementPlanned && canStartDecision(role)
      ? `/o/${orgSlug}/m/${modelSlug}/decisions?${decisionPrefillToSearchParams(prefillFromWeakFitCapabilities(tile.capability.name, tile.weakFitCapabilities.map((c) => ({ id: c.element_id, name: c.name })))).toString()}`
      : null;
  // UI-principles §3 (2026-10-04): once a project or decision is already
  // addressing this tile, it says so instead of offering to start another.
  const nothingInHand = isNothingInHand(inHand);
  const fitActionHref = nothingInHand ? startFitDecisionHref : null;
  const rowActions = (href: string | null) => (nothingInHand && href !== null ? { decision: href, project: canStartProject(role) ? href.replace('/decisions?', '/projects?') : null } : null);
  const content = (
    <>
      <span className={styles.statusBar} data-tone={severity.tone} aria-hidden="true" />
      <Chip tone={severity.tone}>{severity.label}</Chip>
      <Text as="p" size="lg" className={styles.tileName}>
        {tile.capability.name}
      </Text>
      <Text as="p" tone="muted" size="xs" className={styles.tileFooter}>
        {tile.supportingSystems.length === 0
          ? 'no system supports this'
          : `${tile.supportingSystems.length.toString()} ${tile.supportingSystems.length === 1 ? 'system' : 'systems'}${tile.exposedSystems.length > 0 ? ` · ${tile.exposedSystems.length.toString()} at end of life` : ''}`}
        {' · '}
        {domainCoverageSummary(tile.supportedCapabilityCount, tile.totalCapabilityCount)}
      </Text>
      {/* The task's own rule: a real level shows on every tile; the
          gentle "Importance not set" prompt shows only on a flagged
          (emphasised) tile — a healthy tile with nothing assessed isn't
          worth nudging about. */}
      {(tile.importance !== null || emphasised) && (
        <Text as="p" tone={tile.importance === null ? 'faint' : 'muted'} size="xs" className={styles.tileImportance}>
          {importanceLabel(tile.importance)}
        </Text>
      )}
      {/* F6.1: a second, visually distinct pill — its own glyph shape (a
          triangle, not the tone chip's round dot) so the two never read as
          one combined status even before colour is considered (§6.3/§8.4's
          "never colour alone"). Rendered off `weakFitCapabilities` directly,
          not `emphasised` — the instruction's own "independently of tone". */}
      {tile.weakFitCapabilities.length > 0 && (
        <Chip tone={weakFitPillTone(tile.weakFitAllReplacementPlanned)} glyph={<span className={styles.fitGlyph} aria-hidden="true" />}>
          {formatWeakFitPillLabel(tile.weakFitCapabilities.length - tile.adequateFitCount, tile.adequateFitCount, tile.weakFitAllReplacementPlanned)}
        </Chip>
      )}
    </>
  );

  // The frame (an emphasised tile's) wraps the whole tile — its primary
  // link, the fit-capability links and the actions — so the actions sit
  // inside the card they belong to rather than trailing below it after a
  // gap (found at 390px: the link used to reserve room for them *outside*
  // the frame, and a two-action tile stacked them below even that).
  const body = (
    <>
      <Link to={href} className={emphasised ? styles.tileEmphasised : styles.tile}>
        {content}
      </Link>
      {/* F6.1: "link to the capabilities concerned" — real, individually
          navigable links, rendered as DOM siblings after the tile's own
          primary link (never nested inside it, same reasoning as
          `StartDecisionLink` below — an `<a>` cannot legally contain
          another `<a>`). */}
      {/* One row per issue: the item (a real link, a sibling of the tile link, never nested in it), what is wrong with it, and the actions that are about it. */}
      {(tile.exposedSystems.length > 0 || tile.tone === 'neutral') && (
        <ul className={styles.exposingSystems}>
          {tile.exposedSystems.map((system) => {
            const lifecycleStatus = attributesRecord(system.attributes).lifecycleStatus;
            const replacementPlanned = tile.tone === 'info';
            const href = canAct ? `${decisionsBase}${decisionPrefillToSearchParams(prefillFromSystemAtEndOfLife({ id: system.element_id, name: system.name }, tileCapability, replacementPlanned)).toString()}` : null;
            return (
              <IssueRow
                key={system.element_id}
                item={{ name: system.name, to: `/o/${orgSlug}/m/${modelSlug}/e/${system.element_id}` }}
                problem={`${typeof lifecycleStatus === 'string' && lifecycleStatus !== '' ? lifecycleStatus : 'at end of life'}, ${replacementPlanned ? 'replacement planned' : 'no replacement'}`}
                actions={rowActions(href)}
              />
            );
          })}
          {tile.tone === 'neutral' && <IssueRow item={{ name: tile.capability.name, to: href }} problem="has no system supporting it" actions={rowActions(noSystemHref)} />}
        </ul>
      )}
      {emphasised && !tile.isOwned && (
        <Text as="p" size="xs" tone="muted" className={styles.tileImportance}>
          <Link to={href}>No owner recorded</Link>
        </Text>
      )}
      {tile.weakFitCapabilities.length > 0 && (
        <ul className={styles.fitCapabilityList}>
          {tile.weakFitCapabilities.map((capability) => (
            <li key={capability.element_id}>
              <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${capability.element_id}`}>
                <Text as="span" size="xs">
                  {capability.name}
                </Text>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {emphasised && <TileInHandLine inHand={inHand} modelHref={`/o/${orgSlug}/m/${modelSlug}`} />}
      {fitActionHref !== null && (
        <div className={styles.tileActions}>
          <StartDecisionLink href={fitActionHref} />
        </div>
      )}
    </>
  );

  return <div className={styles.tileWrapper}>{body}</div>;
}
