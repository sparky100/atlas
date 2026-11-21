import { useEffect, useState } from 'react';

/** Use one semantic representation at a time: tables on wide screens, cards on narrow ones. */
export function useCompactDecisionLayout(): boolean {
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 800px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 800px)');
    const update = () => { setCompact(media.matches); };
    update();
    media.addEventListener('change', update);
    return () => { media.removeEventListener('change', update); };
  }, []);
  return compact;
}
