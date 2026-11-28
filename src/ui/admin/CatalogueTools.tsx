import { useCallback, useState, type ReactNode } from 'react';
import { CatalogueClaimChecks } from './CatalogueClaimChecks';
import { CatalogueFindPlatforms } from './CatalogueFindPlatforms';
import { CatalogueFindProducts } from './CatalogueFindProducts';
import { CatalogueMonthlyCheck } from './CatalogueMonthlyCheck';
import { CatalogueSetProducts } from './CatalogueSetProducts';
import { CatalogueSourceLinks } from './CatalogueSourceLinks';
import { ReviewSection } from './ReviewSection';
import { useReviewSections } from './useReviewSections';
import styles from './CatalogueAdmin.module.css';

/**
 * `/platform-admin/catalogue/tools` — the tools that search the web and check
 * sources: the monthly check, checking links and claims, and finding products.
 * They only run and report; what they find, and what they could not confirm,
 * waits on Waiting for review for a person to decide. Same blocks as that
 * page, opening and closing the same way.
 */
export function CatalogueTools() {
  const sections = useReviewSections([], { openFirst: 'monthly' });
  const [runsVersion, setRunsVersion] = useState(0);
  const recordRun = useCallback(() => { setRunsVersion((version) => version + 1); }, []);
  const block = (id: string, title: string, hint: string, children: ReactNode) => (
    <ReviewSection id={id} title={title} hint={hint} open={sections.isOpen(id)} onToggle={(open) => { sections.toggle(id, open); }}>
      {children}
    </ReviewSection>
  );
  return (
    <div className={styles.page} data-testid="catalogue-tools">
      <div className={styles.sections}>
        {block('monthly', 'Monthly check', 'Re-checks every source link and claim once a month. Starts switched off.',
          <CatalogueMonthlyCheck refreshKey={runsVersion} />)}
        {block('checks', 'Check source links and claims', 'Reads each cited page, then asks the AI whether the claim still stands. Anything it cannot confirm goes to Waiting for review.', (
          <>
            <CatalogueSourceLinks part="run" onRunRecorded={recordRun} />
            <CatalogueClaimChecks part="run" onRunRecorded={recordRun} />
          </>
        ))}
        {block('find-platforms', 'Find the main platforms for a sector', 'Start from the platforms a sector runs, then find their modules. You choose which to add; everything found is a draft.',
          <CatalogueFindPlatforms onRunRecorded={recordRun} />)}
        {block('find-products', 'Find new products', 'Search the public web for products that meet a capability. Every product found is a draft for a person to review.',
          <CatalogueFindProducts onRunRecorded={recordRun} />)}
        {block('set-products', 'Find products for a set', 'Propose links from products already in the library, and search for the capabilities that have none.',
          <CatalogueSetProducts onRunRecorded={recordRun} onChanged={() => undefined} />)}
      </div>
    </div>
  );
}
