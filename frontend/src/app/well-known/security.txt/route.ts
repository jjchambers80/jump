// frontend/src/app/well-known/security.txt/route.ts
// RFC 9116 security.txt — serves Contact when SECURITY_CONTACT_EMAIL is set,
// returns 404 when unset (the launch-mailbox checklist item).
// Rewritten from /.well-known/security.txt in next.config.mjs.

import { NextResponse } from 'next/server';

export const GET = () => {
  const email = process.env.SECURITY_CONTACT_EMAIL;
  if (!email) return new NextResponse(null, { status: 404 });

  const expires = new Date();
  expires.setFullYear(expires.getFullYear() + 1);

  const text = [
    '# Security Contact Information',
    '# Report security vulnerabilities to the Jump team.',
    `Contact: mailto:${email}`,
    `Expires: ${expires.toISOString().slice(0, 10)}`,
    'Preferred-Languages: en',
  ].join('\n') + '\n';

  return new NextResponse(text, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};