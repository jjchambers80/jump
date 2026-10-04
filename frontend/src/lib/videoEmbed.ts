// Video embeds in the rich text editor: YouTube and Vimeo players only.
// Mirrors backend/src/utils/videoEmbed.js, which is the trust boundary (the
// sanitiser rewrites every stored <iframe> through it). This copy only drives
// the Insert video dialog. Change both together.

export const VIDEO_EMBED_ALLOW =
  'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen';

const DEFAULT_TITLE = 'Embedded video';
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_HASH = /^[A-Za-z0-9]+$/;

/** "90", "90s", "1m30s", "1h2m3s" → seconds; anything else → 0. */
function startSeconds(value: string | null) {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match) return 0;
  const [, h = '0', m = '0', s = '0'] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

/**
 * Canonical player URL for a YouTube / Vimeo watch, share or embed URL, or
 * null for anything else.
 */
export function videoEmbedSrc(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');

  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'youtu.be') {
    let id: string | null = null;
    if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? null;
    else if (url.pathname === '/watch') id = url.searchParams.get('v');
    else id = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)\/?$/)?.[1] ?? null;
    if (!id || !YOUTUBE_ID.test(id)) return null;
    const start = startSeconds(url.searchParams.get('start') ?? url.searchParams.get('t'));
    return `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ''}`;
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const match =
      host === 'player.vimeo.com'
        ? url.pathname.match(/^\/video\/(\d+)\/?$/)
        : url.pathname.match(/^\/(\d+)(?:\/([A-Za-z0-9]+))?\/?$/);
    if (!match) return null;
    const hash = url.searchParams.get('h') ?? match[2];
    const query = hash && VIMEO_HASH.test(hash) ? `?h=${hash}` : '';
    return `https://player.vimeo.com/video/${match[1]}${query}`;
  }

  return null;
}

function decodeEntities(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function attribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value === undefined ? null : decodeEntities(value);
}

/**
 * Reads what an organizer pasted into the Insert video dialog: a provider's
 * `<iframe …>` embed snippet or a plain watch / share link.
 */
export function parseVideoEmbed(input: string): { src: string; title: string } | null {
  const text = input.trim();
  if (!text) return null;
  if (text.startsWith('<')) {
    const tag = text.match(/<iframe\b[^>]*>/i)?.[0];
    if (!tag) return null;
    const src = videoEmbedSrc(attribute(tag, 'src') ?? '');
    if (!src) return null;
    const title = attribute(tag, 'title')?.trim();
    return { src, title: title || DEFAULT_TITLE };
  }
  const src = videoEmbedSrc(text);
  return src ? { src, title: DEFAULT_TITLE } : null;
}
