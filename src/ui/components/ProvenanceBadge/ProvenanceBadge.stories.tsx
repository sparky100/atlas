import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProvenanceBadge } from './ProvenanceBadge';
import { Text } from '../Text/Text';

const NOW = new Date('2026-09-06');

function monthsAgo(n: number): Date {
  const d = new Date(NOW);
  d.setMonth(d.getMonth() - n);
  return d;
}

const meta = {
  title: 'Foundations/ProvenanceBadge',
  component: ProvenanceBadge,
  parameters: { layout: 'padded' },
  args: { sourceKind: 'manual', date: NOW, confidence: 1 },
} satisfies Meta<typeof ProvenanceBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllSourceKinds: Story = {
  render: () => (
    <table style={{ borderCollapse: 'collapse' }}>
      <tbody>
        {(
          [
            ['spreadsheet', 2, 0.72],
            ['document', 3, 0.95],
            ['interview', 1, 1],
            ['manual', 0, 1],
            ['capture_job', 5, 0.62],
            ['template', 20, 0.9],
            ['merge_resolution', 14, 1],
          ] as const
        ).map(([kind, age, confidence]) => (
          <tr key={kind}>
            <td style={{ padding: '4px 16px 4px 0' }}>
              <Text>{kind}</Text>
            </td>
            <td style={{ padding: '4px 0' }}>
              <ProvenanceBadge sourceKind={kind} date={monthsAgo(age)} confidence={confidence} now={NOW} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
};

export const StaleVsFresh: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <Text>Fresh (2mo)</Text>
        <ProvenanceBadge sourceKind="manual" date={monthsAgo(2)} confidence={1} now={NOW} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <Text>Stale (14mo, past STALE_AFTER_MONTHS)</Text>
        <ProvenanceBadge sourceKind="spreadsheet" date={monthsAgo(14)} confidence={0.72} now={NOW} />
      </div>
    </div>
  ),
};
