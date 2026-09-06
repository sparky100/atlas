import type { Meta, StoryObj } from '@storybook/react-vite';
import { Panel } from './Panel';
import { Text } from '../Text/Text';

const meta = {
  title: 'Foundations/Panel',
  component: Panel,
  parameters: { layout: 'padded' },
  args: { children: 'Content' },
} satisfies Meta<typeof Panel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Flat: Story = {
  render: () => (
    <Panel>
      <Text size="lg" as="h2">
        Attributes
      </Text>
      <Text tone="muted">A flat panel — bordered, no shadow. Used inside an already-bordered region.</Text>
    </Panel>
  ),
};

export const Raised: Story = {
  render: () => (
    <div style={{ background: 'var(--bg-subtle)', padding: 'var(--space-6)' }}>
      <Panel raised>
        <Text size="lg" as="h2">
          Review queue
        </Text>
        <Text tone="muted">A raised panel floating over page content — the queue pane, a peek sheet, a dashboard card.</Text>
      </Panel>
    </div>
  ),
};
