// Where to send a buyer after they sign in (spec 031). The account page
// stores a same-origin path from ?next= before the magic link is requested;
// the verify page reads it back. Only relative paths are honoured so the
// sign-in flow can never bounce a buyer to another site.

const KEY = 'jump_buyer_next';

export function safeNextPath(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  return value;
}

export function rememberNext(path: string | null) {
  try {
    if (path) sessionStorage.setItem(KEY, path);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* private mode / blocked storage: the buyer lands on the account page */
  }
}

export function takeNext(): string | null {
  try {
    const value = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return safeNextPath(value);
  } catch {
    return null;
  }
}
