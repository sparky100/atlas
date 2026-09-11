import { createContext } from 'react';
import type { Ref } from '../../db/ref';

export interface SelectedRefContextValue {
  /** The ref every model-scoped page should read and act on — never each page's own raw `useSearchParams` parse (see `SelectedRefProvider.tsx`'s own module comment for why that used to lose the selection). */
  ref: Ref;
  /** Selects a ref for the current model — updates the URL's own `?ref=` and this session's persisted choice for this model together. */
  setRef: (ref: Ref) => void;
  /** Clears back to main — the only way to leave a change (Prompt 7i item 2's "Back to main"). */
  clearRef: () => void;
}

export const SelectedRefContext = createContext<SelectedRefContextValue | null>(null);
