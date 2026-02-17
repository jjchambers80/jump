// Email Service
// Sends order confirmations and cancellation notifications
// Uses Resend SDK per research.md R3, FR-036, FR-037

import resend from '../config/resend.js';
import logger from '../utils/logger.js';

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
