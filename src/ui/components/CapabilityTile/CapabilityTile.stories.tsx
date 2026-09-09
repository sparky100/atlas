import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router';
import { CapabilityTile } from './CapabilityTile';

const meta = {
  title: 'Foundations/CapabilityTile',
  component: CapabilityTile,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <MemoryRouter>{Story()}</MemoryRouter>],
  args: { href: '/e/1', name: 'Finance', tone: undefined, toneLabel: undefined },
} satisfies Meta<typeof CapabilityTile>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoColourBy: Story = {
  name: 'colour-by off — frame and name only',
  render: (args) => (
    <div style={{ maxWidth: 240 }}>
      <CapabilityTile {...args} />
    </div>
  ),
};

export const CoverageWarn: Story = {
  name: 'coverage, warn (no supporting systems)',
  args: { tone: 'warn', toneLabel: '0 supporting systems' },
  render: (args) => (
    <div style={{ maxWidth: 240 }}>
      <CapabilityTile {...args} />
    </div>
  ),
};

export const ExposureDanger: Story = {
  name: 'lifecycle exposure, danger',
  args: { name: 'Adult Social Care', tone: 'danger', toneLabel: 'exposed' },
  render: (args) => (
    <div style={{ maxWidth: 240 }}>
      <CapabilityTile {...args} />
    </div>
  ),
};

export const WithSecondaryControls: Story = {
  name: 'with secondary controls (a zoom link, buttons) — the whole tile is still one click target',
  args: { name: 'Network Operations', tone: 'neutral', toneLabel: '3 supporting systems' },
  render: (args) => (
    <div style={{ maxWidth: 260 }}>
      <CapabilityTile {...args}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
          <a href="/landscape">3 systems →</a>
          <button type="button">▸ 2</button>
        </div>
      </CapabilityTile>
    </div>
  ),
};

export const Compact: Story = {
  name: 'compact size — L3, revealed on expand',
  args: { name: 'Repairs', tone: 'ok', toneLabel: '2 supporting systems', size: 'compact' },
  render: (args) => (
    <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      <div style={{ width: 200 }}>
        <CapabilityTile {...args} />
      </div>
      <div style={{ width: 200 }}>
        <CapabilityTile {...args} name="Voids" tone="neutral" toneLabel="1 supporting system" />
      </div>
    </div>
  ),
};
