import type { Meta, StoryObj } from '@storybook/react-vite';
import { ConfidenceDots } from './ConfidenceDots';
import { Text } from '../Text/Text';

const meta = {
  title: 'Foundations/ConfidenceDots',
  component: ConfidenceDots,
  parameters: { layout: 'padded' },
  args: { confidence: 1 },
} satisfies Meta<typeof ConfidenceDots>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Bands: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {[1, 0.9, 0.85, 0.7, 0.5, 0.1].map((c) => (
        <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <ConfidenceDots confidence={c} />
          <Text tone="muted" mono>
            {c.toFixed(2)}
          </Text>
        </div>
      ))}
    </div>
  ),
};
