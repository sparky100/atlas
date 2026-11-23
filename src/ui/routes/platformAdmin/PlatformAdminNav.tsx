import { NavLink } from 'react-router';
import styles from './PlatformAdminNav.module.css';

const LINKS = [
  { to: '/platform-admin', label: 'Overview', end: true },
  { to: '/platform-admin/capability-sets', label: 'Capability sets', end: false },
  { to: '/platform-admin/catalogue', label: 'Product catalogue', end: false },
  { to: '/platform-admin/sample-models', label: 'Sample models', end: false },
  { to: '/platform-admin/llm-proxy', label: 'LLM proxy', end: false },
] as const;

/** The platform-admin section's own navigation. Real links, so every area has a URL that survives refresh and a back button. */
export function PlatformAdminNav() {
  return (
    <nav className={styles.nav} aria-label="Platform admin">
      {LINKS.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end={link.end}
          className={styles.link ?? ''}
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
