import { Link, useParams } from 'react-router';
import { Text } from '../components/Text/Text';
import { findProductInModel, productInModelText, type ModelElementName } from './productInModel';

/**
 * Under a listed product: when its name matches a system or module already in the model,
 * say so and link to it. "Looks like", not "is": the person checks it is the same thing.
 */
export function ProductInModelNote({ productName, elements }: { productName: string; elements: readonly ModelElementName[] }) {
  const { orgSlug, modelSlug } = useParams();
  const match = findProductInModel(productName, elements);
  if (match === null || orgSlug === undefined || modelSlug === undefined) return null;
  return (
    <div data-testid="product-in-model">
      <Text as="p" size="sm">
        Looks like it is already in your model: <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${match.id}`}>{productInModelText(match)}</Link>. Check before adding it again.
      </Text>
    </div>
  );
}
