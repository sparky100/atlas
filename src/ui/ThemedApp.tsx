import { App } from './App';
import { useAuth } from './auth/useAuth';
import { ThemeProvider } from './theme/ThemeProvider';

/** Bridges auth state into ThemeProvider's `userId` prop — must be a child of AuthProvider to call useAuth(). Its own file so main.tsx (the entry point, no exports) stays a plain bootstrap script. */
export function ThemedApp() {
  const { userId } = useAuth();
  return (
    <ThemeProvider userId={userId}>
      <App />
    </ThemeProvider>
  );
}
