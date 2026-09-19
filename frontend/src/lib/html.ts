/** Plain text of an HTML snippet (client-side; used for "is the editor empty?"). */
export function htmlToText(html: string): string {
  if (typeof document === 'undefined')
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent || '').replace(/\s+/g, ' ').trim();
}
