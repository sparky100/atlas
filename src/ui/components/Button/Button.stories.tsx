import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button';

const meta = {
  title: 'Foundations/Button',
  component: Button,
  parameters: { layout: 'padded' },
  args: { children: 'Approve' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  render: (args) => (
    <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
      <Button {...args} variant="primary">
        Merge
      </Button>
      <Button {...args} variant="secondary">
        Refresh
      </Button>
      <Button {...args} variant="ghost">
        Cancel
      </Button>
      <Button {...args} variant="destructive">
        Remove
      </Button>
    </div>
  ),
};

export const Disabled: Story = {
  render: (args) => (
    <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
      <Button {...args} variant="primary" disabled title="2 unresolved conflicts">
        Merge
      </Button>
    </div>
  ),
};
