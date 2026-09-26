'use client';

// Footer menu: top-level items with children become columns; plain links sit
// in the first column. Organization name + year below. Renders nothing when
// the footer menu has no renderable items.

import Link from 'next/link';
import type { PublicMenuItem } from '@/lib/menus';
import { storefrontHref } from '@/lib/storefrontPath';
import { useStorefrontMenus } from './useStorefrontMenus';

interface StorefrontFooterProps {
  organization: { id: string; name: string };
}

function FooterLink({
  item,
  orgId,
  className,
}: {
  item: PublicMenuItem;
  orgId: string;
  className: string;
}) {
  const href = storefrontHref(item.href, orgId);
  if (/^https?:\/\//i.test(href) || item.newTab) {
    return (
      <a
        href={href}
        target={item.newTab ? '_blank' : undefined}
        rel={item.newTab ? 'noopener' : undefined}
        className={className}
      >
        {item.label}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {item.label}
    </Link>
  );
}

export default function StorefrontFooter({ organization }: StorefrontFooterProps) {
  const menus = useStorefrontMenus(organization.id);
  const items = menus?.footer ?? [];
  if (!items.length) return null;

  const plain = items.filter((item) => !item.children.length);
  const groups = items.filter((item) => item.children.length);
  const link = 'text-sm text-gray-600 hover:text-brand-link hover:underline dark:text-slate-300';

  return (
    <footer
      className="mt-16 border-t border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900"
      data-testid="storefront-footer"
    >
      <nav aria-label="Footer" className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {plain.length > 0 && (
            <ul className="space-y-2">
              {plain.map((item) => (
                <li key={item.id}>
                  <FooterLink item={item} orgId={organization.id} className={link} />
                </li>
              ))}
            </ul>
          )}
          {groups.map((group) => (
            <div key={group.id}>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                <FooterLink
                  item={group}
                  orgId={organization.id}
                  className="hover:text-brand-link hover:underline"
                />
              </h2>
              <ul className="mt-3 space-y-2">
                {group.children.map((child) => (
                  <li key={child.id}>
                    <FooterLink item={child} orgId={organization.id} className={link} />
                    {child.children.length > 0 && (
                      <ul className="mt-1 space-y-1 pl-3">
                        {child.children.map((grand) => (
                          <li key={grand.id}>
                            <FooterLink
                              item={grand}
                              orgId={organization.id}
                              className="text-xs text-gray-500 hover:text-brand-link hover:underline dark:text-slate-400"
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-10 text-xs text-gray-500 dark:text-slate-400">
          © {new Date().getFullYear()} {organization.name}
        </p>
      </nav>
    </footer>
  );
}
