import type { StartPage } from '../../contracts/userPreferences';
import { useAuth } from '../auth/useAuth';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { useStartPage } from './useStartPage';

/** "Make this my start page" on Home, the capability map and landscape: saves this page as where the app opens for this person. Once saved it says so instead. Changeable any time under Profile. */
export function MakeStartPageButton({ page }: { page: StartPage }) {
  const { userId } = useAuth();
  const { saved, loading, setStartPage } = useStartPage(userId);
  if (loading || userId === null) return null;
  if (saved === page) {
    return (
      <Text as="span" size="sm" tone="muted">
        This is your start page
      </Text>
    );
  }
  return (
    <Button
      variant="ghost"
      onClick={() => {
        setStartPage(page);
      }}
    >
      Make this my start page
    </Button>
  );
}
