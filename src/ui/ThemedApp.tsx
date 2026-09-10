import { App } from './App';
import { useAuth } from './auth/useAuth';
import { ErrorBanner } from './components/ErrorBanner/ErrorBanner';
import { ThemeProvider } from './theme/ThemeProvider';

/** Bridges auth state into ThemeProvider's `userId` prop — must be a child of AuthProvider to call useAuth(). Its own file so main.tsx (the entry point, no exports) stays a plain bootstrap script. */
export function ThemedApp() {
  const { userId } = useAuth();
  return (
    <ThemeProvider userId={userId}>
      {/* Sprint U4-2a item 2: one global host for every route, rather than each of the ~14 model-scoped pages rendering its own — see ErrorBanner.tsx's own module comment. */}
      <ErrorBanner />
      <App />
    </ThemeProvider>
  );
}
