import type { Meta, StoryObj } from '@storybook/react-vite';
import { Text } from './Text';

const meta = {
  title: 'Foundations/Text',
  component: Text,
  parameters: { layout: 'padded' },
  args: { children: 'Text' },
} satisfies Meta<typeof Text>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Scale: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {(['3xl', '2xl', 'xl', 'lg', 'md', 'sm', 'xs'] as const).map((size) => (
        <Text key={size} size={size}>
          {size} — Housing Options supports 3 capabilities
        </Text>
      ))}
    </div>
  ),
};

export const Tones: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <Text tone="default">default — the primary reading colour</Text>
      <Text tone="muted">muted — secondary text, timestamps, hints</Text>
      <Text tone="faint">faint — the quietest tone still AA-compliant on surface</Text>
    </div>
  ),
};

export const Monospace: Story = {
  render: () => (
    <Text mono tone="muted">
      3f2a9c11-8b4e-4d7a-9c1f-6e0b2a7d5f10
    </Text>
  ),
};
