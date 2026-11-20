import { Link } from 'react-router';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { LinkButton } from '../components/Button/LinkButton';
import { bandAction, type CapabilityProblem } from './capabilityProblems';
import styles from './CapabilityProblemsBand.module.css';

const MAX_SHOWN = 3;

export interface CapabilityProblemsBandProps {
  problems: readonly CapabilityProblem[];
  /** Where a system named in an item opens. */
  systemHref: (systemId: string) => string;
  /** "Start a project" / "Propose a project" link with this capability as scope; `null` when this role may not start one. */
  startProjectHref: string | null;
  startProjectLabel: string;
  /** The Fill in walk, for a band that is only missing facts; `null` when this role may not edit. */
  fillInHref: string | null;
}

/**
 * "What needs attention": at the top of a capability page, only when there is something to say. One plain sentence per
 * problem, then one visible button whose label follows the problem. A viewer sees the band and who can act.
 */
export function CapabilityProblemsBand({ problems, systemHref, startProjectHref, startProjectLabel, fillInHref }: CapabilityProblemsBandProps) {
  const action = bandAction(problems);
  if (action === null) return null;
  const shown = problems.slice(0, MAX_SHOWN);
  const more = problems.length - shown.length;
  return (
    <Panel data-testid="capability-problems">
      <Text as="h2" size="lg">
        What needs attention
      </Text>
      <ul className={styles.list}>
        {shown.map((p, i) => (
          <li key={`${p.kind}-${p.systemId ?? 'none'}-${String(i)}`}>
            <Text as="span">
              {p.systemId !== null ? <ProblemText problem={p} systemHref={systemHref} /> : p.text}
            </Text>
            {p.reason !== null && (
              <Text as="span" tone="muted" size="sm">
                {' '}
                &ldquo;{p.reason}&rdquo;
              </Text>
            )}
          </li>
        ))}
      </ul>
      {more > 0 && (
        <Text as="p" tone="muted" size="sm">
          {more} more
        </Text>
      )}
      {action === 'project' && startProjectHref !== null && <LinkButton to={startProjectHref}>{startProjectLabel}</LinkButton>}
      {action === 'project' && startProjectHref === null && (
        <Text as="p" tone="muted" size="sm">
          A contributor, architect or owner can start a project from here.
        </Text>
      )}
      {action === 'fill-in' && fillInHref !== null && <LinkButton to={fillInHref}>Fill in what is missing</LinkButton>}
    </Panel>
  );
}

/** The sentence with the system's name as a link, so the person can open it from the problem. */
function ProblemText({ problem, systemHref }: { problem: CapabilityProblem; systemHref: (systemId: string) => string }) {
  if (problem.systemId === null || problem.systemName === null) return <>{problem.text}</>;
  const at = problem.text.indexOf(problem.systemName);
  if (at < 0) return <>{problem.text}</>;
  return (
    <>
      {problem.text.slice(0, at)}
      <Link to={systemHref(problem.systemId)}>{problem.systemName}</Link>
      {problem.text.slice(at + problem.systemName.length)}
    </>
  );
}
