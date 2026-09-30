// Video embeds in organizer HTML: YouTube and Vimeo players only.
// Mirrors frontend/src/lib/videoEmbed.ts (the editor's dialog); this copy is
// the trust boundary — sanitizeContentHtml rewrites every <iframe> src through
// it and drops the iframe when it returns null. Change both together.

export const VIDEO_EMBED_HOSTS = ['www.youtube-nocookie.com', 'player.vimeo.com'];

export const VIDEO_EMBED_ALLOW =
  'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen';

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_HASH = /^[A-Za-z0-9]+$/;

/** "90", "90s", "1m30s", "1h2m3s" → seconds; anything else → 0. */
function startSeconds(value) {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match) return 0;
  const [, h = 0, m = 0, s = 0] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

/**
 * Canonical player URL for a YouTube / Vimeo watch, share or embed URL, or
 * null for anything else.
 */
export function videoEmbedSrc(raw) {
  let url;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');

  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'youtu.be') {
    let id = null;
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
