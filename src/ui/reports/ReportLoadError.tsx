import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';

export function ReportLoadError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div>
      <div role="alert"><Text as="p">{message}</Text></div>
      <Button variant="secondary" onClick={retry}>Try again</Button>
    </div>
  );
}
