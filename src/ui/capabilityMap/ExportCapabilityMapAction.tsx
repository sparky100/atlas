import { useId, useState } from 'react';
import { SECTORS, type Sector } from '../../contracts/capabilityMapContent';
import type { UUID } from '../../contracts/delta';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { useExportCapabilityMap } from './useExportCapabilityMap';
import styles from './ExportCapabilityMapAction.module.css';

export interface ExportCapabilityMapActionProps {
  modelId: UUID;
  modelName: string;
  orgName: string;
  orgSlug: string;
  modelSlug: string;
  userId: UUID | null;
}

/**
 * Sprint U4-1 C6's owner-only "Export as starter map" action. `ghost`, not
 * `primary`/`secondary` — same reasoning as `SyncDescriptionsAction.tsx`'s
 * own comment: a maintenance affordance, not part of the map's normal
 * workflow. Sector and version are the two things `useExportCapabilityMap`
 * can't infer on its own (everything else — the model, org, its own main
 * head — is already known); a version defaults to `1`, since exporting a
 * genuinely new sector for the first time is the common case, but nothing
 * stops picking a later one to refresh an existing draft.
 */
export function ExportCapabilityMapAction({ modelId, modelName, orgName, orgSlug, modelSlug, userId }: ExportCapabilityMapActionProps) {
  const [open, setOpen] = useState(false);
  const [sector, setSector] = useState<Sector>(SECTORS[0]);
  const [version, setVersion] = useState('1');
  const sectorId = useId();
  const versionId = useId();

  const { status, message, error, exportAsDraft } = useExportCapabilityMap({ modelId, modelName, orgName, orgSlug, modelSlug, userId });

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => { setOpen(true); }}>
        Export as starter map
      </Button>
    );
  }

  const parsedVersion = Number(version);
  const versionIsValid = Number.isInteger(parsedVersion) && parsedVersion > 0;

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (versionIsValid) void exportAsDraft(sector, parsedVersion);
      }}
    >
      <label htmlFor={sectorId}>
        <Text as="span" size="sm" tone="muted">
          Sector
        </Text>
      </label>
      <select id={sectorId} className={styles.select} value={sector} onChange={(e) => { setSector(e.target.value as Sector); }}>
        {SECTORS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <label htmlFor={versionId}>
        <Text as="span" size="sm" tone="muted">
          Version
        </Text>
      </label>
      <input id={versionId} className={styles.input} type="number" min={1} step={1} value={version} onChange={(e) => { setVersion(e.target.value); }} />
      <Button variant="primary" type="submit" disabled={status === 'exporting' || !versionIsValid}>
        {status === 'exporting' ? 'Exporting…' : 'Export'}
      </Button>
      <Button variant="ghost" type="button" onClick={() => { setOpen(false); }}>
        Cancel
      </Button>
      {message !== null && (
        <Text as="p" tone="muted" size="sm">
          {message}
        </Text>
      )}
      {error !== null && (
        <Text as="p" size="sm">
          {error}
        </Text>
      )}
    </form>
  );
}
