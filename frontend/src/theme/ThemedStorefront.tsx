// The themed branch of a storefront route (spec 038 §8): gate, or frame +
// body. Pages call loadStorefrontFrame first and render their legacy client
// component when it answers `legacy`.

import type { ReactNode } from 'react';
import ThemeScope from './ThemeScope';
import ThemeFrame from './ThemeFrame';
import ThemedPasswordGate from './ThemedPasswordGate';
import type { StorefrontFrame } from './server/storefront';
import { tenantHost } from './server/storefront';

export default function ThemedStorefront({
  frame,
  nameIsHeading,
  children,
}: {
  frame: Exclude<StorefrontFrame, { kind: 'legacy' }>;
  nameIsHeading?: boolean;
  children: ReactNode;
}) {
  if (frame.kind === 'locked') {
    // The gate has the org's mode at first paint too (blocking script).
    return (
      <ThemeScope brandColor={frame.lock.organization.brandColor} themeMode={frame.lock.organization.themeMode}>
        <ThemedPasswordGate lock={frame.lock} clearCookie={frame.hadAccessCookie} />
      </ThemeScope>
    );
  }
  return (
    <ThemeFrame data={frame.data} host={tenantHost()} nameIsHeading={nameIsHeading}>
      <div id="storefront-main" tabIndex={-1} className="outline-none">
        {children}
      </div>
    </ThemeFrame>
  );
}
