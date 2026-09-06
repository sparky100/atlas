import type { Meta, StoryObj } from '@storybook/react-vite';
import { ThemeDensityToggle } from './ThemeDensityToggle';
import { ThemeProvider } from '../../theme/ThemeProvider';

const meta = {
  title: 'Foundations/ThemeDensityToggle',
  component: ThemeDensityToggle,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <ThemeProvider>
        <Story />
      </ThemeProvider>
    ),
  ],
} satisfies Meta<typeof ThemeDensityToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
