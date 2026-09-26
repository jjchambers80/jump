'use client';

// Footer menu: top-level items with children become columns; plain links sit
// in one row beside the organization name + year. No background or border of
// its own, it sits on the page surface. Renders nothing when the footer menu
// has no renderable items.

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
  const focusRing =
    'rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2';
  // 44px tall rows on touch screens, compact from sm where a pointer is likely.
  const link = `inline-flex min-h-11 items-center text-sm text-gray-600 underline-offset-4 transition-colors hover:text-brand-link hover:underline motion-reduce:transition-none sm:min-h-0 sm:py-1 dark:text-slate-300 ${focusRing}`;

  return (
    <footer className="mt-20 w-full" data-testid="storefront-footer">
      <nav aria-label="Footer" className="mx-auto max-w-7xl px-4 pb-10 pt-8 sm:px-6 lg:px-8">
        {groups.length > 0 && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
            {groups.map((group) => (
              <div key={group.id} className="min-w-0">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-900 dark:text-white">
                  <FooterLink
                    item={group}
                    orgId={organization.id}
                    className={`hover:text-brand-link hover:underline underline-offset-4 ${focusRing}`}
                  />
                </h2>
                <ul className="mt-2 sm:mt-3">
                  {group.children.map((child) => (
                    <li key={child.id}>
                      <FooterLink item={child} orgId={organization.id} className={link} />
                      {child.children.length > 0 && (
                        <ul className="pl-3">
                          {child.children.map((grand) => (
                            <li key={grand.id}>
                              <FooterLink item={grand} orgId={organization.id} className={link} />
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
        )}
        <div
          className={`flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between ${
            groups.length > 0 ? 'mt-10' : ''
          }`}
        >
          <p className="text-sm text-gray-600 dark:text-slate-400">
            © {new Date().getFullYear()} {organization.name}
          </p>
          {plain.length > 0 && (
            <ul className="flex flex-wrap gap-x-6 sm:gap-y-1">
              {plain.map((item) => (
                <li key={item.id}>
                  <FooterLink item={item} orgId={organization.id} className={link} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </nav>
    </footer>
  );
}
