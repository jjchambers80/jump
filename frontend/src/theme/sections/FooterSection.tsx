// Theme Footer section (spec 038 §7, locked). With no blocks and the default
// settings it renders exactly today's footer (FooterMenu); blocks add columns
// above it. Renders nothing when there is nothing to show, like today.

import Link from 'next/link';
import ContentHtml from '@/components/storefront/ContentHtml';
import FooterMenu from '@/components/storefront/FooterMenu';
import LogoBox from '@/components/LogoBox';
import { resolveAssetUrl } from '@/lib/assets';
import { LEGAL_PAGES_ENABLED, LEGAL_PATHS } from '@/lib/legal';
import { schemeClass } from '../settingsCss';
import type { ThemeItem } from '../types';
import { sectionWidthStyle, type SectionContext } from './context';

const SOCIAL_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  x: 'X',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  threads: 'Threads',
  website: 'Website',
};

export interface FooterSectionProps {
  showLegalLinks?: boolean;
  poweredBy?: boolean;
  copyright?: string;
  colorScheme?: string;
  sectionWidth?: string;
  blocks?: ThemeItem[];
  ctx: SectionContext;
}

const heading = 'text-xs font-semibold uppercase tracking-widest text-gray-900 dark:text-white';
const small = 'text-sm text-gray-600 dark:text-slate-300';
const linkClass =
  'inline-flex min-h-11 items-center text-sm text-gray-600 underline-offset-4 hover:text-brand-link hover:underline sm:min-h-0 sm:py-1 dark:text-slate-300 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand';

function FooterBlock({ block, ctx }: { block: ThemeItem; ctx: SectionContext }) {
  const { organization, settings, resolved } = ctx;
  switch (block.type) {
    case 'MenuColumn': {
      // Named menus other than the footer menu arrive with card 038E; until
      // then a column lists the footer menu's top-level links.
      const items = resolved.menus.footer.filter((item) => !item.children.length);
      if (!items.length) return null;
      return (
        <div>
          {block.props.heading && <h2 className={heading}>{block.props.heading}</h2>}
          <ul className="mt-2 sm:mt-3">
            {items.map((item) => (
              <li key={item.id}>
                <Link href={item.href} className={linkClass}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case 'Text':
      return (
        <div>
          {block.props.heading && <h2 className={heading}>{block.props.heading}</h2>}
          {block.props.body && <ContentHtml html={String(block.props.body)} className="mt-2 text-sm" />}
        </div>
      );
    case 'BrandInfo': {
      const brand = settings.brand ?? {};
      const logo = brand.showLogoInFooter ? resolveAssetUrl(organization.logoUrl) : null;
      if (!brand.headline && !brand.description && !logo) return null;
      return (
        <div>
          {logo && <LogoBox src={logo} alt={`${organization.name} logo`} className="mb-3 w-16 rounded-lg" />}
          {brand.headline && <h2 className={heading}>{brand.headline}</h2>}
          {brand.description && <p className={`mt-2 ${small}`}>{brand.description}</p>}
        </div>
      );
    }
    case 'SocialLinks': {
      const social = Object.entries(settings.social ?? {}).filter(([, url]) => typeof url === 'string' && url.startsWith('https://'));
      if (!social.length) return null;
      return (
        <div>
          <h2 className={heading}>Follow us</h2>
          <ul className="mt-2 sm:mt-3">
            {social.map(([key, url]) => (
              <li key={key}>
                <a href={url as string} rel="noopener me" target="_blank" className={linkClass}>
                  {SOCIAL_LABELS[key] ?? key}
                </a>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    default:
      return null;
  }
}

export default function FooterSection({
  showLegalLinks = true,
  poweredBy = false,
  copyright = '',
  colorScheme,
  sectionWidth,
  blocks = [],
  ctx,
}: FooterSectionProps) {
  const { organization, resolved, host } = ctx;
  const items = resolved.menus.footer ?? [];
  const legal = showLegalLinks && LEGAL_PAGES_ENABLED;
  if (!items.length && !blocks.length && !copyright && !legal && !poweredBy) return null;

  const before = blocks.length ? (
    <div className="mb-10 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
      {blocks.map((block) => (
        <FooterBlock key={block.props.id} block={block} ctx={ctx} />
      ))}
    </div>
  ) : null;
  const after =
    legal || poweredBy ? (
      <div className={`mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 ${small}`}>
        {legal && (
          <>
            <Link href={LEGAL_PATHS.terms} className={linkClass}>
              Terms
            </Link>
            <Link href={LEGAL_PATHS.privacy} className={linkClass}>
              Privacy
            </Link>
          </>
        )}
        {poweredBy && <span>Powered by Eventimus</span>}
      </div>
    ) : null;

  return (
    <div data-section="Footer" className={schemeClass(colorScheme) || undefined} style={sectionWidthStyle({ sectionWidth })}>
      <FooterMenu
        items={items}
        organization={organization}
        host={host}
        copyright={copyright || undefined}
        before={before}
        after={after}
      />
    </div>
  );
}
