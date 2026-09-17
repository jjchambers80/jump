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
  async sendBuyerLoginEmail({ contact, loginUrl, organization = {} }) {
    const orgName = organization.name || 'Jump';
    const msg = {
      to: [contact.email],
      from: process.env.RESEND_FROM_EMAIL || 'Jump <noreply@jump.events>',
      subject: `Your sign-in link for ${orgName}`,
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb;">
            <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
              ${orgLogoHtml(organization.logoUrl, orgName)}
              <h1 style="color: #333; font-size: 22px;">Sign in to ${escapeHtml(orgName)}</h1>
            </div>
            <div style="padding: 20px;">
              <p>Hi ${escapeHtml(contact.firstName || 'there')},</p>
              <p>Use the button below to sign in and see your tickets and orders with ${escapeHtml(orgName)}.</p>
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
}

export default new EmailService();
