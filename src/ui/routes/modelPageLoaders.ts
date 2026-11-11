export const loadModelPage = {
  elements: () => import('./ElementsPage'),
  portfolio: () => import('./PortfolioPage'),
};

/** Start downloading likely next pages only when the user points at or focuses their link. */
export function prefetchModelPage(section: string): void {
  if (section === 'elements') void loadModelPage.elements().catch(() => undefined);
  if (section === 'portfolio') void loadModelPage.portfolio().catch(() => undefined);
}
