import { useState } from 'react';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { hasProductOption, productOptionTitle, type ProductForOption } from './addProductOption';

/**
 * What a list of reviewed products needs to turn one into an option: the
 * titles already on the decision (so a product already used says so) and the
 * call that adds it. Absent when the person cannot add options.
 */
export interface MakeProductOptionProps {
  optionTitles: readonly string[];
  /** Resolves with a warning to show, or null when the product was saved with the option. */
  onMake: (product: ProductForOption, optionId: string) => Promise<string | null>;
}

/** "Make it an option" for one reviewed product: one click, no retyping. */
export function MakeProductOption({ product, optionTitles, onMake }: MakeProductOptionProps & { product: ProductForOption }) {
  const [optionId] = useState(() => crypto.randomUUID());
  const [state, setState] = useState<'idle' | 'adding' | 'added'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const already = state !== 'added' && hasProductOption(product, optionTitles);

  async function make(): Promise<void> {
    setState('adding');
    setMessage(null);
    try {
      const warning = await onMake(product, optionId);
      setState('added');
      setMessage(warning ?? `Added a new option: ${productOptionTitle(product)}.`);
    } catch (e) {
      setState('idle');
      setMessage(e instanceof Error && e.message !== '' ? e.message : 'Could not add this product as an option. Try again.');
    }
  }

  return (
    <div data-testid="make-product-option">
      <Button
        variant="secondary"
        disabled={already || state !== 'idle'}
        onClick={() => { void make(); }}
      >
        {already ? 'Already an option' : state === 'adding' ? 'Adding…' : state === 'added' ? 'Added as an option' : 'Make it an option'}
      </Button>
      {message !== null && (
        <div role="status"><Text as="p" size="sm">{message}</Text></div>
      )}
    </div>
  );
}
