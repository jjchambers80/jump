// Email Service
// Sends order confirmations and cancellation notifications
// Uses Resend SDK per research.md R3, FR-036, FR-037

import resend from '../config/resend.js';
import logger from '../utils/logger.js';
import { orderUrl } from '../utils/storefrontUrl.js';
import { absoluteAssetUrl } from '../utils/publicUrl.js';

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
          from: process.env.RESEND_FROM_EMAIL || 'Jump <noreply@jump.events>',
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
                    <a href="${viewTicketsUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; font-size: 16px; font-weight: bold; padding: 14px 32px; border-radius: 8px; text-decoration: none;">View Tickets</a>
                  </div>

                  <p style="color: #666; font-size: 14px;">Your QR codes for event entry are available on the tickets page. Present them at the venue entrance — each ticket is valid for one entry.</p>
${manageTicketsHtml}
                  <p style="color: #666; font-size: 12px; margin-top: 16px;">Order reference: ${order.orderRef}</p>
                </div>
              </body>
            </html>
          `,
        };

        await resend.emails.send(msg);

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
      from: process.env.RESEND_FROM_EMAIL || 'Jump <noreply@jump.events>',
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
                <a href="${loginUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; font-size: 16px; font-weight: bold; padding: 14px 32px; border-radius: 8px; text-decoration: none;">Sign in</a>
              </div>
              <p style="color: #666; font-size: 13px;">This link works once and expires in 15 minutes. If you did not request it, you can ignore this email — nothing changes until the link is used.</p>
            </div>
          </body>
        </html>
      `,
    };

    await resend.emails.send(msg);
    logger.info('Buyer login email sent', {
      event: 'buyer_login_email_sent',
      contactId: contact.id,
      organizationId: contact.organizationId,
    });
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
      subject: 'Confirm your new email address for Jump',
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb;">
            <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
              <h1 style="color: #333; font-size: 22px;">Confirm your new email</h1>
            </div>
            <div style="padding: 20px;">
              <p>You asked to change the email address on your Jump account from <strong>${escapeHtml(currentEmail)}</strong> to <strong>${escapeHtml(to)}</strong>.</p>
              <div style="text-align: center; margin: 32px 0;">
                <a href="${confirmUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; font-size: 16px; font-weight: bold; padding: 14px 32px; border-radius: 8px; text-decoration: none;">Confirm email address</a>
              </div>
              <p style="color: #666; font-size: 13px;">This link works once and expires in 1 hour. If you did not request this change, you can ignore this email — your email address stays the same until the link is used.</p>
            </div>
          </body>
        </html>
      `,
    };

    await resend.emails.send(msg);
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
      subject: 'Your Jump email address was changed',
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb;">
            <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
              <h1 style="color: #333; font-size: 22px;">Email address changed</h1>
            </div>
            <div style="padding: 20px;">
              <p>The email address on your Jump account was changed from <strong>${escapeHtml(to)}</strong> to <strong>${escapeHtml(newEmail)}</strong>. Sign-in links now go to the new address.</p>
              <p style="color: #666; font-size: 13px;">If you did not make this change, reply to this email right away so we can help secure your account.</p>
            </div>
          </body>
        </html>
      `,
    };

    await resend.emails.send(msg);
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
      subject: `Jump security: ${title}`,
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb;">
            <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
              <h1 style="color: #333; font-size: 22px;">${escapeHtml(title)}</h1>
            </div>
            <div style="padding: 20px;">
              <p>${escapeHtml(body)}</p>
              <p style="color: #666; font-size: 13px;">This message was sent because a security setting on your Jump account changed.</p>
            </div>
          </body>
        </html>
      `,
    };
    await resend.emails.send(msg);
    logger.info('Security notice sent', { event: 'security_notice_sent', title });
  }

  /** Six-digit step-up code (spec 030 B). */
  async sendReauthCode({ to, code }) {
    const msg = {
      to: [to],
      from: process.env.RESEND_FROM_EMAIL || 'Jump <noreply@jump.events>',
      subject: `${code} is your Jump verification code`,
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb;">
            <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
              <h1 style="color: #333; font-size: 22px;">Confirm it's you</h1>
            </div>
            <div style="padding: 20px; text-align: center;">
              <p>Enter this code in Jump to confirm a security change:</p>
              <p style="font-size: 32px; letter-spacing: 8px; font-weight: bold; margin: 24px 0;">${escapeHtml(code)}</p>
              <p style="color: #666; font-size: 13px;">It expires in 10 minutes. If you didn't request it, ignore this email — nothing changes without the code.</p>
            </div>
          </body>
        </html>
      `,
    };
    await resend.emails.send(msg);
    logger.info('Reauth code sent', { event: 'reauth_code_sent' });
  }

  /** Verification link for a secondary (recovery) email (spec 030 B). */
  async sendSecondaryEmailVerification({ to, confirmUrl }) {
    const msg = {
      to: [to],
      from: process.env.RESEND_FROM_EMAIL || 'Jump <noreply@jump.events>',
      subject: 'Verify your secondary email for Jump',
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb;">
            <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
              <h1 style="color: #333; font-size: 22px;">Verify this email</h1>
            </div>
            <div style="padding: 20px;">
              <p>This address was added as the secondary email on a Jump account. Once verified it can be used to restore access to that account, and security notifications are sent here too.</p>
              <div style="text-align: center; margin: 32px 0;">
                <a href="${confirmUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; font-size: 16px; font-weight: bold; padding: 14px 32px; border-radius: 8px; text-decoration: none;">Verify email address</a>
              </div>
              <p style="color: #666; font-size: 13px;">This link works once and expires in 1 hour. If you didn't add this address, ignore this email.</p>
            </div>
          </body>
        </html>
      `,
    };
    await resend.emails.send(msg);
    logger.info('Secondary email verification sent', { event: 'secondary_email_verification_sent' });
  }

  /** One-time recovery sign-in link, sent to the verified secondary address (spec 030 B). */
  async sendRecoveryLink({ to, primaryEmail, recoverUrl }) {
    const msg = {
      to: [to],
      from: process.env.RESEND_FROM_EMAIL || 'Jump <noreply@jump.events>',
      subject: 'Restore access to your Jump account',
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb;">
            <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
              <h1 style="color: #333; font-size: 22px;">Restore access</h1>
            </div>
            <div style="padding: 20px;">
              <p>Use the button below to sign in to the Jump account <strong>${escapeHtml(primaryEmail)}</strong>. This address is its secondary email.</p>
              <div style="text-align: center; margin: 32px 0;">
                <a href="${recoverUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; font-size: 16px; font-weight: bold; padding: 14px 32px; border-radius: 8px; text-decoration: none;">Sign in</a>
              </div>
              <p style="color: #666; font-size: 13px;">This link works once and expires in 15 minutes. If you didn't request it, ignore this email and consider reviewing Account › Security.</p>
            </div>
          </body>
        </html>
      `,
    };
    await resend.emails.send(msg);
    logger.info('Recovery link sent', { event: 'recovery_link_sent' });
  }

  /**
   * Send an application decision / status email (spec 011). `body` is plain
   * text already rendered from the organization's template; paragraphs are
   * split on blank lines and every line is escaped, so organizer text can
   * never inject markup. URLs on their own line become buttons.
   *
   * @param {{ to: string, subject: string, body: string, organization?: { name?: string, logoUrl?: string } }} params
   */
  async sendApplicationMessage({ to, subject, body, organization = {} }) {
    const orgName = organization.name || 'the organizer';
    const paragraphs = String(body || '')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        if (/^https?:\/\/\S+$/.test(p)) {
          return `<div style="text-align: center; margin: 24px 0;"><a href="${escapeHtml(p)}" style="display: inline-block; background-color: #2563eb; color: #ffffff; font-size: 15px; font-weight: bold; padding: 12px 28px; border-radius: 8px; text-decoration: none;">Open</a></div>`;
        }
        const lines = p.split('\n').map((line) => {
          const escaped = escapeHtml(line);
          return escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color: #2563eb;">$1</a>');
        });
        return `<p style="margin: 0 0 14px; line-height: 1.5;">${lines.join('<br />')}</p>`;
      })
      .join('');

    const msg = {
      to: [to],
      from: process.env.RESEND_FROM_EMAIL || 'Jump <noreply@jump.events>',
      subject,
      text: body,
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb;">
            <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
              ${orgLogoHtml(organization.logoUrl, orgName)}
              <h1 style="color: #333; font-size: 20px; margin: 0;">${escapeHtml(orgName)}</h1>
            </div>
            <div style="padding: 24px; color: #111827; font-size: 15px;">
              ${paragraphs}
            </div>
          </body>
        </html>
      `,
    };
    await resend.emails.send(msg);
  }

  /**
   * Send cancellation notification to all ticket holders (FR-037)
   * @param {Object} event - Event object
   * @param {Array} tickets - Tickets to notify (with contact relations)
   */
  async sendCancellationNotification(event, tickets) {
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
          from: process.env.RESEND_FROM_EMAIL || 'Jump <noreply@jump.events>',
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
                  <p>Your tickets have been voided and a refund will be processed automatically.</p>
                  <p style="color: #666; font-size: 12px;">If you have questions, contact us at support@jump.events</p>
                </div>
              </body>
            </html>
          `,
        };

        await resend.emails.send(msg);

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
      from: process.env.RESEND_FROM_EMAIL || 'Jump <noreply@jump.events>',
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
                <table style="width: 100%; border-collapse: collapse;">${rowsHtml}<tr><td colspan="2" style="border-top: 1px solid #e5e7eb; padding: 0;"></td></tr>${summaryRows}</table>
                <p style="margin: 12px 0 0; color: #666; font-size: 13px;">Paid by ${escapeHtml(method)}${order.paidAt ? ` on ${new Date(order.paidAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}` : ''}.</p>
              </div>
              ${booth ? `<p style="margin: 0 0 16px;">Your booth: <strong>${escapeHtml(booth.label)}</strong>${booth.size ? ` (${escapeHtml(booth.size)})` : ''}${booth.mapUrl ? ` · <a href="${escapeHtml(booth.mapUrl)}" style="color: #2563eb;">See it on the map</a>` : ''}</p>` : ''}
              <div style="text-align: center; margin: 24px 0;"><a href="${escapeHtml(statusUrl)}" style="display: inline-block; background-color: #2563eb; color: #ffffff; font-size: 15px; font-weight: bold; padding: 12px 28px; border-radius: 8px; text-decoration: none;">View your application</a></div>
              ${accountUrl ? `<p style="color: #666; font-size: 13px; text-align: center;">Manage your applications any time: <a href="${escapeHtml(accountUrl)}" style="color: #2563eb;">your account</a></p>` : ''}
              <p style="color: #666; font-size: 12px; margin-top: 16px;">Questions about this payment? Reply to this email to reach ${escapeHtml(orgName)}.</p>
            </div>
          </body>
        </html>
      `,
      ...(organization.email && { reply_to: organization.email }),
    };
    try {
      await resend.emails.send(msg);
      logger.info('Application receipt sent', { event: 'application_receipt_sent', orderId: order.id, orderRef: order.orderRef, applicationId: application.id });
      return true;
    } catch (error) {
      logger.error('Failed to send application receipt', { orderId: order.id, applicationId: application.id, error: error.message });
      return false;
    }
  }
}

export default new EmailService();
