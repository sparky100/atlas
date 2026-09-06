import type { Meta, StoryObj } from '@storybook/react-vite';
import { CollapsibleSection } from './CollapsibleSection';
import { Text } from '../Text/Text';

const meta = {
  title: 'Foundations/CollapsibleSection',
  component: CollapsibleSection,
  parameters: { layout: 'padded' },
  args: { title: 'Section', children: 'Content' },
} satisfies Meta<typeof CollapsibleSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ElementPageSections: Story = {
  render: () => (
    <div style={{ maxWidth: 480 }}>
      <CollapsibleSection title="Attributes">
        <Text tone="muted">Vendor, lifecycle, owner — one row per type_schemas attribute.</Text>
      </CollapsibleSection>
      <CollapsibleSection title="Relationships" meta="(4)">
        <Text tone="muted">uses (3), used by (1)</Text>
      </CollapsibleSection>
      <CollapsibleSection title="Comments" meta="2 unresolved" defaultOpen={false}>
        <Text tone="muted">Thread content goes here.</Text>
      </CollapsibleSection>
    </div>
  ),
};
