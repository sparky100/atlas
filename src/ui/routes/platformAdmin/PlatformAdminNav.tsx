import { Link, useLocation } from 'react-router';
import { useUnsavedChangesGuard } from './unsavedChanges';
import styles from './PlatformAdminNav.module.css';

interface NavItem {
  to: string;
  label: string;
  match: (pathname: string) => boolean;
}

const LINKS: readonly NavItem[] = [
  { to: '/platform-admin', label: 'Overview', match: (pathname) => pathname === '/platform-admin' || pathname === '/platform-admin/' },
  { to: '/platform-admin/capability-sets', label: 'Capability sets', match: (pathname) => pathname === '/platform-admin/capability-sets' || pathname.startsWith('/platform-admin/capability-sets/') },
  { to: '/platform-admin/catalogue', label: 'Products', match: (pathname) => pathname === '/platform-admin/catalogue' || pathname.startsWith('/platform-admin/catalogue/products') },
  { to: '/platform-admin/catalogue/review', label: 'Waiting for review', match: (pathname) => pathname.startsWith('/platform-admin/catalogue/review') },
  { to: '/platform-admin/catalogue/sectors', label: 'Sector catalogues', match: (pathname) => pathname.startsWith('/platform-admin/catalogue/sectors') },
  { to: '/platform-admin/sample-models', label: 'Sample models', match: (pathname) => pathname.startsWith('/platform-admin/sample-models') },
  { to: '/platform-admin/llm-proxy', label: 'LLM proxy', match: (pathname) => pathname.startsWith('/platform-admin/llm-proxy') },
];

/**
 * The platform-admin section's own navigation. Real links, so every area has
 * a URL that survives refresh and a back button. Products and Sector
 * catalogues share a path prefix, so each link owns an explicit match rather
 * than relying on prefix matching alone (which would light both).
 */
export function PlatformAdminNav() {
  const { pathname } = useLocation();
  const guardLeave = useUnsavedChangesGuard();
  return (
    <nav className={styles.nav} aria-label="Platform admin">
      {LINKS.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          className={styles.link ?? ''}
          aria-current={link.match(pathname) ? 'page' : undefined}
          onClick={guardLeave}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
