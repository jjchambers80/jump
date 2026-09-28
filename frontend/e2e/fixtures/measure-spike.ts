import { spikeDocument } from '../../src/theme/spike/fixtures';
const kb = (v: unknown) => (Buffer.byteLength(JSON.stringify(v)) / 1024).toFixed(1);
const home20 = spikeDocument(20);
const home40 = spikeDocument(40);
const rich = JSON.parse(JSON.stringify(spikeDocument(20)));
// A heavier realistic page: long rich text bodies (~2 KB each) and image refs.
for (const s of (rich.root.props.template as any[])) {
  if (s.type === 'RichText') s.props.body = '<p>' + 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(35) + '</p>';
  if (s.type === 'Hero') s.props.image = { fileId: 'clx0000000000000000000000', alt: 'Crowd at the riverside stage at dusk' };
}
const settings = { colorSchemes: Array.from({ length: 8 }, (_, i) => ({ id: `scheme-${i + 1}`, name: `Scheme ${i + 1}`, background: '#ffffff', foreground: '#111827', accent: 'brand', accentForeground: '#ffffff', secondaryButtonLabel: '#111827', border: '#e5e7eb', muted: '#6b7280', shadow: '#000000' })), typography: {}, layout: {}, social: {} };
const snapshot = { settings, content: {}, documents: { header: {}, footer: {}, home: rich, events: spikeDocument(3), event: spikeDocument(5), blog: spikeDocument(2), blog_post: spikeDocument(2) } };
console.log(JSON.stringify({ home20KB: kb(home20), home40KB: kb(home40), home20RichKB: kb(rich), settings8SchemesKB: kb(settings), revisionSnapshotKB: kb(snapshot), revisions50MB: (Buffer.byteLength(JSON.stringify(snapshot)) * 50 / 1048576).toFixed(2) }, null, 1));
