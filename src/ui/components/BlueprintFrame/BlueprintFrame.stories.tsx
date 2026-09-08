import type { Meta, StoryObj } from '@storybook/react-vite';
import { Chip } from '../Chip/Chip';
import { Text } from '../Text/Text';
import { BlueprintFrame } from './BlueprintFrame';

const meta = {
  title: 'Foundations/BlueprintFrame',
  component: BlueprintFrame,
  parameters: { layout: 'padded' },
  args: { children: null },
} satisfies Meta<typeof BlueprintFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div style={{ maxWidth: 220 }}>
      <BlueprintFrame>
        <Chip tone="warn">lifecycle exposure</Chip>
        <Text as="p" size="lg">
          Revenues &amp; Benefits
        </Text>
        <Text as="p" tone="muted" size="sm">
          Northgate Revenues — retiring
        </Text>
      </BlueprintFrame>
    </div>
  ),
};

export const ExposedVsHealthy: Story = {
  name: 'Exposed (framed) vs healthy (hairline) — Handoff 7d\'s two tile treatments side by side',
  render: () => (
    <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
      <div style={{ width: 200 }}>
        <BlueprintFrame>
          <Chip tone="warn">exposed</Chip>
          <Text as="p" size="lg">
            Exposed capability
          </Text>
        </BlueprintFrame>
      </div>
      <div style={{ width: 200, border: 'var(--border-width) solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-2)' }}>
        <Chip tone="ok">healthy</Chip>
        <Text as="p" size="lg">
          Healthy capability
        </Text>
      </div>
    </div>
  ),
};

export const ReplacementPlanned: Story = {
  name: 'info tone (replacement planned)',
  render: () => (
    <div style={{ maxWidth: 220 }}>
      <BlueprintFrame>
        <Chip tone="info">replacement planned</Chip>
        <Text as="p" size="lg">
          Adult Social Care
        </Text>
        <Text as="p" tone="muted" size="sm">
          Legacy Case System — retiring, approved replacement in delivery
        </Text>
      </BlueprintFrame>
    </div>
  ),
};
