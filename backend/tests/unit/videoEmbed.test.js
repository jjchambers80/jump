// Video embeds in organizer HTML (rich text editor › Insert video): only
// YouTube / Vimeo players survive the write-side sanitiser, normalised.

import { sanitizeContentHtml, htmlToText } from '../../src/utils/sanitizeHtml.js';
import { videoEmbedSrc } from '../../src/utils/videoEmbed.js';

const YT = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ';

describe('videoEmbedSrc', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', YT],
    ['https://youtu.be/dQw4w9WgXcQ', YT],
    ['https://youtu.be/dQw4w9WgXcQ?t=90', `${YT}?start=90`],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s', `${YT}?start=90`],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ?si=abc', YT],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', YT],
    ['http://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', YT],
    ['https://vimeo.com/76979871', 'https://player.vimeo.com/video/76979871'],
    ['https://vimeo.com/76979871/abc123', 'https://player.vimeo.com/video/76979871?h=abc123'],
    [
      'https://player.vimeo.com/video/76979871?h=abc123&badge=0',
      'https://player.vimeo.com/video/76979871?h=abc123',
    ],
  ])('%s → %s', (input, expected) => {
    expect(videoEmbedSrc(input)).toBe(expected);
  });

  it.each([
    'https://evil.com/embed/dQw4w9WgXcQ',
    'https://youtube.com.evil.com/embed/dQw4w9WgXcQ',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'https://www.youtube.com/watch?v=short',
    'https://vimeo.com/channels/staffpicks',
    '//www.youtube.com/embed/dQw4w9WgXcQ',
    '',
    undefined,
  ])('rejects %s', (input) => {
    expect(videoEmbedSrc(input)).toBeNull();
  });
});

describe('sanitizeContentHtml › video embeds', () => {
  it('keeps a YouTube embed snippet, normalised to the privacy-enhanced player', () => {
    const clean = sanitizeContentHtml(
      '<iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ?si=x" title="YouTube video player" frameborder="0" onload="steal()" srcdoc="<b>x</b>" style="border:0" allowfullscreen></iframe>'
    );
    expect(clean).toBe(
      `<iframe src="${YT}" title="YouTube video player" class="jump-video" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`
    );
  });

  it('keeps a Vimeo embed', () => {
    const clean = sanitizeContentHtml(
      '<p>Watch:</p><iframe src="https://player.vimeo.com/video/76979871?h=abc123&amp;autoplay=1"></iframe>'
    );
    expect(clean).toContain('<p>Watch:</p>');
    expect(clean).toContain('src="https://player.vimeo.com/video/76979871?h=abc123"');
    expect(clean).toContain('title="Embedded video"');
  });

  it.each([
    '<iframe src="https://evil.com/x"></iframe>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '<iframe src="data:text/html;base64,PHNjcmlwdD4="></iframe>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<iframe src="/embed/dQw4w9WgXcQ"></iframe>',
    '<iframe>fallback text</iframe>',
  ])('drops %s', (dirty) => {
    const clean = sanitizeContentHtml(`<p>a</p>${dirty}<p>b</p>`);
    expect(clean).toBe('<p>a</p><p>b</p>');
  });

  it('does not let organizers pick another class', () => {
    const clean = sanitizeContentHtml(
      `<iframe class="fixed inset-0" src="${YT}"></iframe>`
    );
    expect(clean).toContain('class="jump-video"');
    expect(clean).not.toContain('fixed');
  });

  it('contributes no text to excerpts', () => {
    expect(htmlToText(sanitizeContentHtml(`<p>Hello</p><iframe src="${YT}">x</iframe>`))).toBe('Hello');
  });
});
