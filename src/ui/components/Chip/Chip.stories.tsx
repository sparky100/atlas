import type { Meta, StoryObj } from '@storybook/react-vite';
import { Chip } from './Chip';

const meta = {
  title: 'Foundations/Chip',
  component: Chip,
  parameters: { layout: 'padded' },
  args: { children: 'active' },
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tones: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      <Chip tone="ok">active</Chip>
      <Chip tone="warn">retiring</Chip>
      <Chip tone="danger">rejected</Chip>
      <Chip tone="info">in_review</Chip>
      <Chip tone="neutral">archived</Chip>
    </div>
  ),
};

export const LifecycleExamples: Story = {
  name: 'Real usage (lifecycle + exposure)',
  render: () => (
    <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      <Chip tone="ok">active</Chip>
      <Chip tone="warn">retiring</Chip>
      <Chip tone="neutral">retired</Chip>
      <Chip tone="danger">no planned replacement</Chip>
    </div>
  ),
};
