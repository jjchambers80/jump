// frontend/src/app/well-known/security.txt/route.ts
// RFC 9116 security.txt — serves Contact when SECURITY_CONTACT_EMAIL is set,
// returns 404 when unset (the launch-mailbox checklist item).
// Rewritten from /.well-known/security.txt in next.config.mjs.

import { NextResponse } from 'next/server';

// The handler reads no request-scoped API, so Next 14 would statically render
// it at build time: `SECURITY_CONTACT_EMAIL` would be baked into the build
// output (setting it on Railway would do nothing until a rebuild) and
// `Expires` would freeze at build time + 1 year, eventually publishing an
// expired file (RFC 9116 §2.5.5 says consumers should distrust that).
export const dynamic = 'force-dynamic';

export const GET = () => {
  const email = process.env.SECURITY_CONTACT_EMAIL;
  if (!email) return new NextResponse(null, { status: 404 });

  const expires = new Date();
  expires.setFullYear(expires.getFullYear() + 1);

  const text = [
    '# Security Contact Information',
    '# Report security vulnerabilities to the Jump team.',
    `Contact: mailto:${email}`,
    `Expires: ${expires.toISOString()}`,
    'Preferred-Languages: en',
  ].join('\n') + '\n';

  return new NextResponse(text, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};
