// Email Service
// Sends order confirmations and cancellation notifications
// Uses Resend SDK per research.md R3, FR-036, FR-037

import resend from '../config/resend.js';
import logger from '../utils/logger.js';
import walletTokenService from './wallet/WalletTokenService.js';

/**
 * Public base URL of this backend, used to make relative asset URLs
 * (e.g. /images/:id/:hash/:variant) absolute inside emails.
 * BACKEND_URL wins; Railway exposes RAILWAY_PUBLIC_DOMAIN automatically.
 */
function backendPublicUrl() {
  if (process.env.BACKEND_URL) return process.env.BACKEND_URL.replace(/\/$/, '');
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return `http://localhost:${process.env.PORT || 3000}`;
}

function absoluteAssetUrl(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${backendPublicUrl()}/${url.replace(/^\//, '')}`;
}

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
 * "Add to Apple Wallet" / "Add to Google Wallet" buttons for every ticket in
 * an order. Empty string when neither wallet provider is configured, so the
 * email renders exactly as before. Table-based markup for email clients.
 */
function walletSectionHtml(tickets) {
  const rows = tickets
    .map((ticket, index) => {
      const links = walletTokenService.links({ id: ticket.id, status: ticket.status || 'VALID' });
      if (!links.apple && !links.google) return '';
      const label = `Ticket ${index + 1}${ticket.priceTier?.name ? ' · ' + escapeHtml(ticket.priceTier.name) : ''}`;
      const apple = links.apple
        ? `<a href="${links.apple}" style="display: inline-block; background: #000; color: #fff; font-size: 13px; font-weight: 600; padding: 9px 14px; border-radius: 6px; text-decoration: none; margin: 4px 6px 4px 0;">&#63743; Add to Apple Wallet</a>`
        : '';
      const google = links.google
        ? `<a href="${links.google}" style="display: inline-block; background: #fff; color: #1f1f1f; border: 1px solid #747775; font-size: 13px; font-weight: 600; padding: 8px 14px; border-radius: 6px; text-decoration: none; margin: 4px 0;">Add to Google Wallet</a>`
        : '';
      return `
        <tr>
          <td style="padding: 8px 0; border-top: 1px solid #e5e7eb; font-size: 14px; color: #111827;">
            <div style="margin-bottom: 4px;"><strong>${label}</strong> <span style="color: #6b7280; font-family: monospace; font-size: 12px;">${escapeHtml(ticket.barcode || '')}</span></div>
            ${apple}${google}
          </td>
        </tr>`;
    })
    .join('');
  if (!rows) return '';
  return `
    <div style="background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 24px 0;">
      <h3 style="margin: 0 0 4px;">Add to your wallet</h3>
      <p style="margin: 0 0 8px; color: #666; font-size: 13px;">Save each ticket to your phone for tap-and-go entry.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">${rows}</table>
    </div>`;
}

class EmailService {
  /**
   * Send order confirmation email with View Tickets link (FR-036)
   * Fire-and-forget with async retry — does not block order completion.
   * @param {Object} order - Order object with contact, event, tickets
   * @param {Array} tickets - Ticket objects with barcode, pricePaid
   */
  async sendOrderConfirmation(order, tickets) {
    const maxRetries = 3;
    let attempt = 0;
    let lastError;

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const viewTicketsUrl = `${frontendUrl}/orders/${order.id}`;

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

                  ${walletSectionHtml(tickets)}

                  <p style="color: #666; font-size: 14px;">Your QR codes for event entry are available on the tickets page. Present them at the venue entrance — each ticket is valid for one entry.</p>
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
