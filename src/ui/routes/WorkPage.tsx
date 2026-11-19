import { Link, useParams } from 'react-router';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { Button } from '../components/Button/Button';
import { Loading } from '../components/Loading/Loading';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { PageIntro } from '../components/PageIntro/PageIntro';
import { Text } from '../components/Text/Text';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { useBranchLabel } from '../branches/useBranchLabel';
import { useSelectedRef } from '../branches/useSelectedRef';
import { refLabelOf } from '../../db/ref';
import { useModels } from '../models/useModels';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { useReviewQueueCount } from '../reviews/useReviewQueueCount';
import { WORK_COPY } from '../work/workCopy';
import { useWorkLists } from '../work/useWorkLists';
import type { WorkListItem } from '../work/workLists';
import styles from './ViewPage.module.css';
import workStyles from './WorkPage.module.css';

/**
 * The Work overview (`/work`): what needs doing and what is being done, in one place. Explains the three kinds of work in a sentence each, offers one "Start something" choice between them, and shows how many items are waiting for review. Reached from the "Work" caption in the nav rail. Every card is a plain link to the page that already exists — nothing here writes anything.
 */
export function WorkPage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const { ref } = useSelectedRef();
  const { label: branchLabel } = useBranchLabel(ref);
  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const waiting = useReviewQueueCount(model?.id ?? null);
  const lists = useWorkLists(model?.id ?? null);

  if (orgLoading || modelsLoading || !model) {
    return (
      <div>
        <AppHeader orgId={organisation?.id ?? null} />
        <div className={navStyles.body}>
          <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
          <main className={styles.main}>
            <Loading />
          </main>
        </div>
      </div>
    );
  }

  const base = `/o/${orgSlug ?? ''}/m/${model.slug}`;
  const cards: { title: string; line: string; href: string; extra?: string | undefined; items?: WorkListItem[] | undefined; itemBase?: string; emptyText?: string }[] = [
    { title: 'Waiting for review', line: WORK_COPY.review, href: `${base}/review`, extra: waiting === null ? undefined : waiting === 0 ? 'Nothing waiting' : `${String(waiting)} waiting` },
    { title: 'Projects', line: WORK_COPY.project, href: `${base}/projects`, items: lists?.projects, itemBase: `${base}/projects`, emptyText: 'No open projects.' },
    { title: 'Decisions', line: WORK_COPY.decision, href: `${base}/decisions`, items: lists?.decisions, itemBase: `${base}/decisions`, emptyText: 'No open decisions outside a project.' },
    { title: 'Changes', line: WORK_COPY.change, href: `${base}/changes`, items: lists?.changes, itemBase: `${base}/changes`, emptyText: 'No open changes outside a decision or project.' },
  ];

  return (
    <div>
      <AppHeader orgId={organisation?.id ?? null} />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={styles.main}>
          <EditingBranchBanner activeRef={ref} modelId={model.id} orgSlug={orgSlug ?? ''} modelSlug={model.slug} showModeShortcuts={false} />
          <Breadcrumb org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }} model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }} refLabel={refLabelOf(ref, branchLabel)} />
          <div className={styles.header}>
            <Text as="h1" size="2xl">
              Work
            </Text>
          </div>
          <PageIntro>What needs doing, and what is being done.</PageIntro>
          <section aria-label="Start something" className={workStyles.start}>
            <Text as="h2" size="lg">
              Start something
            </Text>
            <div className={workStyles.startButtons}>
              <Link to={`${base}/projects`}>
                <Button variant="secondary">Start a project</Button>
              </Link>
              <Link to={`${base}/decisions`}>
                <Button variant="secondary">Compare options (decision)</Button>
              </Link>
              <Link to={`${base}/changes`}>
                <Button variant="primary">Make a change</Button>
              </Link>
            </div>
            <Text as="p" size="sm" tone="muted">
              Not sure which? Start a project to keep several decisions or changes together. Compare options if you are still choosing. Make a change if you already know the edit.
            </Text>
          </section>
          <ul className={workStyles.cards}>
            {cards.map((card) => (
              <li key={card.title} className={workStyles.card} data-testid={`work-card-${card.title.toLowerCase().replace(/ /g, '-')}`}>
                <Link to={card.href} className={workStyles.cardLink}>
                  <Text as="h2" size="md">
                    {card.title}
                    {card.items !== undefined && ` (${String(card.items.length)})`}
                  </Text>
                  <Text as="p" size="sm" tone="muted">
                    {card.line}
                  </Text>
                  {card.extra && (
                    <Text as="p" size="sm">
                      {card.extra}
                    </Text>
                  )}
                </Link>
                {card.itemBase !== undefined && card.items !== undefined && (
                  <div className={workStyles.items}>
                    {card.items.length === 0 ? (
                      <Text as="p" size="sm" tone="muted">
                        {card.emptyText}
                      </Text>
                    ) : (
                      <ul className={workStyles.itemList}>
                        {card.items.slice(0, 5).map((item) => (
                          <li key={item.id} className={workStyles.item}>
                            <Link to={`${card.itemBase ?? ''}/${item.id}`}>{item.title}</Link>
                            <Text as="span" size="xs" tone="faint">
                              {item.status}
                            </Text>
                          </li>
                        ))}
                      </ul>
                    )}
                    {card.items.length > 5 && <Link to={card.href}>{`See all ${String(card.items.length)}`}</Link>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </main>
      </div>
    </div>
  );
}
