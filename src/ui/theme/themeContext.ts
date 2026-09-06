import { createContext } from 'react';
import type { DensityPreference, ResolvedTheme, ThemePreference } from './preferences';

export interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  density: DensityPreference;
  setTheme: (theme: ThemePreference) => void;
  setDensity: (density: DensityPreference) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);
