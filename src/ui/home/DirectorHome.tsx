import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { BlueprintFrame } from '../components/BlueprintFrame/BlueprintFrame';
import { Button } from '../components/Button/Button';
import { Chip, type ChipTone } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import type { UUID } from '../../contracts/delta';
import type { MemberRole } from '../../db/types';
import { formatDate } from '../time';
import { branchStatusTone } from '../changes/branchStatus';
import { defaultIntentForEntryPoint } from '../changes/branchIntent';
import type { BranchIntent } from '../../db/types';
import { CapabilityMapImportPanel } from '../capabilityMap/CapabilityMapImportPanel';
import { attributesRecord } from '../elements/attributesRecord';
import { ProposeChangePicker } from './ProposeChangePicker';
import { canCreateChangeBranch } from '../orgs/useMembership';
import type { CapabilityTileData } from '../../db/modelHome';
import type { DirectorHomeData } from './useDirectorHome';
import styles from './DirectorHome.module.css';

export interface DirectorHomeProps {
  data: DirectorHomeData;
  reload: () => void;
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  /** Sprint 7i item 4's "Propose a change" entry point — the one deliberate exception to this door's own "no add control anywhere" design (see this component's own module comment); gated the same way every other propose-a-change entry point is. */
  role: MemberRole | null;
  orgSlug: string;
  modelSlug: string;
}

/**
 * The director's door (UI-principles §3.1, built to Handoff 7d —
 * `docs/HANDOFF-7d-director-door.md`): one vertical read, weakness first,
 * then what's changing, then what's recent. Read-only by construction —
 * no branch selector, no inline edit, no add control anywhere on this
 * page (the search box lives in `ModelHome`'s shared title row, common to
 * both doors — see this component's own module comment in the handoff
 * doc for the one place this build simplified the literal layout: the
 * title/search chrome stays the existing shared header rather than a
 * director-only redesign of it, to avoid touching the architect door).
 */
export function DirectorHome({ data, reload, modelId, orgId, userId, role, orgSlug, modelSlug }: DirectorHomeProps) {
  const capabilityMapHref = `/o/${orgSlug}/m/${modelSlug}/capability-map`;
  // Prompt pack F0: which entry point (if either) is currently open, and
  // therefore which intent the picker it opens should default to —
  // `null` means neither is open. A single piece of state rather than two
  // booleans, since only one of "Propose a change"/"What happened" can be
  // open at a time.
  const [changeEntryIntent, setChangeEntryIntent] = useState<BranchIntent | null>(null);
  const navigate = useNavigate();
  const canPropose = canCreateChangeBranch(role);

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

  const weakTiles = data.tiles.filter((t) => t.tone !== 'ok');
  const healthyTiles = data.tiles.filter((t) => t.tone === 'ok');

  return (
    <div className={styles.door}>
      <section aria-label="Where are we weak">
        <div className={styles.sectionHeader}>
          <Text as="h2" size="lg">
            Where are we weak
          </Text>
          <Link to={capabilityMapHref} className={styles.sectionLink}>
            <Text as="span" size="sm">
              Open capability map →
            </Text>
          </Link>
        </div>
        <div className={styles.weaknessChips}>
          <Chip tone={data.exposedCount > 0 ? 'warn' : 'ok'}>
            {data.exposedCount} {data.exposedCount === 1 ? 'capability' : 'capabilities'} exposed
          </Chip>
          <Chip tone={data.unrecordedCount > 0 ? 'neutral' : 'ok'}>{data.unrecordedCount} with nothing recorded</Chip>
        </div>

        <div className={styles.tileGrid}>
          {weakTiles.map((tile) => (
            <CapabilityTile key={tile.capability.element_id} tile={tile} orgSlug={orgSlug} modelSlug={modelSlug} emphasised />
          ))}
          {healthyTiles.map((tile) => (
            <CapabilityTile key={tile.capability.element_id} tile={tile} orgSlug={orgSlug} modelSlug={modelSlug} emphasised={false} />
          ))}
        </div>
      </section>

      <div className={styles.lowerRow}>
        <section className={styles.changesColumn} aria-label="What's changing">
          <div className={styles.sectionHeader}>
            <Text as="h2" size="lg">
              What's changing
            </Text>
            <Text as="span" tone="muted" size="sm">
              {data.openChanges.length} open{data.nextTargetDate ? ` · next target ${formatDate(data.nextTargetDate)}` : ''}
            </Text>
            {canPropose && (
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setChangeEntryIntent(defaultIntentForEntryPoint('directorDoor'));
                  }}
                >
                  Propose a change
                </Button>
                {/* Prompt pack F0's own "'what happened' → record" entry point — genuinely new, no prior surface for it anywhere in this app. Same gate as "Propose a change" (a lightweight, contributor-level act like opening any other change). */}
                <Button
                  variant="ghost"
                  onClick={() => {
                    setChangeEntryIntent(defaultIntentForEntryPoint('whatHappened'));
                  }}
                >
                  What happened
                </Button>
              </>
            )}
          </div>
          {changeEntryIntent && (
            <Panel>
              <ProposeChangePicker
                modelId={modelId}
                orgId={orgId}
                userId={userId}
                defaultIntent={changeEntryIntent}
                onChosen={(branch) => {
                  setChangeEntryIntent(null);
                  // ChangePage.tsx routes on the branch id in the path itself, not `?ref=` — there's nothing to select once you're already on that change's own page.
                  void navigate(`/o/${orgSlug}/m/${modelSlug}/changes/${branch.id}`);
                }}
                onCancel={() => {
                  setChangeEntryIntent(null);
                }}
              />
            </Panel>
          )}
          {data.openChanges.length === 0 ? (
            <EmptyState>Nothing changing right now.</EmptyState>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.changeColumn}>Change</th>
                    <th>Status</th>
                    <th>Touches</th>
                    <th className={styles.targetColumn}>Target</th>
                  </tr>
                </thead>
                <tbody>
                  {data.openChanges.map(({ branch, touches }) => (
                    <tr key={branch.id}>
                      <td>
                        <Link to={`/o/${orgSlug}/m/${modelSlug}/changes/${branch.id}`}>
                          <Text as="span">{branch.title ?? branch.name}</Text>
                        </Link>
                      </td>
                      <td>
                        <Chip tone={branchStatusTone(branch.status)} glyph={<span className={styles.dot} />}>
                          {branch.status}
                        </Chip>
                      </td>
                      <td>
                        <Text as="span" tone="muted" size="sm">
                          {touches}
                        </Text>
                      </td>
                      <td className={styles.targetColumn}>
                        <Text as="span" mono size="sm">
                          {branch.target_date ? formatDate(branch.target_date) : '—'}
                        </Text>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={styles.versionsColumn} aria-label="What's recent">
          <Text as="h2" size="lg">
            What's recent
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
                      {version.commitsSincePrevious !== null ? ` · ${version.commitsSincePrevious.toString()} commits since previous tag` : ''}
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

interface CapabilityTileProps {
  tile: CapabilityTileData;
  orgSlug: string;
  modelSlug: string;
  emphasised: boolean;
}

const TONE_LABEL: Record<CapabilityTileData['tone'], string> = {
  ok: 'no known exposure',
  warn: 'lifecycle exposure',
  info: 'replacement planned',
  neutral: 'nothing recorded',
};

const TONE_CHIP: Record<CapabilityTileData['tone'], ChipTone> = { ok: 'ok', warn: 'warn', info: 'info', neutral: 'neutral' };

function CapabilityTile({ tile, orgSlug, modelSlug, emphasised }: CapabilityTileProps) {
  const href = `/o/${orgSlug}/m/${modelSlug}/e/${tile.capability.element_id}`;
  const content = (
    <>
      <span className={styles.statusBar} data-tone={tile.tone} aria-hidden="true" />
      <Text as="p" size="lg" className={styles.tileName}>
        {tile.capability.name}
      </Text>
      {tile.exposedSystems.length > 0 && (
        <ul className={styles.exposingSystems}>
          {tile.exposedSystems.map((system) => {
            const lifecycleStatus = attributesRecord(system.attributes).lifecycleStatus;
            return (
              <li key={system.element_id}>
                <Text as="span" size="sm">
                  {system.name}
                </Text>{' '}
                <Text as="span" tone="muted" size="sm">
                  {typeof lifecycleStatus === 'string' ? lifecycleStatus : ''}
                </Text>
              </li>
            );
          })}
        </ul>
      )}
      <Text as="p" tone="muted" size="xs" className={styles.tileFooter}>
        {tile.supportingSystems.length === 0
          ? 'no known supporters'
          : `${tile.supportingSystems.length.toString()} ${tile.supportingSystems.length === 1 ? 'system' : 'systems'}${tile.exposedSystems.length > 0 ? ` · ${tile.exposedSystems.length.toString()} exposed` : ''}`}
      </Text>
      {emphasised && (
        <Chip tone={TONE_CHIP[tile.tone]} glyph={<span className={styles.dot} />}>
          {TONE_LABEL[tile.tone]}
        </Chip>
      )}
    </>
  );

  return (
    <Link to={href} className={emphasised ? styles.tileEmphasised : styles.tile}>
      {emphasised ? <BlueprintFrame>{content}</BlueprintFrame> : content}
    </Link>
  );
}
