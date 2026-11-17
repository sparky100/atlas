/**
 * ADR-027 (F14 step 5): the saved-reports library on the Reports hub — the
 * model's saved reports (own private ones and the organisation's) with
 * open, rename, duplicate and delete, plus the saved copies taken. Who may
 * edit or delete is enforced by RLS; the buttons here just mirror it so
 * nobody is offered something the database would refuse.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { UUID } from "../../contracts/delta";
import { parseReportSpec } from "../../contracts/reportSpec";
import {
  createSavedReport,
  deleteSavedReport,
  listSavedReports,
  listSnapshotsForModel,
  updateSavedReport,
} from "../../db/reports";
import type {
  MemberRole,
  ReportSnapshotRow,
  SavedReportRow,
} from "../../db/types";
import { Button } from "../components/Button/Button";
import { Chip } from "../components/Chip/Chip";
import { Text } from "../components/Text/Text";
import { reportError } from "../errors/errorBannerStore";
import { canCreateChangeBranch } from "../orgs/roleGates";
import { supabase } from "../supabaseClient";
import { copyLabel } from "./copyLabel";
import { canEditReport } from "./reportAccess";
import {
  matchesSearch,
  sortSavedReports,
  sourceLabel,
  specSummary,
  type SavedReportSortKey,
} from "./savedReportList";
import { RowMenu } from "./RowMenu";
import { NewModelReport } from "./NewModelReport";
import styles from "./SavedReportsLibrary.module.css";

export interface SavedReportsLibraryProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  role: MemberRole | null;
  basePath: string;
}

const canEdit = canEditReport;

/** How many saved reports show before "Show all". */
const VISIBLE_REPORTS = 5;

export function SavedReportsLibrary({
  modelId,
  orgId,
  userId,
  role,
  basePath,
}: SavedReportsLibraryProps) {
  const [reports, setReports] = useState<SavedReportRow[]>([]);
  const [copies, setCopies] = useState<ReportSnapshotRow[]>([]);
  const [reload, setReload] = useState(0);
  const [renaming, setRenaming] = useState<{ id: UUID; name: string } | null>(
    null,
  );
  const [deleting, setDeleting] = useState<UUID | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SavedReportSortKey>("updated");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listSavedReports(supabase, modelId),
      listSnapshotsForModel(supabase, modelId),
    ])
      .then(([r, c]) => {
        if (cancelled) return;
        setReports(r);
        setCopies(c);
      })
      .catch((e: unknown) => {
        reportError("Couldn't load saved reports.", e);
      });
    return () => {
      cancelled = true;
    };
  }, [modelId, reload]);

  async function attempt(
    action: () => Promise<void>,
    failure: string,
  ): Promise<void> {
    setMessage(null);
    try {
      await action();
      setReload((n) => n + 1);
    } catch (e: unknown) {
      reportError(failure, e);
      setMessage(e instanceof Error ? e.message : failure);
    }
  }

  const canCreate = userId !== null && canCreateChangeBranch(role);
  const newReport = canCreate ? <NewModelReport orgId={orgId} modelId={modelId} userId={userId} basePath={basePath} /> : null;
  const shown = sortSavedReports(reports, sortKey).flatMap((row) => {
    const parsed = parseReportSpec(row.spec);
    return matchesSearch(
      [row.name, row.description, parsed.ok ? specSummary(parsed.spec) : ""],
      query,
    )
      ? [{ row, parsed }]
      : [];
  });
  // A long list pushes the standing checks off screen, so show a few and let the reader open the rest. A search shows every match.
  const capped = !showAll && query.trim() === "" && shown.length > VISIBLE_REPORTS;
  const visible = capped ? shown.slice(0, VISIBLE_REPORTS) : shown;
  if (reports.length === 0 && copies.length === 0) {
    return (
      <section className={styles.section}>
        <Text as="h2" size="lg">
          Saved reports
        </Text>
        {newReport}
        <Text as="p" tone="muted">
          Nothing saved yet. Filter the Elements or Portfolio page, then choose
          "Save as report…".
        </Text>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <Text as="h2" size="lg">
        Saved reports
      </Text>
      {newReport}
      {message !== null && (
        <Text as="p" size="sm">
          {message}
        </Text>
      )}
      <div className={styles.toolbar}>
        <input
          className={styles.input}
          type="search"
          aria-label="Search saved reports"
          placeholder="Search saved reports"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
        />
        <label className={styles.sortLabel}>
          <Text as="span" size="sm" tone="muted">
            Sort by
          </Text>
          <select
            aria-label="Sort saved reports"
            value={sortKey}
            onChange={(e) => {
              setSortKey(e.target.value as SavedReportSortKey);
            }}
          >
            <option value="updated">Recently updated</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>
      {shown.length === 0 && (
        <Text as="p" tone="muted">
          No saved reports match “{query.trim()}”.
        </Text>
      )}
      {shown.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Source</th>
                <th scope="col" className={styles.wide}>
                  What it shows
                </th>
                <th scope="col">Visibility</th>
                <th scope="col" className={styles.wide}>
                  Updated
                </th>
                <th scope="col">
                  <span className={styles.srOnly}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ row: r, parsed }) => (
                <tr key={r.id}>
                  {renaming?.id === r.id ? (
                    <td colSpan={6}>
                      <form
                        className={styles.row}
                        onSubmit={(e) => {
                          e.preventDefault();
                          const name = renaming.name.trim();
                          if (name === "") return;
                          void attempt(async () => {
                            await updateSavedReport(supabase, r.id, { name });
                            setRenaming(null);
                          }, "Couldn't rename the report.");
                        }}
                      >
                        <input
                          className={styles.input}
                          aria-label="Report name"
                          value={renaming.name}
                          maxLength={120}
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                          onChange={(e) => {
                            setRenaming({ id: r.id, name: e.target.value });
                          }}
                        />
                        <Button type="submit" variant="primary">
                          Save
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setRenaming(null);
                          }}
                        >
                          Cancel
                        </Button>
                      </form>
                    </td>
                  ) : deleting === r.id ? (
                    <td colSpan={6}>
                      <div className={styles.row}>
                        <Text size="sm">
                          Delete “{r.name}”? Its saved copies are kept.
                        </Text>
                        <Button
                          variant="destructive"
                          onClick={() => {
                            void attempt(async () => {
                              await deleteSavedReport(supabase, r.id);
                              setDeleting(null);
                            }, "Couldn't delete the report.");
                          }}
                        >
                          Yes, delete it
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setDeleting(null);
                          }}
                        >
                          Keep it
                        </Button>
                      </div>
                    </td>
                  ) : (
                    <>
                      <td>
                        <Link to={`${basePath}/reports/saved/${r.id}`}>
                          {r.name}
                        </Link>
                      </td>
                      <td>
                        {parsed.ok
                          ? sourceLabel(parsed.spec.source)
                          : "Unreadable"}
                      </td>
                      <td className={[styles.wide, styles.summary].join(" ")}>
                        {parsed.ok
                          ? specSummary(parsed.spec)
                          : "This report’s definition can’t be read."}
                      </td>
                      <td>
                        <Chip
                          tone={
                            r.visibility === "organisation" ? "info" : "neutral"
                          }
                        >
                          {r.visibility === "organisation"
                            ? "Shared"
                            : "Private"}
                        </Chip>
                      </td>
                      <td className={styles.wide}>
                        {r.updated_at.slice(0, 10)}
                      </td>
                      <td className={styles.actions}>
                        {(canEdit(r, userId, role) ||
                          (canCreate && parsed.ok)) && (
                          <RowMenu
                            label={`Actions for ${r.name}`}
                            items={[
                              ...(canEdit(r, userId, role)
                                ? [
                                    {
                                      label: "Rename",
                                      onSelect: () => {
                                        setRenaming({ id: r.id, name: r.name });
                                      },
                                    },
                                  ]
                                : []),
                              ...(canCreate && parsed.ok
                                ? [
                                    {
                                      label: "Duplicate",
                                      onSelect: () => {
                                        void attempt(async () => {
                                          await createSavedReport(supabase, {
                                            id: crypto.randomUUID(),
                                            orgId,
                                            modelId,
                                            name: `${r.name} (copy)`,
                                            description: r.description,
                                            spec: parsed.spec,
                                            createdBy: userId,
                                          });
                                        }, "Couldn't duplicate the report.");
                                      },
                                    },
                                  ]
                                : []),
                              ...(canEdit(r, userId, role)
                                ? [
                                    {
                                      label: "Delete…",
                                      onSelect: () => {
                                        setDeleting(r.id);
                                      },
                                    },
                                  ]
                                : []),
                            ]}
                          />
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {(capped || (showAll && shown.length > VISIBLE_REPORTS)) && (
            <Button
              variant="ghost"
              onClick={() => {
                setShowAll(!showAll);
              }}
            >
              {showAll ? "Show fewer" : `Show all ${String(shown.length)}`}
            </Button>
          )}
        </div>
      )}
      {copies.length > 0 && (
        <>
          <Text as="h2" size="lg">
            Saved copies
          </Text>
          <ul className={styles.list}>
            {copies.map((c) => (
              <li key={c.id} className={styles.item}>
                <Link to={`${basePath}/reports/copies/${c.id}`}>{c.name}</Link>{" "}
                <Text size="sm" tone="muted">
                  {copyLabel(c.generated_at, c.commit_id)} · {c.row_count}{" "}
                  {c.row_count === 1 ? "row" : "rows"}
                </Text>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
