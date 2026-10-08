// Eventimus sign-in link email, replacing Auth.js's generic "Sign in to
// <host>" template. Same shell as eventimusEmail() in
// backend/src/services/EmailService.js: keep the two in step.
// Edge-safe (fetch only): auth.config.ts is shared with middleware.

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function signInEmailHtml(url: string): string {
  const href = escape(url);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
  </head>
  <body style="margin: 0; padding: 0; background: #111827;">
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">Your sign-in link for Eventimus. It works once and expires in 24 hours.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#111827" style="background: #111827;">
      <tr><td align="center" style="padding: 40px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 480px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">
          <tr><td align="center" style="padding: 0 0 24px; font-size: 26px; line-height: 32px; font-weight: 800; letter-spacing: -0.5px; color: #ffffff;">eventimus</td></tr>
          <tr><td bgcolor="#1f2937" style="background: #1f2937; border-top: 4px solid #c8ff00; border-radius: 12px; padding: 36px 32px;">
            <h1 style="margin: 0 0 12px; color: #ffffff; font-size: 22px; line-height: 30px; font-weight: 700;">Sign in to Eventimus</h1>
            <p style="margin: 0 0 28px; color: #d1d5db; font-size: 15px; line-height: 24px;">Use the button below to finish signing in. No password needed.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td align="center" bgcolor="#c8ff00" style="background: #c8ff00; border-radius: 8px;">
                <a href="${href}" target="_blank" style="display: block; padding: 14px 24px; color: #111827; font-size: 16px; font-weight: 700; text-decoration: none;">Sign in</a>
              </td></tr>
            </table>
            <p style="margin: 28px 0 0; color: #9ca3af; font-size: 13px; line-height: 20px;">The link works once and expires in 24 hours. If you didn’t ask to sign in, ignore this email: nobody can sign in without it.</p>
          </td></tr>
          <tr><td align="center" style="padding: 24px 0 0; color: #6b7280; font-size: 12px; line-height: 18px;">Sent by Eventimus because of activity on your account.</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function signInEmailText(url: string): string {
  return `Sign in to Eventimus\n\n${url}\n\nThe link works once and expires in 24 hours. If you didn't ask to sign in, ignore this email.`;
}

/** Auth.js `sendVerificationRequest` for the Resend provider. */
export async function sendSignInEmail({
  identifier,
  url,
  provider,
}: {
  identifier: string;
  url: string;
  provider: { apiKey?: string; from?: string };
}) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: provider.from,
      to: identifier,
      subject: 'Sign in to Eventimus',
      html: signInEmailHtml(url),
      text: signInEmailText(url),
    }),
  });
  if (!res.ok) throw new Error('Resend error: ' + JSON.stringify(await res.json()));
}
