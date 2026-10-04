// Instructions for AI coding assistants editing a pulled theme (spec 043).
// The backend serves them with the schema (GET /admin/themes/schema), so a
// deploy updates every CLI session without a CLI release.

import { themeSchema } from './files-check.js';

export const THEME_AGENT_GUIDE = `# Jump theme

This folder is an Eventimus (Jump) online store theme, pulled with the Jump CLI.
Edit the JSON files to change the store's look and content, then push them.

## Files

- \`settings.json\`: theme settings (colors, fonts, layout, social links). Only the values that differ from the preset.
- \`content.json\`: overrides of the storefront's default wording.
- \`documents/<key>.json\`: one page layout each (\`header\`, \`footer\`, \`home\`, \`events\`). Each is \`{ root: { props }, content: [ { type, props } ] }\`.
- \`.jump/schema.json\`: every section and block type, its fields (kind, options, max length) and the limits. **Use only what it lists.**
- \`.jump/AGENTS.md\` (these instructions) and \`.jump/schema.json\` are rewritten from the server on every \`jump theme pull\`, so they match what the server accepts. Never edit them.
- \`jump.theme.json\`: the lock (theme id, versions). Never edit it.

## Rules

1. Edit only \`settings.json\`, \`content.json\` and \`documents/*.json\`. There is no CSS, HTML, script or template code to edit, and none is accepted.
2. Every section needs a unique \`props.id\`. Sections marked \`locked\` in the schema (Header, Footer, EventList) must stay in their document.
3. Images are \`{ "fileId": "<id>", "alt": "…" }\` references to files in Content › Files. Upload a local image or video with \`jump files upload <path>...\` (it prints each id; \`jump files list --type video\` finds existing ones). Never invent a fileId; leave an image unset if you have none. Every image needs \`alt\` text or \`"decorative": true\`. Videos (Hero \`video\` / \`videoWebm\`) are just \`{ "fileId": "<id>" }\` of an MP4 or WebM in Content › Files; set the Hero \`image\` too, as the poster and the still shown to visitors who prefer reduced motion.
4. Widths: the theme's page width is \`settings.json\` \`layout.pageWidth\` (1000-1600 px). A page can override it with \`root.props.pageWidth\` in its document. Each section takes \`props.sectionWidth\`: \`page\` (default), \`narrow\`, \`wide\` or \`full\` (edge to edge; a Hero carousel then also drops its side gutters and rounded corners).
5. Rich text fields take simple HTML (p, strong, em, a, ul, ol, li, h2-h4); the server sanitises it.
6. After every change run \`jump theme check\` and fix every error before pushing.
7. Push with \`jump theme push\` to the development theme and check the preview link. Never push or publish to the live theme (\`--live\`, \`jump theme publish\`) unless the user explicitly asks.

## Commands

\`\`\`
jump theme check     # validate locally, like the server does
jump theme dev       # push to your development theme on every change, print the preview link
jump theme push      # push changed files to the theme in jump.theme.json
jump theme preview   # a fresh preview link
jump theme publish   # make this theme live (asks first)
\`\`\`
`;

/** What the CLI writes into .jump/: the schema and the guide, as this server knows them. */
export const themeKit = () => ({ schema: themeSchema(), guide: THEME_AGENT_GUIDE });
