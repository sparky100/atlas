import type { UUID } from '../../contracts/delta';

/** A system or module in the current model, with the platform it belongs to when it is a module. */
export interface ModelElementName {
  id: UUID;
  name: string;
  type: 'system' | 'container';
  platformName: string | null;
}

const MIN_NAME_LENGTH = 5;

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w !== '');
}

/**
 * Which system or module already in the model a catalogue or researched product probably is.
 * The element's whole name must appear, word for word, inside the product's name
 * ("Utility Network" inside "Esri ArcGIS Utility Network"), and a name shorter than five
 * letters is never matched, so a one-word generic name cannot claim a product. The longest
 * matching name wins. It is a prompt to check, never a statement that they are the same product.
 */
export function findProductInModel(productName: string, elements: readonly ModelElementName[]): ModelElementName | null {
  const product = words(productName);
  let best: { element: ModelElementName; length: number } | null = null;
  for (const element of elements) {
    const name = words(element.name);
    if (name.length === 0 || name.join(' ').length < MIN_NAME_LENGTH || name.length > product.length) continue;
    for (let start = 0; start + name.length <= product.length; start += 1) {
      if (name.every((word, i) => product[start + i] === word)) {
        if (best === null || name.join(' ').length > best.length) best = { element, length: name.join(' ').length };
        break;
      }
    }
  }
  return best?.element ?? null;
}

export function productInModelText(match: ModelElementName): string {
  return match.type === 'container' && match.platformName !== null
    ? `${match.name}, a module of ${match.platformName}`
    : match.name;
}
