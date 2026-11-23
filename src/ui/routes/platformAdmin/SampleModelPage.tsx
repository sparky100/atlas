import { useParams } from 'react-router';
import { SampleModelAdmin } from '../../admin/SampleModelAdmin';

/** `/platform-admin/sample-models/:slug` — one sample model and its sharing state. */
export function SampleModelPage() {
  const { slug } = useParams<{ slug: string }>();
  return <SampleModelAdmin slug={slug ?? ''} />;
}
