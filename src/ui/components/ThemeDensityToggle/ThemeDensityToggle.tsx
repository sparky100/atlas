import { useTheme } from '../../theme/useTheme';
import type { DensityPreference, ThemePreference } from '../../theme/preferences';
import styles from './ThemeDensityToggle.module.css';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const DENSITY_OPTIONS: { value: DensityPreference; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
];

/**
 * The user-menu control named in UI-principles.md §3 / §8.8
 * (`⌘/Ctrl+Shift+D` density, `⌘/Ctrl+Shift+L` theme cycle both land here).
 * Switching is instant — ThemeProvider applies the DOM attributes
 * synchronously on every change, no reload needed. Sprint U1 step 2a wires
 * the same `setTheme`/`setDensity` calls to also persist to
 * `user_preferences`; this component doesn't change shape for that.
 */
export function ThemeDensityToggle() {
  const { theme, density, setTheme, setDensity } = useTheme();

  return (
    <div className={styles.toggle}>
      <fieldset className={styles.group}>
        <legend className={styles.legend}>Theme</legend>
        <div className={styles.segmented} role="radiogroup" aria-label="Theme">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={theme === option.value}
              className={theme === option.value ? styles.segmentActive : styles.segment}
              onClick={() => {
                setTheme(option.value);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className={styles.group}>
        <legend className={styles.legend}>Density</legend>
        <div className={styles.segmented} role="radiogroup" aria-label="Density">
          {DENSITY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={density === option.value}
              className={density === option.value ? styles.segmentActive : styles.segment}
              onClick={() => {
                setDensity(option.value);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
