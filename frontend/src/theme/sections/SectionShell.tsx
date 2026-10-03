// Common wrapper for template sections: color scheme class, padding the
// organizer set, and a data attribute the editor (038D) and tests target.

import type { CSSProperties, ReactNode } from 'react';
import { schemeClass } from '../settingsCss';
import { sectionPadding, sectionWidthStyle } from './context';

export default function SectionShell({
  type,
  props,
  children,
}: {
  type: string;
  props: { colorScheme?: unknown; paddingTop?: unknown; paddingBottom?: unknown; sectionWidth?: unknown };
  children: ReactNode;
}) {
  return (
    <div data-section={type} className={schemeClass(props.colorScheme) || undefined} style={{ ...sectionPadding(props), ...sectionWidthStyle(props) } as CSSProperties}>
      {children}
    </div>
  );
}
