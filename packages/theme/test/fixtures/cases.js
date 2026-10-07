// Shared @jump/theme fixtures, asserted from both Jest (backend) and Vitest
// (frontend) so the validator behaves the same wherever it runs (the
// gotcha 28 parity pattern).

const hero = (id, extra = {}) => ({ type: 'Hero', props: { id, heading: 'Hi', ...extra } });
const eventsDoc = (content) => ({ root: { props: { title: 'Events' } }, content });
const list = { type: 'EventList', props: { id: 'EventList-1' } };
const slide = (id, extra = {}) => ({ type: 'Slide', props: { id, heading: 'Slide', ...extra } });
const carousel = (id, blocks, extra = {}) => ({ type: 'HeroCarousel', props: { id, ...extra, blocks } });
const question = (id, extra = {}) => ({ type: 'FaqItem', props: { id, question: 'When?', answer: '<p>Soon</p>', ...extra } });
const faq = (id, blocks, extra = {}) => ({ type: 'Faq', props: { id, ...extra, blocks } });

export const DOCUMENT_CASES = [
  { name: 'minimal events template', key: 'events', data: eventsDoc([list]), errors: [] },
  { name: 'events template without its locked list', key: 'events', data: eventsDoc([hero('Hero-1')]), errors: ['content'] },
  { name: 'unknown document key', key: 'checkout', data: eventsDoc([list]), errors: ['key'] },
  { name: 'section not allowed in the group', key: 'header', data: { root: { props: {} }, content: [hero('Hero-1'), { type: 'Header', props: { id: 'H' } }] }, errors: ['content[0].type'] },
  { name: 'unknown section type', key: 'home', data: eventsDoc([{ type: 'Script', props: { id: 'S' } }]), errors: ['content[0].type'] },
  { name: 'duplicate ids across sections and blocks', key: 'home', data: eventsDoc([hero('X', { blocks: [{ type: 'Button', props: { id: 'X', label: 'Go' } }] })]), errors: ['content[0].props.blocks[0].props.id'] },
  { name: 'limit 1 section twice', key: 'events', data: eventsDoc([list, { ...list, props: { id: 'EventList-2' } }]), errors: ['content[1]'] },
  { name: 'unknown prop', key: 'home', data: eventsDoc([hero('Hero-1', { style: 'color:red' })]), errors: ['content[0].props.style'] },
  { name: 'range out of bounds', key: 'home', data: eventsDoc([hero('Hero-1', { paddingTop: 200 })]), errors: ['content[0].props.paddingTop'] },
  { name: 'range off step', key: 'home', data: eventsDoc([hero('Hero-1', { paddingTop: 3 })]), errors: ['content[0].props.paddingTop'] },
  { name: 'too many buttons', key: 'home', data: eventsDoc([hero('Hero-1', { blocks: ['a', 'b', 'c'].map((id) => ({ type: 'Button', props: { id } })) })]), errors: ['content[0].props.blocks'] },
  { name: 'block not allowed in section', key: 'home', data: eventsDoc([hero('Hero-1', { blocks: [{ type: 'Announcement', props: { id: 'A' } }] })]), errors: ['content[0].props.blocks[0].type'] },
  { name: 'nested blocks (depth 3)', key: 'home', data: eventsDoc([hero('Hero-1', { blocks: [{ type: 'Button', props: { id: 'B', blocks: [] } }] })]), errors: ['content[0].props.blocks[0].props.blocks'] },
  { name: 'javascript: link refused', key: 'home', data: eventsDoc([hero('Hero-1', { blocks: [{ type: 'Button', props: { id: 'B', link: { type: 'EXTERNAL', url: 'javascript:alert(1)' } } }] })]), errors: ['content[0].props.blocks[0].props.link'] },
  { name: 'http link refused', key: 'home', data: eventsDoc([hero('Hero-1', { blocks: [{ type: 'Button', props: { id: 'B', link: { type: 'EXTERNAL', url: 'http://example.com' } } }] })]), errors: ['content[0].props.blocks[0].props.link'] },
  { name: 'https link accepted', key: 'home', data: eventsDoc([hero('Hero-1', { blocks: [{ type: 'Button', props: { id: 'B', link: { type: 'EXTERNAL', url: 'https://example.com/a' } } }] })]), errors: [] },
  { name: 'page link needs a target', key: 'home', data: eventsDoc([hero('Hero-1', { blocks: [{ type: 'Button', props: { id: 'B', link: { type: 'PAGE' } } }] })]), errors: ['content[0].props.blocks[0].props.link'] },
  { name: 'image needs alt text', key: 'home', data: eventsDoc([hero('Hero-1', { image: { fileId: 'f1' } })]), errors: ['content[0].props.image'] },
  { name: 'decorative image needs no alt', key: 'home', data: eventsDoc([hero('Hero-1', { image: { fileId: 'f1', decorative: true } })]), errors: [] },
  { name: 'hero video with poster, full window', key: 'home', data: eventsDoc([hero('Hero-1', { video: { fileId: 'v1' }, videoWebm: { fileId: 'v2' }, image: { fileId: 'f1', decorative: true }, height: 'screen', sectionWidth: 'full' })]), errors: [] },
  { name: 'hero video takes only a fileId', key: 'home', data: eventsDoc([hero('Hero-1', { video: { fileId: 'v1', autoplay: true } })]), errors: ['content[0].props.video'] },
  { name: 'section width', key: 'home', data: eventsDoc([hero('Hero-1', { sectionWidth: 'full' })]), errors: [] },
  { name: 'section width not an option', key: 'home', data: eventsDoc([hero('Hero-1', { sectionWidth: '100vw' })]), errors: ['content[0].props.sectionWidth'] },
  { name: 'page width override', key: 'home', data: { root: { props: { pageWidth: 1000 } }, content: [] }, errors: [] },
  { name: 'page width out of range', key: 'home', data: { root: { props: { pageWidth: 2000 } }, content: [] }, errors: ['root.props.pageWidth'] },
  { name: 'unknown color scheme', key: 'home', data: eventsDoc([hero('Hero-1', { colorScheme: 'scheme-7' })]), errors: ['content[0].props.colorScheme'] },
  { name: 'full-width page document', key: 'page:cmuulvdk90001r04dfmipxu2e', data: eventsDoc([hero('Hero-1', { sectionWidth: 'full' }), { type: 'PageContent', props: { id: 'PageContent-1' } }]), errors: [] },
  { name: 'page document without its content', key: 'page:cmuulvdk90001r04dfmipxu2e', data: eventsDoc([hero('Hero-1')]), errors: [] },
  { name: 'page content twice', key: 'page:cmuulvdk90001r04dfmipxu2e', data: eventsDoc([{ type: 'PageContent', props: { id: 'P1' } }, { type: 'PageContent', props: { id: 'P2' } }]), errors: ['content[1]'] },
  { name: 'page content outside a page', key: 'home', data: eventsDoc([{ type: 'PageContent', props: { id: 'P1' } }]), errors: ['content[0].type'] },
  { name: 'malformed page key', key: 'page:../home', data: eventsDoc([]), errors: ['key'] },
  { name: 'image with text, image right, two buttons', key: 'home', data: eventsDoc([{ type: 'ImageWithText', props: { id: 'IT', image: { fileId: 'f1', alt: 'Market floor' }, imagePosition: 'right', heading: 'Sell with us', body: '<p>Tables</p>', blocks: [{ type: 'Button', props: { id: 'B1', label: 'Apply' } }] } }]), errors: [] },
  { name: 'image with text: unknown position', key: 'home', data: eventsDoc([{ type: 'ImageWithText', props: { id: 'IT', imagePosition: 'top' } }]), errors: ['content[0].props.imagePosition'] },
  { name: 'feature grid with features', key: 'home', data: eventsDoc([{ type: 'FeatureGrid', props: { id: 'FG', columns: '4', blocks: [{ type: 'Feature', props: { id: 'F1', title: 'Parking', image: { fileId: 'f1', decorative: true } } }] } }]), errors: [] },
  { name: 'feature grid: columns out of range', key: 'home', data: eventsDoc([{ type: 'FeatureGrid', props: { id: 'FG', columns: '6' } }]), errors: ['content[0].props.columns'] },
  { name: 'feature grid takes only features', key: 'home', data: eventsDoc([{ type: 'FeatureGrid', props: { id: 'FG', blocks: [{ type: 'Button', props: { id: 'B1' } }] } }]), errors: ['content[0].props.blocks[0].type'] },
  { name: 'feature image needs alt text', key: 'home', data: eventsDoc([{ type: 'FeatureGrid', props: { id: 'FG', blocks: [{ type: 'Feature', props: { id: 'F1', image: { fileId: 'f1' } } }] } }]), errors: ['content[0].props.blocks[0].props.image'] },
  { name: 'image with text: YouTube video', key: 'home', data: eventsDoc([{ type: 'ImageWithText', props: { id: 'IT', videoUrl: 'https://www.youtube.com/watch?v=UavsDmOhMys', videoTitle: 'Vendor reel' } }]), errors: [] },
  { name: 'image with text: video from another host', key: 'home', data: eventsDoc([{ type: 'ImageWithText', props: { id: 'IT', videoUrl: 'https://evil.example/watch?v=UavsDmOhMys' } }]), errors: ['content[0].props.videoUrl'] },
  { name: 'stats with stats', key: 'home', data: eventsDoc([{ type: 'Stats', props: { id: 'ST', blocks: [{ type: 'Stat', props: { id: 'S1', value: '25,000+', label: 'Attendees a year' } }] } }]), errors: [] },
  { name: 'stats: seven is too many', key: 'home', data: eventsDoc([{ type: 'Stats', props: { id: 'ST', blocks: Array.from({ length: 7 }, (_, i) => ({ type: 'Stat', props: { id: `S${i}` } })) } }]), errors: ['content[0].props.blocks'] },
  { name: 'checklist with a cross marker', key: 'home', data: eventsDoc([{ type: 'Checklist', props: { id: 'CL', marker: 'cross', columns: '3', blocks: [{ type: 'ChecklistItem', props: { id: 'C1', text: 'MLM vendors' } }] } }]), errors: [] },
  { name: 'checklist: unknown marker', key: 'home', data: eventsDoc([{ type: 'Checklist', props: { id: 'CL', marker: 'star' } }]), errors: ['content[0].props.marker'] },
  { name: 'steps take only steps', key: 'home', data: eventsDoc([{ type: 'Steps', props: { id: 'SP', blocks: [{ type: 'Step', props: { id: 'P1', title: 'Apply', text: '<p>Fill it in</p>' } }, { type: 'Feature', props: { id: 'F1' } }] } }]), errors: ['content[0].props.blocks[1].type'] },
  { name: 'spotlight with a badge and a button', key: 'home', data: eventsDoc([{ type: 'Spotlight', props: { id: 'SP', image: { fileId: 'f1', alt: 'Badge' }, heading: 'Give back', blocks: [{ type: 'Button', props: { id: 'B1', label: 'Donate', link: { type: 'EXTERNAL', url: 'https://www.extra-life.org/participants/557524' } } }] } }]), errors: [] },
  { name: 'tiers with a highlighted tier', key: 'home', data: eventsDoc([{ type: 'Tiers', props: { id: 'TR', blocks: [{ type: 'Tier', props: { id: 'T1', name: 'Pro', benefits: 'Logo\nTickets', featured: true, badge: 'Most popular' } }] } }]), errors: [] },
  { name: 'tiers take only tiers', key: 'home', data: eventsDoc([{ type: 'Tiers', props: { id: 'TR', blocks: [{ type: 'Feature', props: { id: 'F1' } }] } }]), errors: ['content[0].props.blocks[0].type'] },
  { name: 'tiers: seven is too many', key: 'home', data: eventsDoc([{ type: 'Tiers', props: { id: 'TR', blocks: Array.from({ length: 7 }, (_, i) => ({ type: 'Tier', props: { id: `T${i}` } })) } }]), errors: ['content[0].props.blocks'] },
  { name: 'hero: h1 heading', key: 'home', data: eventsDoc([{ type: 'Hero', props: { id: 'H1', headingLevel: 'h1' } }]), errors: [] },
  { name: 'drop zones refused', key: 'home', data: { ...eventsDoc([]), zones: { 'Hero-1:x': [] } }, errors: ['zones'] },
  { name: 'empty zones accepted', key: 'home', data: { ...eventsDoc([]), zones: {} }, errors: [] },
  { name: '41 sections', key: 'home', data: eventsDoc(Array.from({ length: 41 }, (_, i) => hero(`Hero-${i}`))), errors: ['content'] },
  { name: 'hero carousel with slides', key: 'home', data: eventsDoc([carousel('C', [slide('S1', { image: { fileId: 'f1', alt: 'Crowd' }, buttonLabel: 'Tickets', link: { type: 'EVENTS' } }), slide('S2')])]), errors: [] },
  { name: 'hero carousel over 6 slides', key: 'home', data: eventsDoc([carousel('C', Array.from({ length: 7 }, (_, i) => slide(`S${i}`)))]), errors: ['content[0].props.blocks'] },
  { name: 'hero carousel refuses a question block', key: 'home', data: eventsDoc([carousel('C', [{ type: 'FaqItem', props: { id: 'Q' } }])]), errors: ['content[0].props.blocks[0].type'] },
  { name: 'slide cannot hold blocks', key: 'home', data: eventsDoc([carousel('C', [slide('S', { blocks: [] })])]), errors: ['content[0].props.blocks[0].props.blocks'] },
  { name: 'slide image needs alt text', key: 'home', data: eventsDoc([carousel('C', [slide('S', { image: { fileId: 'f1' } })])]), errors: ['content[0].props.blocks[0].props.image'] },
  { name: 'FAQ with questions', key: 'home', data: eventsDoc([faq('F', [question('Q1'), question('Q2')], { singleOpen: false })]), errors: [] },
  { name: 'FAQ over 30 questions', key: 'home', data: eventsDoc([faq('F', Array.from({ length: 31 }, (_, i) => question(`Q${i}`)))]), errors: ['content[0].props.blocks'] },
  { name: 'FAQ question too long', key: 'home', data: eventsDoc([faq('F', [question('Q', { question: 'x'.repeat(201) })])]), errors: ['content[0].props.blocks[0].props.question'] },
  { name: 'FAQ refuses a slide', key: 'home', data: eventsDoc([faq('F', [slide('S')])]), errors: ['content[0].props.blocks[0].type'] },
  { name: 'over 256 KB', key: 'home', data: eventsDoc([{ type: 'RichText', props: { id: 'R', body: 'x'.repeat(270 * 1024) } }]), errors: ['.'] },
];

export const SETTINGS_CASES = [
  { name: 'empty settings', settings: {}, errors: [] },
  { name: 'layout width', settings: { layout: { pageWidth: 1400 } }, errors: [] },
  { name: 'unknown group', settings: { customCss: { body: 'x' } }, errors: ['customCss'] },
  { name: 'free-form CSS value refused', settings: { layout: { pageWidth: '100vw' } }, errors: ['layout.pageWidth'] },
  { name: 'no schemes', settings: { colors: { schemes: [] } }, errors: ['colors.schemes'] },
  { name: 'scheme hex', settings: { colors: { schemes: [{ id: 'scheme-1', name: 'A', background: '#FFFFFF', foreground: 'auto', accent: 'brand', accentForeground: 'auto', secondaryButtonLabel: 'auto', border: 'auto', muted: 'auto', shadow: 'auto' }] } }, errors: [] },
  { name: 'scheme bad color', settings: { colors: { schemes: [{ id: 'scheme-1', name: 'A', background: 'red', foreground: 'auto', accent: 'brand', accentForeground: 'auto', secondaryButtonLabel: 'auto', border: 'auto', muted: 'auto', shadow: 'auto' }] } }, errors: ['colors.schemes[0].background'] },
  { name: 'social link on the wrong host', settings: { social: { instagram: 'https://evil.example/instagram.com' } }, errors: ['social.instagram'] },
  { name: 'social link on a subdomain', settings: { social: { instagram: 'https://www.instagram.com/riverside' } }, errors: [] },
  { name: 'badge scheme must exist', settings: { colors: { schemes: [{ id: 'scheme-1', name: 'A', background: 'auto', foreground: 'auto', accent: 'brand', accentForeground: 'auto', secondaryButtonLabel: 'auto', border: 'auto', muted: 'auto', shadow: 'auto' }] }, badges: { soldOutScheme: 'scheme-2' } }, errors: ['badges.soldOutScheme'] },
];

export const CONTENT_CASES = [
  { name: 'override', content: { 'event.getTickets': 'Buy now' }, errors: [], stored: { 'event.getTickets': 'Buy now' } },
  { name: 'override equal to default is not stored', content: { 'event.getTickets': 'Get tickets' }, errors: [], stored: {} },
  { name: 'unknown key (legal wording is not in the catalog)', content: { 'checkout.consent': 'I agree' }, errors: ['content.checkout.consent'] },
  { name: 'dropped variable', content: { 'event.onSaleAt': 'On sale soon' }, errors: ['content.event.onSaleAt'] },
  { name: 'kept variable', content: { 'event.onSaleAt': 'Sale opens {date}' }, errors: [], stored: { 'event.onSaleAt': 'Sale opens {date}' } },
  { name: 'unknown variable', content: { 'event.soldOut': 'Gone {date}' }, errors: ['content.event.soldOut'] },
  { name: 'too long', content: { 'event.soldOut': 'x'.repeat(41) }, errors: ['content.event.soldOut'] },
];

const HASH = 'a'.repeat(64);
export const FILE_ID_CASE = {
  value: {
    logo: { image: { fileId: 'logo1', alt: 'Logo' } },
    content: [
      { type: 'Hero', props: { id: 'H', image: { fileId: 'hero1', alt: 'x' }, blocks: [{ type: 'Logo', props: { id: 'L', image: { fileId: 'nested1', alt: 'y' } } }] } },
      { type: 'RichText', props: { id: 'R', body: `<p><img src="https://api.example/files/inline1/${HASH}/pic.jpg"></p>` } },
    ],
  },
  ids: ['logo1', 'hero1', 'nested1', 'inline1'],
};
