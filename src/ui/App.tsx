import { Text } from './components/Text/Text';
import { ThemeDensityToggle } from './components/ThemeDensityToggle/ThemeDensityToggle';

/**
 * Placeholder root, honestly labelled as one (CLAUDE.md rule 7: an unbuilt
 * feature is absent, not faked). Auth, the organisation switcher, and the
 * model list are Sprint U1 step 2 — there is no login form or fake org data
 * here standing in for them.
 */
export function App() {
  return (
    <main style={{ padding: 'var(--space-8)', maxWidth: 640 }}>
      <Text as="h1" size="2xl">
        Atlas
      </Text>
      <Text as="p" tone="muted">
        Sprint U1 step 1: design tokens and base components. Auth, the organisation switcher, and the model list are not built
        yet — see Storybook for the primitives this step delivers.
      </Text>
      <div style={{ marginTop: 'var(--space-6)' }}>
        <ThemeDensityToggle />
      </div>
    </main>
  );
}
