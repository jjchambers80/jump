// Writes the spike fixture sets from src/theme/spike/fixtures.ts.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { spikeDocument, spikeResolved } from '../../src/theme/spike/fixtures';
import { DEFAULT_SETTINGS } from '../../src/theme/spike/ThemeScope';

const dir = path.join(__dirname, 'storefront');
function write(orgId: string, extra: Record<string, unknown>, sections = 4) {
  const resolved = spikeResolved(orgId);
  const body = {
    renderer: 'theme',
    organization: { ...resolved.organization, brandColor: '#0f766e', themeMode: 'LIGHT' },
    settings: DEFAULT_SETTINGS,
    document: spikeDocument(sections),
    resolved,
    ...extra,
  };
  writeFileSync(path.join(dir, `${orgId}.json`), JSON.stringify(body, null, 1));
}
write('org-public', {});
write('org-dark', { organization: { ...spikeResolved('org-dark').organization, brandColor: '#be185d', themeMode: 'DARK' } });
write('org-system', { organization: { ...spikeResolved('org-system').organization, brandColor: '#be185d', themeMode: 'SYSTEM' } });
write('org-private', { gate: { token: 'good-token', message: 'Members only' } });
write('org-big', {}, 20);
writeFileSync(path.join(dir, 'org-legacy.json'), JSON.stringify({ renderer: 'legacy' }));
