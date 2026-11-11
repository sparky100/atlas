/**
 * ADR-027 (F14 step 6b): a dashboard — an ordered grid of live tiles, each
 * running a saved report over main's head. Rows are loaded once per source and
 * shared by every tile that uses it. Whoever may edit the dashboard (RLS; the
 * buttons mirror it) can rename it, share it, add, remove, reorder and resize
 * tiles. No coordinates are stored: order and a size from a fixed set only
 * (rule 3).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { parseReportSpec, type ReportSource } from '../../contracts/reportSpec';
import { addDashboardTile, deleteDashboard, listDashboardTiles, listSavedReports, removeDashboardTile, updateDashboard, updateDashboardTile } from '../../db/reports';
import type { DashboardRow, DashboardTileKind, DashboardTileRow, DashboardTileSize, MemberRole, SavedReportRow } from '../../db/types';
import { Button } from '../components/Button/Button';
import { ExportViewButtons } from '../components/ExportViewButtons/ExportViewButtons';
import { Loading } from '../components/Loading/Loading';
import { dashboardExportPlan, type ExportTileItem } from '../exports/dashboardExport';
import { exportDate } from '../exports/viewExport';
import { Text } from '../components/Text/Text';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import { DashboardTileCard } from './DashboardTileCard';
import { canEditDashboard, DEFAULT_TABLE_TILE_ROWS, nextTilePosition, reportsOfferableTo, suggestedTileKind, swapTilePositions, tileColumnSpan, tileKindsFor, TILE_KIND_LABEL } from './dashboardTiles';
import { ReportRunner } from './ReportRunner';
import { ReportLoadError } from './ReportLoadError';
import styles from './Dashboard.module.css';

export interface DashboardViewProps {
  dashboard: DashboardRow;
  orgId: UUID;
  modelId: UUID;
  modelName: string;
  userId: UUID | null;
  role: MemberRole | null;
  main: { headCommitId: UUID };
  basePath: string;
  onChanged: () => void;
}

const SIZE_LABEL: Record<DashboardTileSize, string> = { one: 'One column', two: 'Two columns', full: 'Full width' };
/** ADR-027: a table tile shows 1 to 50 rows. */
const TABLE_TILE_ROW_CHOICES = [3, 5, 10, 15, 25, 50] as const;
const NO_TILES: DashboardTileRow[] = [];
const NO_REPORTS: SavedReportRow[] = [];

type DashboardLoad = { key: string; status: 'error' } | { key: string; status: 'ready'; tiles: DashboardTileRow[]; reports: SavedReportRow[] };
interface TileExport {
  scope: string;
  item: ExportTileItem;
}

export function DashboardView({ dashboard, orgId, modelId, modelName, userId, role, main, basePath, onChanged }: DashboardViewProps) {
  const navigate = useNavigate();
  const [load, setLoad] = useState<DashboardLoad | null>(null);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState(dashboard.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [add, setAdd] = useState<{ reportId: string; kind: DashboardTileKind | ''; size: DashboardTileSize }>({ reportId: '', kind: '', size: 'one' });
  const [presenting, setPresenting] = useState(false);
  const requestKey = `${dashboard.id}:${modelId}:${userId ?? ''}:${String(reload)}`;
  const current = load?.key === requestKey ? load : null;
  const ready = current?.status === 'ready';
  const tiles = current?.status === 'ready' ? current.tiles : NO_TILES;
  const reports = current?.status === 'ready' ? current.reports : NO_REPORTS;
  const resultScope = `${requestKey}:${main.headCommitId}`;
  const [results, setResults] = useState(new Map<string, TileExport>());
  const onResult = useCallback((tileId: string, item: ExportTileItem | null) => {
    setResults((previous) => {
      if (item === null && previous.get(tileId)?.scope !== resultScope) return previous;
      const next = new Map(previous);
      if (item === null) next.delete(tileId);
      else next.set(tileId, { scope: resultScope, item });
      return next;
    });
  }, [resultScope]);
  const canEdit = ready && canEditDashboard(dashboard, userId, role) && !presenting;
  const canShare = role === 'owner' || role === 'architect';
  const retry = () => { setReload((n) => n + 1); };

  useEffect(() => {
    let cancelled = false;
    Promise.all([listDashboardTiles(supabase, dashboard.id), listSavedReports(supabase, modelId)])
      .then(([t, r]) => {
        if (cancelled) return;
        setLoad({ key: requestKey, status: 'ready', tiles: t, reports: r });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        console.error("Couldn't load the dashboard tiles and reports.", e);
        setLoad({ key: requestKey, status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [dashboard.id, modelId, requestKey]);

  async function attempt(action: () => Promise<void>, failure: string): Promise<void> {
    setMessage(null);
    try {
      await action();
      setReload((n) => n + 1);
    } catch (e: unknown) {
      reportError(failure, e);
      setMessage(e instanceof Error ? e.message : failure);
    }
  }

  // Present mode: fill the screen where the browser allows it; Esc (or leaving full screen) ends it.
  useEffect(() => {
    if (!presenting) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPresenting(false);
    };
    const onFullscreen = () => {
      if (document.fullscreenElement === null) setPresenting(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreen);
    void document.documentElement.requestFullscreen().catch(() => undefined);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreen);
      if (document.fullscreenElement !== null) void document.exitFullscreen().catch(() => undefined);
    };
  }, [presenting]);

  const reportsById = useMemo(() => new Map(reports.map((r) => [r.id, r])), [reports]);
  const specs = useMemo(() => new Map(reports.map((r) => [r.id, parseReportSpec(r.spec)])), [reports]);
  const shown = [...tiles]
    .sort((a, b) => a.position - b.position)
    .flatMap((tile) => {
      const report = reportsById.get(tile.report_id);
      return report ? [{ tile, report }] : [];
    });
  const sources = [...new Set(shown.flatMap(({ tile }) => {
    const parsed = specs.get(tile.report_id);
    return parsed?.ok ? [parsed.spec.source] : [];
  }))] as ReportSource[];
  const offerable = reportsOfferableTo(reports, dashboard.visibility);
  const addSpec = specs.get(add.reportId);
  const addKinds = addSpec?.ok ? tileKindsFor(addSpec.spec) : [];
  const exportItems = shown.flatMap(({ tile }) => {
    const entry = results.get(tile.id);
    return entry?.scope === resultScope ? [entry.item] : [];
  });
  const canExport = ready && tiles.length > 0 && exportItems.length === tiles.length;
  const unavailable = tiles.filter((tile) => !specs.get(tile.report_id)?.ok);

  return (
    <div className={presenting ? styles.present : styles.dashboard}>
      {presenting && (
        <div className={styles.presentBar}>
          <Text as="h1" size="2xl">
            {dashboard.name}
          </Text>
          <Button
            variant="secondary"
            onClick={() => {
              setPresenting(false);
            }}
          >
            Exit presenting
          </Button>
        </div>
      )}
      <div className={styles.headerRow} hidden={presenting}>
        <Text as="p" size="sm" tone="muted">
          {dashboard.visibility === 'organisation' ? 'Shared with the organisation' : 'Private to you'} · live from main
        </Text>
        <div className={styles.row}>
          <Button
            variant="secondary"
            disabled={shown.length === 0}
            onClick={() => {
              setEditing(false);
              setPresenting(true);
            }}
          >
            Present
          </Button>
          <ExportViewButtons
            what="dashboard"
            disabled={!canExport}
            build={() => {
              if (!canExport) return null;
              const stamp = { modelName, viewLabel: dashboard.name, refLabel: 'Main', date: exportDate() };
              return { plan: dashboardExportPlan(exportItems, stamp), stamp };
            }}
          />
        {canEdit && (
          <Button
            variant="ghost"
            onClick={() => {
              setEditing((e) => !e);
              setMessage(null);
            }}
          >
            {editing ? 'Done editing' : 'Edit dashboard'}
          </Button>
        )}
        </div>
      </div>
      {message !== null && (
        <Text as="p" size="sm">
          {message}
        </Text>
      )}

      {current === null && <Loading />}
      {current?.status === 'error' && <ReportLoadError message="Couldn't load the dashboard tiles and reports." retry={retry} />}
      {ready && tiles.length === 0 && (
        <Text as="p" tone="muted">
          {canEdit ? 'No tiles yet. Choose "Edit dashboard" to add one from a saved report.' : 'This dashboard has no tiles yet.'}
        </Text>
      )}
      {ready && tiles.length > 0 && !canExport && (
        <Text as="p" size="sm" tone="muted">All tiles must be available before you can export this dashboard.</Text>
      )}

      <div className={styles.grid}>
        {unavailable.map((tile) => (
          <section key={tile.id} className={styles.tile} style={{ '--span': tileColumnSpan(tile.size), order: tile.position } as React.CSSProperties}>
            <Text as="p">{reportsById.get(tile.report_id)?.name ?? 'The report for this tile'} is unavailable.</Text>
            {editing && canEdit && (
              <Button variant="destructive" onClick={() => { void attempt(() => removeDashboardTile(supabase, tile.id), "Couldn't remove the tile."); }}>Remove</Button>
            )}
          </section>
        ))}
        {sources.map((source) => (
          <div key={source} className={styles.contents}>
            <ReportRunner source={source} modelId={modelId} orgId={orgId} commitId={main.headCommitId}>
              {(rows, knownFields) =>
                shown
                  .filter(({ tile }) => {
                    const p = specs.get(tile.report_id);
                    return p?.ok && p.spec.source === source;
                  })
                  .map(({ tile, report }) => {
                    return (
                      <section key={tile.id} className={styles.tile} style={{ '--span': tileColumnSpan(tile.size), order: tile.position } as React.CSSProperties}>
                        <DashboardTileCard tile={tile} report={report} rows={rows} knownFields={knownFields} basePath={basePath} onResult={onResult} />
                        {editing && (
                          <div className={styles.tileControls}>
                            <select
                              aria-label="Show as"
                              className={styles.select}
                              value={tile.kind}
                              onChange={(e) => {
                                void attempt(() => updateDashboardTile(supabase, tile.id, { kind: e.target.value as DashboardTileKind }), "Couldn't change the tile.");
                              }}
                            >
                              {(() => {
                                const p = specs.get(tile.report_id);
                                return (p?.ok ? tileKindsFor(p.spec) : [tile.kind]).map((k) => (
                                  <option key={k} value={k}>
                                    {TILE_KIND_LABEL[k]}
                                  </option>
                                ));
                              })()}
                            </select>
                            {tile.kind === 'table' && (
                              <select
                                aria-label="Rows shown"
                                className={styles.select}
                                value={tile.row_limit ?? DEFAULT_TABLE_TILE_ROWS}
                                onChange={(e) => {
                                  void attempt(() => updateDashboardTile(supabase, tile.id, { rowLimit: Number(e.target.value) }), "Couldn't change the tile.");
                                }}
                              >
                                {TABLE_TILE_ROW_CHOICES.map((n) => (
                                  <option key={n} value={n}>
                                    {n} rows
                                  </option>
                                ))}
                              </select>
                            )}
                            <select
                              aria-label="Tile size"
                              className={styles.select}
                              value={tile.size}
                              onChange={(e) => {
                                void attempt(() => updateDashboardTile(supabase, tile.id, { size: e.target.value as DashboardTileSize }), "Couldn't resize the tile.");
                              }}
                            >
                              {(Object.keys(SIZE_LABEL) as DashboardTileSize[]).map((s) => (
                                <option key={s} value={s}>
                                  {SIZE_LABEL[s]}
                                </option>
                              ))}
                            </select>
                            <Button
                              variant="ghost"
                              onClick={() => {
                                void attempt(async () => {
                                  for (const op of swapTilePositions(tiles, tile.id, 'earlier')) await updateDashboardTile(supabase, op.id, { position: op.position });
                                }, "Couldn't move the tile.");
                              }}
                            >
                              Move earlier
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => {
                                void attempt(async () => {
                                  for (const op of swapTilePositions(tiles, tile.id, 'later')) await updateDashboardTile(supabase, op.id, { position: op.position });
                                }, "Couldn't move the tile.");
                              }}
                            >
                              Move later
                            </Button>
                            <Button
                              variant="destructive"
                              onClick={() => {
                                void attempt(() => removeDashboardTile(supabase, tile.id), "Couldn't remove the tile.");
                              }}
                            >
                              Remove
                            </Button>
                          </div>
                        )}
                      </section>
                    );
                  })
              }
            </ReportRunner>
          </div>
        ))}
      </div>

      {editing && canEdit && (
        <div className={styles.editor}>
          <Text as="h2" size="lg">
            Add a tile
          </Text>
          {offerable.length === 0 && (
            <Text as="p" tone="muted">
              {dashboard.visibility === 'organisation' ? 'A dashboard shared with the organisation can only show reports shared with the organisation. Share a report first.' : 'Save a report from the Elements or Portfolio page first.'}
            </Text>
          )}
          {offerable.length > 0 && (
            <form
              className={styles.row}
              onSubmit={(e) => {
                e.preventDefault();
                const spec = addSpec?.ok ? addSpec.spec : null;
                if (spec === null) return;
                void attempt(async () => {
                  await addDashboardTile(supabase, { id: crypto.randomUUID(), dashboardId: dashboard.id, reportId: add.reportId, position: nextTilePosition(tiles), kind: add.kind === '' ? suggestedTileKind(spec) : add.kind, size: add.size });
                  setAdd({ reportId: '', kind: '', size: 'one' });
                }, "Couldn't add the tile.");
              }}
            >
              <label className={styles.field}>
                <span>Report</span>
                <select
                  className={styles.select}
                  value={add.reportId}
                  onChange={(e) => {
                    setAdd({ ...add, reportId: e.target.value, kind: '' });
                  }}
                >
                  <option value="">Choose a report…</option>
                  {offerable.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Show as</span>
                <select
                  className={styles.select}
                  value={add.kind}
                  disabled={addKinds.length === 0}
                  onChange={(e) => {
                    setAdd({ ...add, kind: e.target.value as DashboardTileKind });
                  }}
                >
                  <option value="">{addSpec?.ok ? `Suggested (${TILE_KIND_LABEL[suggestedTileKind(addSpec.spec)]})` : 'Suggested'}</option>
                  {addKinds.map((k) => (
                    <option key={k} value={k}>
                      {TILE_KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Width</span>
                <select
                  className={styles.select}
                  value={add.size}
                  onChange={(e) => {
                    setAdd({ ...add, size: e.target.value as DashboardTileSize });
                  }}
                >
                  {(Object.keys(SIZE_LABEL) as DashboardTileSize[]).map((s) => (
                    <option key={s} value={s}>
                      {SIZE_LABEL[s]}
                    </option>
                  ))}
                </select>
              </label>
              <Button variant="primary" type="submit" disabled={!addSpec?.ok}>
                Add tile
              </Button>
            </form>
          )}
          {addSpec?.ok && addSpec.spec.groupBy === undefined && (
            <Text as="p" size="sm" tone="muted">
              This report has no grouping, so it can only be a big number or a table. To show it as a bar chart, donut or stacked bar,{' '}
              <Link to={`${basePath}/reports/saved/${add.reportId}`}>open the report</Link> and choose "Edit report settings…" to group it by a field.
            </Text>
          )}

          <Text as="h2" size="lg">
            This dashboard
          </Text>
          <form
            className={styles.row}
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() === '') return;
              void attempt(async () => {
                await updateDashboard(supabase, dashboard.id, { name: name.trim() });
                onChanged();
              }, "Couldn't rename the dashboard.");
            }}
          >
            <label className={styles.field}>
              <span>Name</span>
              <input
                className={styles.input}
                value={name}
                maxLength={120}
                onChange={(e) => {
                  setName(e.target.value);
                }}
              />
            </label>
            <Button type="submit">Rename</Button>
            {canShare && (
              <Button
                onClick={() => {
                  void attempt(async () => {
                    await updateDashboard(supabase, dashboard.id, { visibility: dashboard.visibility === 'organisation' ? 'private' : 'organisation' });
                    onChanged();
                  }, "Couldn't change who can see the dashboard.");
                }}
              >
                {dashboard.visibility === 'organisation' ? 'Make private' : 'Share with the organisation'}
              </Button>
            )}
          </form>
          {!confirmDelete ? (
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmDelete(true);
              }}
            >
              Delete this dashboard…
            </Button>
          ) : (
            <div className={styles.row}>
              <Text size="sm">Delete this dashboard? Its reports are kept.</Text>
              <Button
                variant="destructive"
                onClick={() => {
                  void attempt(async () => {
                    await deleteDashboard(supabase, dashboard.id);
                    void navigate(`${basePath}/reports`);
                  }, "Couldn't delete the dashboard.");
                }}
              >
                Yes, delete it
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setConfirmDelete(false);
                }}
              >
                Keep it
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
