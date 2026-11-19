import { useNavigate } from 'react-router';
import type { UUID } from '../../contracts/delta';
import type { BeforeAfterColumn } from './projectBeforeAfterModel';
import { layoutProjectDiagram, type DiagramNode } from './projectDiagramLayout';
import styles from './ProjectDiagram.module.css';

export interface ProjectDiagramProps {
  capability: { id: UUID; name: string };
  column: BeforeAfterColumn;
  base: string;
}

function classes(...names: (string | false | undefined)[]): string {
  return names.filter((n): n is string => typeof n === 'string').join(' ');
}

function shortLabel(text: string): string {
  return text.length > 36 ? `${text.slice(0, 35)}…` : text;
}

function curve(x1: number, y1: number, x2: number, y2: number): string {
  const mid = (x1 + x2) / 2;
  const pt = (x: number, y: number) => [x, y].join(' ');
  return ['M', pt(x1, y1), 'C', pt(mid, y1) + ',', pt(mid, y2) + ',', pt(x2, y2)].join(' ');
}

function NodeBox({ node, href, onOpen }: { node: DiagramNode; href: string; onOpen: (href: string) => void }) {
  const label = node.caption ? `${node.name} (${node.caption})` : node.name;
  return (
    <a
      href={href}
      aria-label={label}
      onClick={(e) => {
        e.preventDefault();
        onOpen(href);
      }}
    >
      <rect className={classes(styles.node, styles[node.kind], node.mark === 'new' && styles.markNew, node.mark === 'ends' && styles.markEnds)} x={node.x} y={node.y} width={node.width} height={node.height} rx={6} />
      <text className={styles.nodeName} x={node.x + 10} y={node.y + (node.caption ? 20 : 29)}>
        {node.name.length > 28 ? `${node.name.slice(0, 27)}…` : node.name}
      </text>
      {node.caption && (
        <text className={styles.nodeCaption} x={node.x + 10} y={node.y + 38}>
          {node.caption}
        </text>
      )}
    </a>
  );
}

/**
 * Plan B1, step 2: the capability, the systems that support it and the apps
 * and integrations they connect to, drawn left to right for one column
 * (Today, or After a change). A pure layout of what the model says, nothing
 * stored. New things are marked "New" and ending things "Ends" in words and
 * a dashed line, never colour alone. Wide diagrams scroll sideways inside
 * their own box; the lists beside it carry the same facts for a small screen.
 */
export function ProjectDiagram({ capability, column, base }: ProjectDiagramProps) {
  const navigate = useNavigate();
  const layout = layoutProjectDiagram(capability, column);
  const hrefOf = (n: DiagramNode) => `${base}/e/${n.elementId}`;
  const open = (href: string) => {
    void navigate(href);
  };
  const byKey = new Map(layout.nodes.map((n) => [n.key, n]));

  return (
    <figure className={styles.figure} data-testid="project-diagram">
      <figcaption className={styles.caption}>{column.title}</figcaption>
      <div className={styles.scroll}>
        <svg className={styles.svg} viewBox={['-4', '-4', String(layout.width + 8), String(layout.height + 8)].join(' ')} role="group" aria-label={`${column.title}: ${capability.name}, its supporting systems and their connections`} style={{ minWidth: Math.min(layout.width, 720) }}>
          {layout.edges.map((e) => (
            <path key={e.key} className={classes(styles.edge, e.mark === 'ends' && styles.edgeEnds, e.mark === 'new' && styles.edgeNew)} d={curve(e.x1, e.y1, e.x2, e.y2)} />
          ))}
          {layout.edges.map(
            (e) =>
              e.label !== null && (
                <text key={`${e.key}:label`} className={styles.edgeLabel} x={e.labelX} y={e.labelY - 3} textAnchor="start">
                  {shortLabel(e.mark === 'same' ? e.label : `${e.label} (${e.mark === 'new' ? 'new' : 'ends'})`)}
                </text>
              ),
          )}
          {layout.nodes.map((n) => {
            const node = byKey.get(n.key);
            return node ? <NodeBox key={n.key} node={node} href={hrefOf(node)} onOpen={open} /> : null;
          })}
        </svg>
      </div>
      <p className={styles.hint}>Wide picture: scroll sideways. The List view carries the same facts.</p>
    </figure>
  );
}
