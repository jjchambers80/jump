/**
 * The address the browser used. Behind Railway's proxy `request.url` names the
 * server's own listener (localhost:3001), so redirects must come from the
 * forwarded / Host header instead.
 */
export function publicUrl(path: string, request: Request) {
  const url = new URL(request.url);
  const first = (name: string) => request.headers.get(name)?.split(',')[0].trim();
  const host = first('x-forwarded-host') || first('host') || url.host;
  const proto = first('x-forwarded-proto') || url.protocol.replace(':', '');
  return new URL(path, `${proto}://${host}`);
}

/** Only same-site paths: never an open redirect. */
export function safePath(to: string | null) {
  return to && to.startsWith('/') && !to.startsWith('//') ? to : '/';
}
