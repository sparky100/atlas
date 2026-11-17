import type { Meta, StoryObj } from '@storybook/react-vite';
import type { AnnualRunCost, Disposition, FitForPurpose } from '../../contracts/delta';
import northbridge from '../../../docs/demo/northbridge-dno.import.json';
import { PortfolioQuadrant } from './PortfolioQuadrant';
import type { QuadrantItem } from './portfolioQuadrantModel';

/*
 * Visual review only: the quadrant over the Northbridge demo file's own
 * top-level systems (their recorded lifecycle, run cost, planned action and
 * fit), so it can be looked at (1280/390) without a database. Story content,
 * never reachable from the app (rule 7). Exposure is not worked out here
 * (it needs links and today's date), so health reads from lifecycle alone.
 */
interface DemoSystem { name: string; platform?: string; lifecycle?: string; annual_run_cost?: string; disposition?: string; fit?: string }
const items: QuadrantItem[] = (northbridge.systems as DemoSystem[])
  .filter((s) => s.platform === undefined)
  .map((s, i) => ({
    id: `s${String(i)}`,
    name: s.name,
    fit: (s.fit as FitForPurpose | undefined) ?? null,
    lifecycle: s.lifecycle ?? null,
    exposed: null,
    cost: (s.annual_run_cost as AnnualRunCost | undefined) ?? null,
    disposition: (s.disposition as Disposition | undefined) ?? null,
  }));

const meta = { title: 'Portfolio/Quadrant', component: PortfolioQuadrant } satisfies Meta<typeof PortfolioQuadrant>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NorthbridgeDemo: Story = { args: { items, hrefFor: () => '#', onShowTable: () => undefined } };
export const NoFitRated: Story = { args: { items: items.map((i) => ({ ...i, fit: null })), hrefFor: () => '#', onShowTable: () => undefined } };
