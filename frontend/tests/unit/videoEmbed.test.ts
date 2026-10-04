import { describe, expect, it } from 'vitest';
import { parseVideoEmbed, videoEmbedSrc } from '@/lib/videoEmbed';

const YT = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ';

// Keep in step with backend/tests/unit/videoEmbed.test.js (mirrored parser).
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
  ])('rejects %s', (input) => {
    expect(videoEmbedSrc(input)).toBeNull();
  });
});

describe('parseVideoEmbed', () => {
  it('reads src and title from a YouTube embed snippet', () => {
    expect(
      parseVideoEmbed(
        '<iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ?si=a&amp;b=1" title="Recap &amp; highlights" frameborder="0" allowfullscreen></iframe>'
      )
    ).toEqual({ src: YT, title: 'Recap & highlights' });
  });

  it('reads a Vimeo snippet wrapped in its responsive div', () => {
    expect(
      parseVideoEmbed(
        "<div style=\"padding:56.25% 0 0 0\"><iframe src='https://player.vimeo.com/video/76979871?h=abc123&amp;badge=0' frameborder=0></iframe></div><script src=\"https://player.vimeo.com/api/player.js\"></script>"
      )
    ).toEqual({ src: 'https://player.vimeo.com/video/76979871?h=abc123', title: 'Embedded video' });
  });

  it('accepts a plain link', () => {
    expect(parseVideoEmbed('  https://youtu.be/dQw4w9WgXcQ  ')).toEqual({
      src: YT,
      title: 'Embedded video',
    });
  });

  it.each([
    '',
    '<p>hello</p>',
    '<iframe src="https://evil.com/x"></iframe>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    'not a link',
  ])('rejects %s', (input) => {
    expect(parseVideoEmbed(input)).toBeNull();
  });
});
