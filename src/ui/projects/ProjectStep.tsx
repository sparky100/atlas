import { useState, type ReactNode } from 'react';
import { Text } from '../components/Text/Text';
import styles from './ProjectStep.module.css';

export interface ProjectStepProps {
  /** Stable key within the project page ("scope", "decisions", "changes"…): with `projectId` it names where the open/closed choice is remembered. */
  stepKey: string;
  projectId: string;
  title: string;
  /** One line shown beside the title while collapsed or open ("3 capabilities", "1 proposed, 1 accepted"). */
  summary: string;
  /** Used until the person has opened or closed the step themselves: open when it needs action. */
  defaultOpen: boolean;
  children: ReactNode;
}

function storageName(projectId: string, stepKey: string): string {
  return `atlas.projectStep.${projectId}.${stepKey}`;
}

function readRemembered(projectId: string, stepKey: string): boolean | null {
  try {
    const value = window.localStorage.getItem(storageName(projectId, stepKey));
    return value === 'open' ? true : value === 'closed' ? false : null;
  } catch {
    return null;
  }
}

/**
 * One step of the project page: a heading whose button opens and closes its
 * content. The choice is remembered per person, per project and step (in this
 * browser); until then it starts open only when the step needs action. The
 * heading stays a real heading, with the toggle inside it.
 */
export function ProjectStep({ stepKey, projectId, title, summary, defaultOpen, children }: ProjectStepProps) {
  const [open, setOpen] = useState<boolean>(() => readRemembered(projectId, stepKey) ?? defaultOpen);
  const contentId = `project-step-${stepKey}`;
  return (
    <>
      <Text as="h2" size="lg">
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => {
            const next = !open;
            setOpen(next);
            try {
              window.localStorage.setItem(storageName(projectId, stepKey), next ? 'open' : 'closed');
            } catch {
              // Not remembered when storage is unavailable; the toggle still works.
            }
          }}
        >
          <span aria-hidden="true">{open ? '▾' : '▸'}</span> {title}
          <span className={styles.summary}> · {summary}</span>
        </button>
      </Text>
      {open && (
        <div id={contentId} className={styles.content}>
          {children}
        </div>
      )}
    </>
  );
}
