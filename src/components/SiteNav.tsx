import Link from 'next/link';
import type { ReactNode } from 'react';

interface SiteNavProps {
  /** Right-hand controls. Each page shows a different set, so the caller supplies them. */
  actions?: ReactNode;
  /** Secondary text links rendered next to the wordmark, hidden below `md`. */
  links?: Array<{ href: string; label: string }>;
  /** Page width. The marketing pages use a narrower container than the app pages. */
  containerClassName?: string;
}

/**
 * The wordmark and bar chrome were copy-pasted into six pages, which had already drifted: two
 * container widths, two different flex gaps, and the `aria-label` on the landmark only existing
 * on some of them. This is the single definition.
 */
export function SiteNav({
  actions,
  links,
  containerClassName = 'max-w-7xl',
}: SiteNavProps) {
  return (
    <nav
      aria-label="Main"
      className="terminal-navbar sticky top-0 z-50 backdrop-blur-sm"
    >
      <div className={`${containerClassName} mx-auto px-4 h-full flex items-center justify-between`}>
        <div className="flex items-center gap-12">
          <Link href="/" className="logo-text text-xl">
            tradefirewall<span className="logo-underscore">_</span>
          </Link>

          {links && links.length > 0 && (
            <div className="hidden md:flex items-center gap-8">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-text-secondary hover:text-text-primary transition-colors text-sm"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {actions && <div className="flex items-center gap-4">{actions}</div>}
      </div>
    </nav>
  );
}
