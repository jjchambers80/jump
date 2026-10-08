// Email Service
// Sends order confirmations and cancellation notifications
// Uses Resend SDK per research.md R3, FR-036, FR-037

import resend from '../config/resend.js';
import logger from '../utils/logger.js';
import { orderUrl } from '../utils/storefrontUrl.js';
import { formatEventDateTime } from '../utils/eventTime.js';
import { absoluteAssetUrl } from '../utils/publicUrl.js';
import { emailBrand } from '../utils/emailBrand.js';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Centered organizer logo for the top of an email header. Empty string when
 * the organization has no logo so the header renders unchanged.
 */
function orgLogoHtml(logoUrl, orgName) {
  const src = absoluteAssetUrl(logoUrl);
  if (!src) return '';
  return `<img src="${src}" alt="${escapeHtml(orgName || 'Organizer')}" style="display: block; margin: 0 auto 16px; max-height: 60px; max-width: 240px; width: auto; height: auto;" />`;
}

/**
 * The platform From address shown under another display name, e.g.
 * `"Raleigh Retro Gamers" <noreply@eventimus.net>`. The display name needs no
 * DNS setup; only the address must be on the verified sending domain.
 */
function fromAs(displayName) {
  const platform = process.env.RESEND_FROM_EMAIL || 'Jump <noreply@jump.events>';
  const address = platform.match(/<([^>]+)>/)?.[1] || platform.trim();
  const name = String(displayName || '').replace(/[\r\n"\\]/g, '').trim();
  return name ? `"${name}" <${address}>` : platform;
}

/**
 * Send through Resend. The SDK resolves `{ data, error }` instead of throwing
 * when Resend refuses a message (unverified sender domain, sandbox sender to
 * a foreign address, bad key), so a refusal is turned into a throw here;
 * otherwise every caller would log "sent" for an email that never left.
 */
async function deliver(msg) {
  const result = await resend.emails.send(msg);
  if (result?.error) {
    throw new Error(`Resend refused the email (${result.error.name || 'error'}): ${result.error.message}`);
  }
  return result?.data ?? null;
}

/**
 * Eventimus shell for platform (staff account) email, matching the sign-in
 * page: gray-900 page, gray-800 card under a lime rule, white wordmark.
 * frontend/src/lib/signInEmail.ts renders the sign-in link email the same way.
 */
function eventimusEmail({ preheader, heading, body }) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
  </head>
  <body style="margin: 0; padding: 0; background: #111827;">
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#111827" style="background: #111827;">
      <tr><td align="center" style="padding: 40px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 480px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">
          <tr><td align="center" style="padding: 0 0 24px; font-size: 26px; line-height: 32px; font-weight: 800; letter-spacing: -0.5px; color: #ffffff;">eventimus</td></tr>
          <tr><td bgcolor="#1f2937" style="background: #1f2937; border-top: 4px solid #c8ff00; border-radius: 12px; padding: 36px 32px;">
            <h1 style="margin: 0 0 12px; color: #ffffff; font-size: 22px; line-height: 30px; font-weight: 700;">${escapeHtml(heading)}</h1>
            ${body}
          </td></tr>
          <tr><td align="center" style="padding: 24px 0 0; color: #6b7280; font-size: 12px; line-height: 18px;">Sent by Eventimus because of activity on your account.</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

const EV_P = 'margin: 0 0 16px; color: #d1d5db; font-size: 15px; line-height: 24px;';
const EV_NOTE = 'margin: 24px 0 0; color: #9ca3af; font-size: 13px; line-height: 20px;';
const EV_STRONG = 'color: #ffffff;';

/** Lime full-width button for eventimusEmail(). */
function eventimusButton(href, label) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 28px 0 0;">
              <tr><td align="center" bgcolor="#c8ff00" style="background: #c8ff00; border-radius: 8px;">
                <a href="${escapeHtml(href)}" target="_blank" style="display: block; padding: 14px 24px; color: #111827; font-size: 16px; font-weight: 700; text-decoration: none;">${escapeHtml(label)}</a>
              </td></tr>
            </table>`;
}

function icsText(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function icsDate(value) {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

class EmailService {
  /**
   * Send order confirmation email with View Tickets link (FR-036)
   * Fire-and-forget with async retry — does not block order completion.
   * @param {Object} order - Order object with contact, event, tickets
   * @param {Array} tickets - Ticket objects with barcode, pricePaid
   * @param {Object} [options]
   * @param {string|null} [options.manageTicketsUrl] - Buyer account magic link (spec 007);
   *   present only when the buyer opted into an account at checkout
   */
  async sendOrderConfirmation(order, tickets, { manageTicketsUrl = null } = {}) {
    const maxRetries = 3;
    let attempt = 0;
    let lastError;

    const viewTicketsUrl = await orderUrl(order.id, order.event?.organizationId);
    const b = emailBrand(order.event?.organizationBrandColor);
    const orgName = order.event?.organizationName || 'the organizer';
    const manageTicketsHtml = manageTicketsUrl
      ? `
                  <div style="background: #f8f9fa; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px;">
                    <p style="margin: 0 0 12px; color: #333; font-size: 14px;"><strong>Your account with ${escapeHtml(orgName)} is ready.</strong> No password needed — use the button below to sign in and manage your tickets any time.</p>
                    <div style="text-align: center;">
                      <a href="${manageTicketsUrl}" style="display: inline-block; background-color: #111827; color: #ffffff; font-size: 14px; font-weight: bold; padding: 10px 24px; border-radius: 8px; text-decoration: none;">Manage your tickets</a>
                    </div>
                    <p style="margin: 12px 0 0; color: #666; font-size: 12px;">This sign-in link works once and expires in 7 days. You can request a new one from the ${escapeHtml(orgName)} page whenever you need it.</p>
                  </div>`
      : '';

    // Build a simple tier summary (e.g. "2x VIP, 1x General")
    const tierCounts = {};
    for (const ticket of tickets) {
      const name = ticket.priceTier?.name || 'General';
      tierCounts[name] = (tierCounts[name] || 0) + 1;
    }
    const tierSummary = Object.entries(tierCounts)
      .map(([name, count]) => `${count}x ${name}`)
      .join(', ');
    // Add-on lines (spec 012) — bought with the tickets, no QR code of their own
    const addOnSummary = (order.addOns || [])
      .map((line) => `${line.quantity}x ${escapeHtml(line.name || 'Add-on')}`)
      .join(', ');

    while (attempt < maxRetries) {
      try {
        attempt++;

        const msg = {
          to: [order.contact?.email || order.contactEmail],
          from: fromAs(order.event?.organizationName),
          subject: `Order Confirmed — ${order.event?.name || 'Your Event'} (${order.orderRef})`,
          html: `
            <html>
              <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb;">
                <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
                  ${orgLogoHtml(order.event?.organizationLogoUrl, order.event?.organizationName)}
                  <h1 style="color: #333;">🎟️ Order Confirmed!</h1>
                </div>
                <div style="padding: 20px;">
                  <p>Hi ${order.contact?.firstName || 'there'},</p>
                  <p>Your order <strong>${order.orderRef}</strong> has been confirmed.</p>

                  <div style="background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 24px 0;">
                    <h3 style="margin: 0 0 12px;">${order.event?.name || 'Event'}</h3>
                    <p style="margin: 4px 0; color: #666; font-size: 14px;"><strong>Tickets:</strong> ${tierSummary}</p>
                    ${addOnSummary ? `<p style="margin: 4px 0; color: #666; font-size: 14px;"><strong>Add-ons:</strong> ${addOnSummary}</p>` : ''}
                    <p style="margin: 4px 0; color: #666; font-size: 14px;"><strong>Total:</strong> $${Number(order.totalAmount).toFixed(2)}</p>
                    <p style="margin: 4px 0; color: #666; font-size: 14px;"><strong>Order Ref:</strong> ${order.orderRef}</p>
                  </div>

                  <div style="text-align: center; margin: 32px 0;">
                    <a href="${viewTicketsUrl}" style="display: inline-block; background-color: ${b.brand}; color: ${b.onBrand}; font-size: 16px; font-weight: bold; padding: 14px 32px; border-radius: 8px; text-decoration: none;">View Tickets</a>
                  </div>

                  <p style="color: #666; font-size: 14px;">Your QR codes for event entry are available on the tickets page. Present them at the venue entrance — each ticket is valid for one entry.</p>
${manageTicketsHtml}
                  <p style="color: #666; font-size: 12px; margin-top: 16px;">Order reference: ${order.orderRef}</p>
                </div>
              </body>
            </html>
          `,
        };

        await deliver(msg);

        logger.info('Order confirmation email sent', {
          orderId: order.id,
          orderRef: order.orderRef,
          email: order.contact?.email,
          ticketCount: tickets.length,
          attempt,
        });

        return;
      } catch (error) {
        lastError = error;
        logger.warn('Order confirmation email attempt failed', {
          orderId: order.id,
          attempt,
          error: error.message,
        });
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    logger.error('Failed to send order confirmation after all retries', {
      orderId: order.id,
      orderRef: order.orderRef,
      attempts: maxRetries,
      error: lastError?.message,
    });
    // Don't throw — email failure must not break the order flow
  }

  /**
   * Send a passwordless sign-in link to a buyer (spec 007 phase 2).
   * Single attempt: the buyer can request another link if this one is lost.
   *
   * @param {Object} params
   * @param {{ email: string, firstName?: string, organizationId: string }} params.contact
   * @param {string} params.loginUrl - Single-use verify URL
   * @param {{ name?: string, logoUrl?: string }} [params.organization]
   */
  async sendBuyerLoginEmail({ contact, loginUrl, organization = {}, code = null }) {
    const b = emailBrand(organization.brandColor);
    const orgName = organization.name || 'Jump';
    // Spec 031 phase 3: CODE organizations get the six digits up top; the link stays as a fallback.
    const codeHtml = code
      ? `
              <p>Enter this code on the sign-in page:</p>
              <p style="text-align: center; margin: 24px 0; font-size: 32px; font-weight: bold; letter-spacing: 8px; font-family: 'SF Mono', Menlo, Consolas, monospace;">${escapeHtml(code.slice(0, 3))} ${escapeHtml(code.slice(3))}</p>
              <p style="color: #666; font-size: 13px;">The code expires in 10 minutes. Or use the button below instead.</p>`
      : `
              <p>Use the button below to sign in and see your tickets and orders with ${escapeHtml(orgName)}.</p>`;
    const msg = {
      to: [contact.email],
      from: fromAs(organization.name),
      subject: code ? `${code} is your sign-in code for ${orgName}` : `Your sign-in link for ${orgName}`,
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb;">
            <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
              ${orgLogoHtml(organization.logoUrl, orgName)}
              <h1 style="color: #333; font-size: 22px;">Sign in to ${escapeHtml(orgName)}</h1>
            </div>
            <div style="padding: 20px;">
              <p>Hi ${escapeHtml(contact.firstName || 'there')},</p>${codeHtml}
              <div style="text-align: center; margin: 32px 0;">
                <a href="${loginUrl}" style="display: inline-block; background-color: ${b.brand}; color: ${b.onBrand}; font-size: 16px; font-weight: bold; padding: 14px 32px; border-radius: 8px; text-decoration: none;">Sign in</a>
              </div>
              <p style="color: #666; font-size: 13px;">This link works once and expires in 15 minutes. If you did not request it, you can ignore this email — nothing changes until the link is used.</p>
            </div>
          </body>
        </html>
      `,
    };

    await deliver(msg);
    logger.info('Buyer login email sent', {
      event: 'buyer_login_email_sent',
      contactId: contact.id,
      organizationId: contact.organizationId,
    });
  }

  /**
   * Plain organization-branded notice to a buyer (spec 040 card D: erasure
   * code, scheduled, postponed, done). `code` renders the six digits large;
   * `link` renders one button.
   * @param {{ to: string, organization: { name?: string, logoUrl?: string|null }, subject: string, title: string, paragraphs: string[], code?: string|null, link?: { url: string, label: string }|null }} params
   */
  async sendBuyerNotice({ to, organization = {}, subject, title, paragraphs, code = null, link = null }) {
    const b = emailBrand(organization.brandColor);
    const orgName = organization.name || 'Jump';
    const msg = {
      to: [to],
      from: fromAs(organization.name),
      subject,
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb;">
            <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
              ${orgLogoHtml(organization.logoUrl, orgName)}
              <h1 style="color: #333; font-size: 22px;">${escapeHtml(title)}</h1>
            </div>
            <div style="padding: 20px;">
              ${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n              ')}
              ${code ? `<p style="text-align: center; margin: 24px 0; font-size: 32px; font-weight: bold; letter-spacing: 8px; font-family: 'SF Mono', Menlo, Consolas, monospace;">${escapeHtml(code.slice(0, 3))} ${escapeHtml(code.slice(3))}</p>` : ''}
              ${link ? `<div style="text-align: center; margin: 32px 0;"><a href="${link.url}" style="display: inline-block; background-color: ${b.brand}; color: ${b.onBrand}; font-size: 16px; font-weight: bold; padding: 14px 32px; border-radius: 8px; text-decoration: none;">${escapeHtml(link.label)}</a></div>` : ''}
            </div>
          </body>
        </html>
      `,
    };
    await deliver(msg);
    logger.info('Buyer notice sent', { event: 'buyer_notice_sent', subject });
  }

  /**
   * Buyer email change (spec 040): confirmation link to the NEW address.
   * Nothing changes until the link is used.
   * @param {{ to: string, currentEmail: string, confirmUrl: string, organization: { name?: string, logoUrl?: string|null } }} params
   */
  async sendBuyerEmailChangeConfirmation({ to, currentEmail, confirmUrl, organization = {} }) {
    const b = emailBrand(organization.brandColor);
    const orgName = organization.name || 'Jump';
    const msg = {
      to: [to],
      from: fromAs(organization.name),
      subject: `Confirm your new email address for ${orgName}`,
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb;">
            <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
              ${orgLogoHtml(organization.logoUrl, orgName)}
              <h1 style="color: #333; font-size: 22px;">Confirm your new email</h1>
            </div>
            <div style="padding: 20px;">
              <p>You asked to change the email address on your ${escapeHtml(orgName)} account from <strong>${escapeHtml(currentEmail)}</strong> to <strong>${escapeHtml(to)}</strong>.</p>
              <div style="text-align: center; margin: 32px 0;">
                <a href="${confirmUrl}" style="display: inline-block; background-color: ${b.brand}; color: ${b.onBrand}; font-size: 16px; font-weight: bold; padding: 14px 32px; border-radius: 8px; text-decoration: none;">Confirm email address</a>
              </div>
              <p style="color: #666; font-size: 13px;">This link works once and expires in 1 hour. If you did not request this change, you can ignore this email — your email address stays the same until the link is used.</p>
            </div>
          </body>
        </html>
      `,
    };
    await deliver(msg);
    logger.info('Buyer email change confirmation sent', { event: 'buyer_email_change_sent' });
  }

  /**
   * Buyer email change (spec 040): notice to the OLD address. Sent when the
   * change is requested and again when it completes.
   * @param {{ to: string, newEmail: string, completed: boolean, organization: { name?: string, logoUrl?: string|null } }} params
   */
  async sendBuyerEmailChangeNotice({ to, newEmail, completed, organization = {} }) {
    const orgName = organization.name || 'Jump';
    const body = completed
      ? `The email address on your ${escapeHtml(orgName)} account was changed from <strong>${escapeHtml(to)}</strong> to <strong>${escapeHtml(newEmail)}</strong>. Sign-in links and ticket emails now go to the new address.`
      : `Someone signed in to your ${escapeHtml(orgName)} account asked to change its email address to <strong>${escapeHtml(newEmail)}</strong>. Nothing changes unless that address confirms.`;
    const msg = {
      to: [to],
      from: fromAs(organization.name),
      subject: completed ? `Your ${orgName} email address was changed` : `Email change requested for your ${orgName} account`,
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb;">
            <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
              ${orgLogoHtml(organization.logoUrl, orgName)}
              <h1 style="color: #333; font-size: 22px;">${completed ? 'Email address changed' : 'Email change requested'}</h1>
            </div>
            <div style="padding: 20px;">
              <p>${body}</p>
              <p style="color: #666; font-size: 13px;">If this was not you, contact ${escapeHtml(orgName)} right away.</p>
            </div>
          </body>
        </html>
      `,
    };
    await deliver(msg);
    logger.info('Buyer email change notice sent', { event: 'buyer_email_change_notice_sent', completed });
  }

  /**
   * Confirmation link for a staff account email change (spec 030). Sent to
   * the NEW address; nothing changes until it is used.
   * @param {{ to: string, currentEmail: string, confirmUrl: string }} params
   */
  async sendEmailChangeConfirmation({ to, currentEmail, confirmUrl }) {
    const msg = {
      to: [to],
      from: process.env.RESEND_FROM_EMAIL || 'Jump <noreply@jump.events>',
      subject: 'Confirm your new email address for Eventimus',
      text: `You asked to change the email on your Eventimus account from ${currentEmail} to ${to}.\n\nConfirm: ${confirmUrl}\n\nThis link works once and expires in 1 hour. If you did not request this change, ignore this email.`,
      html: eventimusEmail({
        preheader: 'Confirm the new email address on your Eventimus account.',
        heading: 'Confirm your new email',
        body: `
          <p style="${EV_P}">You asked to change the email address on your Eventimus account from <strong style="${EV_STRONG}">${escapeHtml(currentEmail)}</strong> to <strong style="${EV_STRONG}">${escapeHtml(to)}</strong>.</p>
          ${eventimusButton(confirmUrl, 'Confirm email address')}
          <p style="${EV_NOTE}">This link works once and expires in 1 hour. If you did not request this change, ignore this email: your email address stays the same until the link is used.</p>`,
      }),
    };

    await deliver(msg);
    logger.info('Email change confirmation sent', { event: 'account_email_change_sent' });
  }


  /**
   * Notice to the OLD address after an email change completed (spec 030).
   * @param {{ to: string, newEmail: string }} params
   */
  async sendEmailChangedNotice({ to, newEmail }) {
    const msg = {
      to: [to],
      from: process.env.RESEND_FROM_EMAIL || 'Jump <noreply@jump.events>',
      subject: 'Your Eventimus email address was changed',
      text: `The email address on your Eventimus account was changed from ${to} to ${newEmail}. Sign-in links now go to the new address.\n\nIf you did not make this change, reply to this email right away so we can help secure your account.`,
      html: eventimusEmail({
        preheader: `Your Eventimus email address is now ${newEmail}.`,
        heading: 'Email address changed',
        body: `
          <p style="${EV_P}">The email address on your Eventimus account was changed from <strong style="${EV_STRONG}">${escapeHtml(to)}</strong> to <strong style="${EV_STRONG}">${escapeHtml(newEmail)}</strong>. Sign-in links now go to the new address.</p>
          <p style="${EV_NOTE}">If you did not make this change, reply to this email right away so we can help secure your account.</p>`,
      }),
    };

    await deliver(msg);
    logger.info('Email changed notice sent', { event: 'account_email_changed_notice_sent' });
  }


  /**
   * Plain security notice for account changes (spec 030): sessions signed
   * out, password / passkey / provider changes. `body` is plain text.
   * @param {{ to: string|string[], title: string, body: string }} params
   */
  async sendSecurityNotice({ to, title, body }) {
    const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
    if (recipients.length === 0) return;
    const msg = {
      to: recipients,
      from: process.env.RESEND_FROM_EMAIL || 'Jump <noreply@jump.events>',
      subject: `Eventimus security: ${title}`,
      text: `${title}\n\n${body}\n\nThis message was sent because a security setting on your Eventimus account changed.`,
      html: eventimusEmail({
        preheader: body,
        heading: title,
        body: `
          <p style="${EV_P}">${escapeHtml(body)}</p>
          <p style="${EV_NOTE}">This message was sent because a security setting on your Eventimus account changed.</p>`,
      }),
    };
    await deliver(msg);
    logger.info('Security notice sent', { event: 'security_notice_sent', title });
  }


  /** Six-digit step-up code (spec 030 B). Eventimus-branded: staff account email. */
  async sendReauthCode({ to, code }) {
    const msg = {
      to: [to],
      from: process.env.RESEND_FROM_EMAIL || 'Jump <noreply@jump.events>',
      subject: `${code} is your Eventimus verification code`,
      text: `Your Eventimus verification code is ${code}\n\nEnter it to confirm a security change on your account. It expires in 10 minutes. If you didn't request it, ignore this email: nothing changes without the code.`,
      html: eventimusEmail({
        preheader: `${code} is your verification code. It expires in 10 minutes.`,
        heading: 'Confirm it’s you',
        body: `
          <p style="margin: 0 0 24px; color: #d1d5db; font-size: 15px; line-height: 24px;">Enter this code in Eventimus to confirm a security change on your account.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td align="center" bgcolor="#111827" style="background: #111827; border: 1px solid #374151; border-radius: 10px; padding: 22px 12px;">
              <span style="font-family: 'SFMono-Regular', Menlo, Consolas, monospace; font-size: 34px; line-height: 40px; font-weight: 700; letter-spacing: 10px; color: #c8ff00;">${escapeHtml(code)}</span>
            </td></tr>
          </table>
          <p style="margin: 24px 0 0; color: #9ca3af; font-size: 13px; line-height: 20px;">It expires in 10 minutes. If you didn’t request it, ignore this email: nothing changes without the code.</p>`,
      }),
    };
    await deliver(msg);
    logger.info('Reauth code sent', { event: 'reauth_code_sent' });
  }

  /** Verification link for a secondary (recovery) email (spec 030 B). */
  async sendSecondaryEmailVerification({ to, confirmUrl }) {
    const msg = {
      to: [to],
      from: process.env.RESEND_FROM_EMAIL || 'Jump <noreply@jump.events>',
      subject: 'Verify your secondary email for Eventimus',
      text: `This address was added as the secondary email on an Eventimus account.\n\nVerify: ${confirmUrl}\n\nThis link works once and expires in 1 hour. If you didn't add this address, ignore this email.`,
      html: eventimusEmail({
        preheader: 'Verify this address to use it for account recovery.',
        heading: 'Verify this email',
        body: `
          <p style="${EV_P}">This address was added as the secondary email on an Eventimus account. Once verified it can be used to restore access to that account, and security notifications are sent here too.</p>
          ${eventimusButton(confirmUrl, 'Verify email address')}
          <p style="${EV_NOTE}">This link works once and expires in 1 hour. If you didn’t add this address, ignore this email.</p>`,
      }),
    };
    await deliver(msg);
    logger.info('Secondary email verification sent', { event: 'secondary_email_verification_sent' });
  }


  /** One-time recovery sign-in link, sent to the verified secondary address (spec 030 B). */
  async sendRecoveryLink({ to, primaryEmail, recoverUrl }) {
    const msg = {
      to: [to],
      from: process.env.RESEND_FROM_EMAIL || 'Jump <noreply@jump.events>',
      subject: 'Restore access to your Eventimus account',
      text: `Use this link to sign in to the Eventimus account ${primaryEmail}. This address is its secondary email.\n\n${recoverUrl}\n\nThis link works once and expires in 15 minutes. If you didn't request it, ignore this email and consider reviewing Account › Security.`,
      html: eventimusEmail({
        preheader: `Sign in to ${primaryEmail} with this one-time link.`,
        heading: 'Restore access',
        body: `
          <p style="${EV_P}">Use the button below to sign in to the Eventimus account <strong style="${EV_STRONG}">${escapeHtml(primaryEmail)}</strong>. This address is its secondary email.</p>
          ${eventimusButton(recoverUrl, 'Sign in')}
          <p style="${EV_NOTE}">This link works once and expires in 15 minutes. If you didn’t request it, ignore this email and consider reviewing Account › Security.</p>`,
      }),
    };
    await deliver(msg);
    logger.info('Recovery link sent', { event: 'recovery_link_sent' });
  }


  /**
   * Invitation to an organization's admin (Settings › Users › Add users).
   * Platform-branded: the button opens the Eventimus sign-in page, so the
   * email matches where it lands; the organization is named in the copy.
   * The user and membership already exist, so email link or Google both land
   * on that account.
   * @param {{ to: string, organizationName: string, inviterName: string, role: 'ADMIN'|'ORGANIZER', requireTwoStep: boolean, signInUrl: string }} params
   */
  async sendStaffInvite({ to, organizationName, inviterName, role, requireTwoStep, signInUrl }) {
    const b = emailBrand(null);
    const roleLabel = role === 'ADMIN' ? 'an Admin' : 'an Organizer';
    const msg = {
      to: [to],
      from: process.env.RESEND_FROM_EMAIL || 'Jump <noreply@jump.events>',
      subject: `${organizationName} invited you to Eventimus`,
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb;">
            <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
              <p style="margin: 0 0 8px; color: #6b7280; font-size: 13px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase;">Eventimus</p>
              <h1 style="color: #333; font-size: 22px;">Join ${escapeHtml(organizationName)} on Eventimus</h1>
            </div>
            <div style="padding: 20px;">
              <p>${escapeHtml(inviterName)} added you to <strong>${escapeHtml(organizationName)}</strong> as ${roleLabel}.</p>
              <p>Sign in with this email address, <a href="mailto:${escapeHtml(to)}" style="color: ${b.link}; font-weight: bold;">${escapeHtml(to)}</a>. You can get a sign-in link by email or continue with Google.</p>
              ${requireTwoStep ? '<p><strong>Two-step authentication is required.</strong> After you sign in you will be asked to set it up under Account › Security before you can use the admin.</p>' : ''}
              <div style="text-align: center; margin: 32px 0;">
                <a href="${escapeHtml(signInUrl)}" style="display: inline-block; background-color: ${b.brand}; color: ${b.onBrand}; font-size: 16px; font-weight: bold; padding: 14px 32px; border-radius: 8px; text-decoration: none;">Sign in</a>
              </div>
              <p style="color: #666; font-size: 13px;">If you weren't expecting this, you can ignore this email.</p>
            </div>
          </body>
        </html>
      `,
    };
    await deliver(msg);
    logger.info('Staff invite sent', { event: 'staff_invite_sent' });
  }

  /**
   * Send an application decision / status email (spec 011). `body` is plain
   * text already rendered from the organization's template; paragraphs are
   * split on blank lines and every line is escaped, so organizer text can
   * never inject markup. URLs on their own line become buttons.
   *
   * @param {{ to: string, subject: string, body: string, organization?: { name?: string, logoUrl?: string, email?: string }, staff?: boolean }} params
   *   Replies go to `organization.email` when the organization has one.
   *   `staff: true` (digest, dispute alerts) keeps the platform sender and
   *   colors and drops the logo: those links open the Eventimus admin.
   */
  async sendApplicationMessage({ to, subject, body, organization = {}, staff = false }) {
    const b = emailBrand(staff ? null : organization.brandColor);
    const orgName = organization.name || 'the organizer';
    const paragraphs = String(body || '')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        if (/^https?:\/\/\S+$/.test(p)) {
          return `<div style="text-align: center; margin: 24px 0;"><a href="${escapeHtml(p)}" style="display: inline-block; background-color: ${b.brand}; color: ${b.onBrand}; font-size: 15px; font-weight: bold; padding: 12px 28px; border-radius: 8px; text-decoration: none;">Open</a></div>`;
        }
        const lines = p.split('\n').map((line) => {
          const escaped = escapeHtml(line);
          return escaped.replace(/(https?:\/\/[^\s<]+)/g, `<a href="$1" style="color: ${b.link};">$1</a>`);
        });
        return `<p style="margin: 0 0 14px; line-height: 1.5;">${lines.join('<br />')}</p>`;
      })
      .join('');

    const msg = {
      to: [to],
      from: fromAs(staff ? null : organization.name),
      subject,
      text: body,
      ...(organization.email && { reply_to: organization.email }),
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb;">
            <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
              ${staff ? '' : orgLogoHtml(organization.logoUrl, orgName)}
              <h1 style="color: #333; font-size: 20px; margin: 0;">${escapeHtml(orgName)}</h1>
            </div>
            <div style="padding: 24px; color: #111827; font-size: 15px;">
              ${paragraphs}
            </div>
          </body>
        </html>
      `,
    };
    await deliver(msg);
  }

  /**
   * Storefront contact-form message (spec 042) to the store email. Every
   * visitor value is escaped; replies go straight to the visitor. Nothing is
   * sent to the visitor, so the form can never relay mail to a third party.
   *
   * @param {{ to: string, inquiry: { name: string, email: string, phone?: string|null, subject?: string|null, message: string }, organization?: { name?: string, logoUrl?: string }, pageTitle?: string }} params
   */
  async sendContactInquiry({ to, inquiry, organization = {}, pageTitle }) {
    const orgName = organization.name || 'your store';
    const oneLine = (value) => String(value || '').replace(/[\r\n]+/g, ' ').trim();
    const subject = oneLine(
      inquiry.subject
        ? `${inquiry.subject} — message from ${inquiry.name}`
        : `New message from ${inquiry.name} via ${orgName}`
    ).slice(0, 200);
    const rows = [
      ['Name', inquiry.name],
      ['Email', inquiry.email],
      ['Phone', inquiry.phone],
      ['Subject', inquiry.subject],
      ['Page', pageTitle],
    ].filter(([, value]) => value);
    const text = [
      `New message from the ${orgName} contact form.`,
      '',
      ...rows.map(([label, value]) => `${label}: ${oneLine(value)}`),
      '',
      inquiry.message,
      '',
      'Reply to this email to answer the sender.',
    ].join('\n');
    const messageHtml = escapeHtml(inquiry.message).replace(/\r?\n/g, '<br />');
    const msg = {
      to: [to],
      from: process.env.RESEND_FROM_EMAIL || 'Jump <noreply@jump.events>',
      subject,
      reply_to: inquiry.email,
      text,
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb;">
            <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
              ${orgLogoHtml(organization.logoUrl, orgName)}
              <h1 style="color: #333; font-size: 20px; margin: 0;">New contact form message</h1>
            </div>
            <div style="padding: 24px; color: #111827; font-size: 15px;">
              <table style="border-collapse: collapse; margin-bottom: 16px;">
                ${rows
                  .map(
                    ([label, value]) =>
                      `<tr><td style="padding: 4px 16px 4px 0; color: #6b7280;">${label}</td><td style="padding: 4px 0;">${escapeHtml(oneLine(value))}</td></tr>`
                  )
                  .join('')}
              </table>
              <p style="margin: 0 0 14px; line-height: 1.5; white-space: normal;">${messageHtml}</p>
              <p style="color: #6b7280; font-size: 13px;">Reply to this email to answer ${escapeHtml(oneLine(inquiry.name))}.</p>
            </div>
          </body>
        </html>
      `,
    };
    await deliver(msg);
  }

  /**
   * Send cancellation notification to all ticket holders (FR-037)
   * @param {Object} event - Event object
   * @param {Array} tickets - Tickets to notify (with contact relations)
   */
  async sendCancellationNotification(event, tickets) {
    // Spec 033: the event date belongs to the venue's zone, not the server's.
    const eventWhen = formatEventDateTime(event.date, event.venue?.timezone);
    const isRsvp = event.admissionMode === 'RSVP';
    // Group tickets by contact email to avoid duplicate emails
    const contactEmails = new Map();
    for (const ticket of tickets) {
      const email = ticket.contact?.email;
      if (email && !contactEmails.has(email)) {
        contactEmails.set(email, ticket.contact);
      }
    }

    for (const [email, contact] of contactEmails) {
      try {
        const msg = {
          to: [email],
          from: fromAs(event.organizationName ?? event.venue?.organization?.name),
          subject: `Event Cancelled — ${event.name}`,
          html: `
            <html>
              <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #fee2e2; padding: 20px; text-align: center;">
                  ${orgLogoHtml(
                    event.organizationLogoUrl ?? event.venue?.organization?.logoUrl,
                    event.organizationName ?? event.venue?.organization?.name
                  )}
                  <h1 style="color: #991b1b;">Event Cancelled</h1>
                </div>
                <div style="padding: 20px;">
                  <p>Hi ${contact.firstName || 'there'},</p>
                  <p>We're sorry to inform you that <strong>${event.name}</strong> has been cancelled.</p>
                  ${eventWhen ? `<p style="color: #666; font-size: 14px; margin-top: -8px;">${escapeHtml(eventWhen)}</p>` : ''}
                  <p>${isRsvp ? 'Your RSVP has been cancelled; no action is needed.' : 'Your tickets have been voided and a refund will be processed automatically.'}</p>
                  <p style="color: #666; font-size: 12px;">If you have questions, contact us at support@jump.events</p>
                </div>
              </body>
            </html>
          `,
        };

        await deliver(msg);

        logger.info('Cancellation notification sent', {
          eventId: event.id,
          email,
        });
      } catch (error) {
        logger.error('Failed to send cancellation notification', {
          eventId: event.id,
          email,
          error: error.message,
        });
        // Continue sending to other contacts
      }
    }
  }

  /**
   * RSVP reminder sent ~24 h before the event (spec 034 §9.2). Branded with
   * the organization's logo; includes the event name, date/time in the venue's
   * timezone (spec 033), party size, a cancel link, and a marketing opt-in
   * note. Fire-and-forget with async retry (3 attempts).
   *
   * @param {Object} rsvp - EventRsvp row with included event (incl. venue), contact
   * @param {{ cancelUrl: string }} options
   */
  async sendRsvpReminder(rsvp, { cancelUrl }) {
    const event = rsvp.event;
    const contact = rsvp.contact;
    const organization = event.venue?.organization || {};
    const eventWhen = formatEventDateTime(event.date, event.venue?.timezone);
    const orgName = organization.name || 'the organizer';
    const maxRetries = 3;
    let attempt = 0;
    let lastError;

    while (attempt < maxRetries) {
      try {
        attempt++;

        const msg = {
          to: [contact.email],
          from: fromAs(organization.name),
          subject: `Reminder: ${event.name} is happening tomorrow — ${orgName}`,
          html: `
            <html>
              <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb;">
                <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
                  ${orgLogoHtml(organization.logoUrl, orgName)}
                  <h1 style="color: #333; font-size: 22px;">Event Reminder — ${escapeHtml(event.name)}</h1>
                </div>
                <div style="padding: 24px; color: #111827; font-size: 15px;">
                  <p>Hi ${escapeHtml(contact.firstName || 'there')},</p>
                  <p>This is a reminder that you're on the list for:</p>
                  <div style="background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 24px 0;">
                    <p style="margin: 0 0 8px; font-size: 17px; font-weight: bold; color: #111827;">${escapeHtml(event.name)}</p>
                    ${eventWhen ? `<p style="margin: 4px 0; color: #666; font-size: 14px;"><strong>When:</strong> ${escapeHtml(eventWhen)}</p>` : ''}
                    <p style="margin: 4px 0; color: #666; font-size: 14px;"><strong>Party size:</strong> ${rsvp.partySize}</p>
                  </div>
                  <p style="color: #666; font-size: 14px;">You can cancel your RSVP at any time. Please let us know if your plans change so we can open the spot to someone else.</p>
                  <div style="text-align: center; margin: 24px 0;">
                    <a href="${cancelUrl}" style="display: inline-block; background-color: #dc2626; color: #ffffff; font-size: 15px; font-weight: bold; padding: 12px 28px; border-radius: 8px; text-decoration: none;">Cancel RSVP</a>
                  </div>
                  <p style="color: #666; font-size: 12px; margin-top: 16px;">You received this reminder because you RSVP'd to this event. Cancelling your RSVP stops further emails about it.</p>
                  <p style="color: #999; font-size: 12px; margin-top: 24px;">${escapeHtml(orgName)}</p>
                </div>
              </body>
            </html>
          `,
          text: [
            `Hi ${contact.firstName || 'there'},`,
            '',
            `This is a reminder that you're on the list for:`,
            '',
            `${event.name}`,
            ...(eventWhen ? [`When: ${eventWhen}`] : []),
            `Party size: ${rsvp.partySize}`,
            '',
            `You can cancel your RSVP at any time: ${cancelUrl}`,
            '',
            `You received this reminder because you RSVP'd to this event. Cancelling your RSVP stops further emails about it.`,
            '',
            orgName,
          ].join('\n'),
          ...(organization.email && { reply_to: organization.email }),
        };

        await deliver(msg);

        logger.info('RSVP reminder sent', {
          event: 'rsvp_reminder_sent',
          rsvpId: rsvp.id,
          eventId: rsvp.eventId,
          contactId: rsvp.contactId,
          email: contact.email,
          attempt,
        });

        return;
      } catch (error) {
        lastError = error;
        logger.warn('RSVP reminder email attempt failed', {
          rsvpId: rsvp.id,
          attempt,
          error: error.message,
        });
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    logger.error('Failed to send RSVP reminder after all retries', {
      rsvpId: rsvp.id,
      eventId: rsvp.eventId,
      contactId: rsvp.contactId,
      attempts: maxRetries,
      error: lastError?.message,
    });
  }

  /** Branded RSVP confirmation with a calendar attachment (spec 034). */
  async sendRsvpConfirmation(rsvp, { cancelUrl }) {
    const event = rsvp.event;
    const contact = rsvp.contact;
    const organization = event.venue?.organization || {};
    const b = emailBrand(organization.brandColor);
    const eventWhen = formatEventDateTime(event.date, event.venue?.timezone);
    const startsAt = new Date(event.date);
    const endsAt = new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);
    const location = [event.venue?.name, event.venue?.address].filter(Boolean).join(', ');
    const calendar = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Jump//RSVP//EN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT', `UID:rsvp-${rsvp.id}@jump.events`, `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(startsAt)}`, `DTEND:${icsDate(endsAt)}`,
      `SUMMARY:${icsText(event.name)}`, `LOCATION:${icsText(location)}`,
      'END:VEVENT', 'END:VCALENDAR', '',
    ].join('\r\n');
    const msg = {
      to: [contact.email],
      from: fromAs(organization.name),
      subject: `You're on the list — ${event.name}`,
      text: [
        `Hi ${contact.firstName || 'there'},`, '', `You're on the list for ${event.name}.`,
        ...(eventWhen ? [`When: ${eventWhen}`] : []), ...(location ? [`Where: ${location}`] : []),
        `Party size: ${rsvp.partySize}`, '', `Can't make it? Cancel your RSVP: ${cancelUrl}`,
      ].join('\n'),
      html: `
        <html><body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb;">
          <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
            ${orgLogoHtml(organization.logoUrl, organization.name)}
            <h1 style="color: #333; font-size: 22px;">You're on the list</h1>
          </div>
          <div style="padding: 24px; color: #111827;">
            <p>Hi ${escapeHtml(contact.firstName || 'there')},</p>
            <p>Your RSVP for <strong>${escapeHtml(event.name)}</strong> is confirmed.</p>
            <div style="background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 24px 0;">
              ${eventWhen ? `<p style="margin: 4px 0;"><strong>When:</strong> ${escapeHtml(eventWhen)}</p>` : ''}
              ${location ? `<p style="margin: 4px 0;"><strong>Where:</strong> ${escapeHtml(location)}</p>` : ''}
              <p style="margin: 4px 0;"><strong>Party size:</strong> ${rsvp.partySize}</p>
            </div>
            <p style="color: #666; font-size: 13px;">Plans changed? <a href="${escapeHtml(cancelUrl)}" style="color: ${b.link};">Cancel your RSVP</a>.</p>
          </div>
        </body></html>`,
      attachments: [{
        filename: `${String(event.name || 'event').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'event'}.ics`,
        content: Buffer.from(calendar),
      }],
      ...(organization.email && { reply_to: organization.email }),
    };
    try {
      await deliver(msg);
      logger.info('RSVP confirmation sent', { event: 'rsvp_confirmation_sent', rsvpId: rsvp.id });
      return true;
    } catch (error) {
      logger.error('Failed to send RSVP confirmation', { rsvpId: rsvp.id, error: error.message });
      return false;
    }
  }

  /**
   * Receipt for a paid application order (spec 024 phase 2): Jump's own
   * transactional email, sent once when the order reaches COMPLETED through
   * Stripe or an offline payment. No tickets, no QR; the organizer's own
   * templated emails (APPROVED, OFFLINE_PAID) are separate. Never throws.
   *
   * @param {{ order, contact, event: { name, date, venue: { organization } }, profile, tier, form }} application with its order (lines, add-ons, payment)
   * @param {{ statusUrl: string, accountUrl?: string|null, paymentMethod?: string|null, lines: Array<{ label: string, amount: number }>, booth?: { label: string, size: string, mapUrl: string|null }|null }} options
   *   `booth` (spec 014 phase 2): the booth this payment bought, named on the receipt with a `?booth=` map link
   */
  async sendApplicationReceipt(application, { statusUrl, accountUrl = null, paymentMethod = null, lines = [], booth = null }) {
    const order = application.order;
    const organization = application.event?.venue?.organization || {};
    // Spec 033: the event date is wall-clock local to the venue.
    const b = emailBrand(organization.brandColor);
    const eventWhen = formatEventDateTime(application.event?.date, application.event?.venue?.timezone);
    const orgName = organization.name || 'the organizer';
    const to = application.contact?.email;
    if (!order || !to) return false;
    const money = (n) => `$${Number(n || 0).toFixed(2)}`;
    const payment = order.payment;
    const method =
      paymentMethod ||
      (payment?.source === 'OFFLINE'
        ? `${{ CHEQUE: 'Cheque', CASH: 'Cash', BANK_TRANSFER: 'Bank transfer', COMPED: 'Comped', OTHER: 'Other' }[payment.offlineMethod] || 'Offline'}${payment.offlineReference ? ` ${payment.offlineReference}` : ''}`
        : 'Card');
    const rowsHtml = lines
      .map((l) => `<tr><td style="padding: 6px 0; color: #111827; font-size: 14px;">${escapeHtml(l.label)}</td><td style="padding: 6px 0; text-align: right; color: #111827; font-size: 14px;">${money(l.amount)}</td></tr>`)
      .join('');
    // Lines are buyer totals (fees and tax already inside), so only the total follows.
    const summaryRows = [['Total paid', order.totalAmount]]
      .map(([label, amount], i, arr) => `<tr><td style="padding: 6px 0; color: #374151; font-size: 14px; ${i === arr.length - 1 ? 'font-weight: bold;' : ''}">${escapeHtml(label)}</td><td style="padding: 6px 0; text-align: right; color: #111827; font-size: 14px; ${i === arr.length - 1 ? 'font-weight: bold;' : ''}">${money(amount)}</td></tr>`)
      .join('');
    const textLines = [
      `Hi ${application.contact?.firstName || 'there'},`,
      '',
      `This is your receipt for ${application.profile?.businessName || 'your'} application to ${application.event?.name || 'the event'}${application.tier ? ` (${application.tier.name})` : ''}.`,
      ...(eventWhen ? [`When: ${eventWhen}`] : []),
      `Order number: ${order.orderRef}`,
      '',
      ...lines.map((l) => `${l.label}: ${money(l.amount)}`),
      `Total paid: ${money(order.totalAmount)}`,
      `Payment method: ${method}`,
      ...(booth ? ['', `Your booth: ${booth.label}${booth.size ? ` (${booth.size})` : ''}`, ...(booth.mapUrl ? [`See it on the map: ${booth.mapUrl}`] : [])] : []),
      '',
      `Your application: ${statusUrl}`,
      ...(accountUrl ? [`Your account: ${accountUrl}`] : []),
      '',
      orgName,
    ];
    const msg = {
      to: [to],
      from: fromAs(organization.name),
      subject: `Receipt for ${application.event?.name || 'your application'} (${order.orderRef})`,
      text: textLines.join('\n'),
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb;">
            <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
              ${orgLogoHtml(organization.logoUrl, orgName)}
              <h1 style="color: #333; font-size: 20px; margin: 0;">Payment receipt</h1>
            </div>
            <div style="padding: 24px; color: #111827; font-size: 15px;">
              <p>Hi ${escapeHtml(application.contact?.firstName || 'there')},</p>
              <p>This is your receipt for <strong>${escapeHtml(application.profile?.businessName || 'your')}</strong>'s application to <strong>${escapeHtml(application.event?.name || 'the event')}</strong>${application.tier ? ` (${escapeHtml(application.tier.name)})` : ''}.</p>
              <div style="background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <p style="margin: 0 0 12px; color: #666; font-size: 13px;">Order <strong style="color: #111827;">${escapeHtml(order.orderRef)}</strong> · ${escapeHtml(orgName)}</p>
                ${eventWhen ? `<p style="margin: -6px 0 12px; color: #666; font-size: 13px;">${escapeHtml(eventWhen)}</p>` : ''}
                <table style="width: 100%; border-collapse: collapse;">${rowsHtml}<tr><td colspan="2" style="border-top: 1px solid #e5e7eb; padding: 0;"></td></tr>${summaryRows}</table>
                <p style="margin: 12px 0 0; color: #666; font-size: 13px;">Paid by ${escapeHtml(method)}${order.paidAt ? ` on ${new Date(order.paidAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}` : ''}.</p>
              </div>
              ${booth ? `<p style="margin: 0 0 16px;">Your booth: <strong>${escapeHtml(booth.label)}</strong>${booth.size ? ` (${escapeHtml(booth.size)})` : ''}${booth.mapUrl ? ` · <a href="${escapeHtml(booth.mapUrl)}" style="color: ${b.link};">See it on the map</a>` : ''}</p>` : ''}
              <div style="text-align: center; margin: 24px 0;"><a href="${escapeHtml(statusUrl)}" style="display: inline-block; background-color: ${b.brand}; color: ${b.onBrand}; font-size: 15px; font-weight: bold; padding: 12px 28px; border-radius: 8px; text-decoration: none;">View your application</a></div>
              ${accountUrl ? `<p style="color: #666; font-size: 13px; text-align: center;">Manage your applications any time: <a href="${escapeHtml(accountUrl)}" style="color: ${b.link};">your account</a></p>` : ''}
              <p style="color: #666; font-size: 12px; margin-top: 16px;">Questions about this payment? Reply to this email to reach ${escapeHtml(orgName)}.</p>
            </div>
          </body>
        </html>
      `,
      ...(organization.email && { reply_to: organization.email }),
    };
    try {
      await deliver(msg);
      logger.info('Application receipt sent', { event: 'application_receipt_sent', orderId: order.id, orderRef: order.orderRef, applicationId: application.id });
      return true;
    } catch (error) {
      logger.error('Failed to send application receipt', { orderId: order.id, applicationId: application.id, error: error.message });
      return false;
    }
  }
}

export default new EmailService();
