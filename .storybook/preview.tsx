import type { Preview } from '@storybook/react-vite';
import { useEffect } from 'react';
import '../src/ui/styles/tokens.css';
import '../src/ui/styles/global.css';

// Every story reviews against the real design tokens, not Storybook's own
// theme — the toolbar controls below just set the same data-theme/
// data-density attributes the app itself sets (src/ui/theme/preferences.ts),
// so what's shown here is exactly tokens.css's cascade, unmodified.

const preview: Preview = {
  parameters: {
    layout: 'centered',
    a11y: {
      // WCAG 2.2 AA is a stated requirement (UI-principles.md §8.7) —
      // violations fail the check, they don't just get logged.
      test: 'error',
    },
  },
  globalTypes: {
    theme: {
      description: 'Theme',
      toolbar: {
        icon: 'circlehollow',
        items: [
          { value: 'light', icon: 'sun', title: 'Light' },
          { value: 'dark', icon: 'moon', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
    density: {
      description: 'Density',
      toolbar: {
        icon: 'ruler',
        items: [
          { value: 'comfortable', title: 'Comfortable' },
          { value: 'compact', title: 'Compact' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: 'light',
    density: 'comfortable',
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme as 'light' | 'dark';
      const density = context.globals.density as 'comfortable' | 'compact';
      useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        document.documentElement.setAttribute('data-density', density);
      }, [theme, density]);
      return <Story />;
    },
  ],
};

export default preview;
