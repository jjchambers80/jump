// "Did you mean …?" for the checkout email field. A mistyped domain means the
// tickets never arrive, so catch the common slips (gmial.com, yahoo.con) while
// the buyer can still fix them. Suggestion only — never blocks submission.

const DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'aol.com',
  'live.com',
  'msn.com',
  'me.com',
  'mac.com',
  'comcast.net',
  'proton.me',
  'protonmail.com',
  'att.net',
  'verizon.net',
  'ymail.com',
  'mail.com',
  'gmx.com',
  'zoho.com',
  'fastmail.com',
  'hey.com',
  'sbcglobal.net',
  'bellsouth.net',
  'charter.net',
  'cox.net',
];

const TLDS = ['com', 'net', 'org', 'edu', 'gov', 'me', 'io', 'co', 'us'];

function distance(a: string, b: string): number {
  // Optimal string alignment: insert, delete, substitute, adjacent swap (gmial ↔ gmail).
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

function closest(value: string, candidates: string[], maxDistance: number): string | null {
  let best: string | null = null;
  let bestDistance = maxDistance + 1;
  for (const candidate of candidates) {
    if (candidate === value) return null;
    const d = distance(value, candidate);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return bestDistance <= maxDistance ? best : null;
}

/** Returns a corrected address, or null when the address looks fine. */
export function suggestEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (DOMAINS.includes(domain)) return null;

  const domainMatch = closest(domain, DOMAINS, 2);
  if (domainMatch) return `${local}@${domainMatch}`;

  const dot = domain.lastIndexOf('.');
  if (dot < 1) return null;
  const tld = domain.slice(dot + 1);
  if (TLDS.includes(tld)) return null;
  const tldMatch = closest(tld, TLDS, 1);
  return tldMatch ? `${local}@${domain.slice(0, dot + 1)}${tldMatch}` : null;
}
