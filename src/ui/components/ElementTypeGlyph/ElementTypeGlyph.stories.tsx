import type { Meta, StoryObj } from '@storybook/react-vite';
import { ElementTypeGlyph } from './ElementTypeGlyph';
import { Text } from '../Text/Text';

const meta = {
  title: 'Foundations/ElementTypeGlyph',
  component: ElementTypeGlyph,
  parameters: { layout: 'padded' },
  args: { type: 'system' },
} satisfies Meta<typeof ElementTypeGlyph>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllTypes: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {(
        [
          { type: 'capability' as const, label: 'Capability' },
          { type: 'system' as const, label: 'System' },
          { type: 'container' as const, label: 'Container' },
          { type: 'actor' as const, actorSubtype: 'person' as const, label: 'Actor · person' },
          { type: 'actor' as const, actorSubtype: 'team' as const, label: 'Actor · team' },
          { type: 'actor' as const, actorSubtype: 'organisation' as const, label: 'Actor · organisation' },
          { type: 'value_stream' as const, label: 'Value stream / stage' },
        ]
      ).map((row) => (
        <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <ElementTypeGlyph type={row.type} {...(row.actorSubtype ? { actorSubtype: row.actorSubtype } : {})} />
          <Text>{row.label}</Text>
        </div>
      ))}
    </div>
  ),
};

export const External: Story = {
  render: () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <ElementTypeGlyph type="system" />
      <Text>Internal system</Text>
      <ElementTypeGlyph type="system" external label="GOV.UK Notify" />
      <Text>External system (dotted outline)</Text>
    </div>
  ),
};
