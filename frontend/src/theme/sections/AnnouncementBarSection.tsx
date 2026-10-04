// Theme AnnouncementBar section (spec 038 §7). Hidden announcements and those
// outside their window never reach the page (the render endpoint drops them).

import { linkHref } from '../links';
import { schemeClass } from '../settingsCss';
import AnnouncementRotator, { type Announcement } from './AnnouncementRotator';
import { sectionWidthStyle, t, type SectionContext } from './context';
import type { ThemeItem } from '../types';

export interface AnnouncementBarProps {
  id: string;
  rotate?: 'off' | '5s' | '8s' | 'marquee';
  dismissible?: boolean;
  colorScheme?: string;
  sectionWidth?: string;
  blocks?: ThemeItem[];
  ctx: SectionContext;
}

export default function AnnouncementBarSection({ id, rotate = 'off', dismissible = false, colorScheme, sectionWidth, blocks = [], ctx }: AnnouncementBarProps) {
  const announcements: Announcement[] = blocks
    .filter((block) => block.type === 'Announcement' && block.props.text)
    .map((block) => ({
      id: block.props.id,
      text: String(block.props.text),
      href: linkHref(block.props.link, ctx),
    }));
  if (!announcements.length) return null;
  return (
    <div data-section="AnnouncementBar" className={schemeClass(colorScheme) || undefined} style={sectionWidthStyle({ sectionWidth })}>
      <AnnouncementRotator
        barId={id}
        announcements={announcements}
        intervalMs={rotate === '5s' ? 5000 : rotate === '8s' ? 8000 : 0}
        marquee={rotate === 'marquee'}
        dismissible={dismissible}
        labels={{ pause: t(ctx, 'announcement.pause'), close: t(ctx, 'announcement.close') }}
      />
    </div>
  );
}
