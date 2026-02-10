// Email Service
// Sends order confirmations and cancellation notifications
// Uses Resend SDK per research.md R3, FR-036, FR-037

import resend from '../config/resend.js';
import qrService from './QRService.js';
import logger from '../utils/logger.js';

class EmailService {
  /**
   * Send order confirmation email with ticket QR codes (FR-036)
   * Fire-and-forget with async retry — does not block order completion.
   * @param {Object} order - Order object with contact, event, tickets
   * @param {Array} tickets - Ticket objects with barcode, pricePaid, qrCodeJwt
   */
  async sendOrderConfirmation(order, tickets) {
    const maxRetries = 3;
    let attempt = 0;
    let lastError;

    while (attempt < maxRetries) {
      try {
        attempt++;

        // Generate QR code images for each ticket
        const ticketSections = [];

        for (let index = 0; index < tickets.length; index++) {
          const ticket = tickets[index];
          let qrDataUrl = null;

          // Generate QR code image from the ticket's JWT
          if (ticket.qrCodeJwt) {
            try {
              qrDataUrl = await qrService.generateQRCodeImage(ticket.qrCodeJwt);
            } catch (qrErr) {
              logger.warn('Failed to generate QR image for email', {
                ticketId: ticket.id,
                error: qrErr.message,
              });
            }
          }

          ticketSections.push(`
            <div style="background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                <div>
                  <h4 style="margin: 0; color: #111; font-size: 15px;">Ticket #${index + 1}</h4>
                  <p style="margin: 4px 0 0; color: #666; font-size: 13px;">${ticket.priceTier?.name || 'General'} — $${Number(ticket.pricePaid).toFixed(2)}</p>
                </div>
                <span style="background: #dcfce7; color: #166534; padding: 2px 10px; border-radius: 4px; font-size: 12px; font-weight: 600; height: fit-content;">Valid</span>
              </div>
              ${
                qrDataUrl
                  ? `
              <div style="text-align: center; padding: 16px 0;">
                <div style="display: inline-block; background: #fff; padding: 12px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                  <img src="${qrDataUrl}" alt="QR Code for Ticket #${index + 1}" width="200" height="200" style="display: block;" />
                </div>
              </div>
              `
                  : ''
              }
              <p style="margin: 8px 0 0; color: #888; font-size: 12px; font-family: monospace; text-align: center;">${ticket.barcode}</p>
            </div>
          `);
        }

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
                  <h3 style="margin-top: 24px;">${order.event?.name || 'Event'}</h3>
                  <p><strong>Total:</strong> $${Number(order.totalAmount).toFixed(2)} (${order.quantity} ticket${order.quantity > 1 ? 's' : ''})</p>

                  <h3 style="margin-top: 24px; margin-bottom: 12px;">Your Tickets</h3>
                  ${ticketSections.join('')}

                  <p style="color: #666; font-size: 14px; margin-top: 24px;">Present your QR code at the venue entrance. Each ticket is valid for one entry.</p>
                  <p style="color: #666; font-size: 12px;">Order reference: ${order.orderRef}</p>
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
