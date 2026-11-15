import type { UUID } from '../../contracts/delta';
import type { ProjectManagerValue } from './projectManagerValue';

const OTHER = '__other__';

/**
 * Project manager: pick an Atlas member, or type a name for someone who
 * isn't an Atlas user. Optional.
 */
export function ProjectManagerField({
  value,
  members,
  onChange,
  selectClassName,
  inputClassName,
}: {
  value: ProjectManagerValue;
  members: { id: UUID; label: string }[];
  onChange: (next: ProjectManagerValue) => void;
  selectClassName: string | undefined;
  inputClassName: string | undefined;
}) {
  const selected = value.typing ? OTHER : (value.managerId ?? '');
  return (
    <>
      <select
        className={selectClassName}
        aria-label="Project manager"
        value={selected}
        onChange={(e) => {
          const v = e.target.value;
          if (v === OTHER) onChange({ managerId: null, managerName: value.managerName, typing: true });
          else onChange({ managerId: v === '' ? null : v, managerName: '', typing: false });
        }}
      >
        <option value="">No project manager yet</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
        <option value={OTHER}>Someone else (type a name)…</option>
      </select>
      {value.typing && (
        <input
          className={inputClassName}
          type="text"
          aria-label="Project manager name"
          placeholder="Name (not an Atlas user)"
          maxLength={200}
          value={value.managerName}
          onChange={(e) => {
            onChange({ managerId: null, managerName: e.target.value, typing: true });
          }}
        />
      )}
    </>
  );
}
