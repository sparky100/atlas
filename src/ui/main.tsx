import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './auth/AuthProvider';
import { queryClient } from './query/queryClient';
import { ThemedApp } from './ThemedApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element not found');

createRoot(container).render(
  <StrictMode>
    {/* E8 item (1): the one shared data-layer cache for the whole app — see queryClient.ts's own comment. Outermost, alongside AuthProvider, since it needs no router context (unlike SelectedRefProvider, mounted inside BrowserRouter in App.tsx). */}
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemedApp />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
