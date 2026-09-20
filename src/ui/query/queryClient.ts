import { QueryClient } from '@tanstack/react-query';

/**
 * E8 item (1)'s own shared data layer: one `QueryClient` for the whole
 * app (mounted once in main.tsx), replacing the per-hook `useEffect` +
 * `useState` fetch-on-mount pattern every org/model/branch/membership/
 * profile hook used before this — see `src/ui/query/keys.ts`'s own module
 * comment for the query-key scheme every hook in this directory shares.
 *
 * `staleTime` here is deliberately non-zero: this data (an organisation,
 * a model, a membership row) barely ever changes from underneath the
 * viewer within a session — the one thing that reliably *does* change,
 * `main`'s own `head_commit_id` on every commit, is invalidated
 * explicitly (`invalidateModelHead.ts`), not discovered by polling or a
 * zero staleTime forcing a re-fetch on every remount. A non-zero
 * staleTime is what actually stops two pages mounting the same query
 * seconds apart from each issuing their own request — the exact
 * duplication E8 item (1) exists to remove.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});
