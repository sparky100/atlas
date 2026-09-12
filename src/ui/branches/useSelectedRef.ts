import { useContext } from 'react';
import { SelectedRefContext, type SelectedRefContextValue } from './selectedRefContext';

/** The current model's selected ref (`SelectedRefProvider.tsx`) — main, unless a change branch is selected for this model this session. Every model-scoped page reads it from here, not from its own `useSearchParams` parse. */
export function useSelectedRef(): SelectedRefContextValue {
  const ctx = useContext(SelectedRefContext);
  if (!ctx) throw new Error('useSelectedRef must be used within a SelectedRefProvider');
  return ctx;
}
