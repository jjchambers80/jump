// Email Service
// Sends ticket emails with QR codes per FR-008, FR-020

import resend from '../config/sendgrid.js';
import logger from '../utils/logger.js';

class EmailService {
  /**
   * Send ticket email with QR codes
   * @param {string} customerEmail - Recipient email
   * @param {Array} tickets - Array of ticket objects with QR codes
   * @param {string} correlationId - Request correlation ID
   * @returns {Promise<void>}
   */
  async sendTicketEmail(customerEmail, tickets, correlationId) {
    const maxRetries = 3;
    let attempt = 0;
    let lastError;

    while (attempt < maxRetries) {
      try {
        attempt++;

        // Build email content
        const ticketDetails = tickets
          .map(
            (ticket, index) => `
          <div style="border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 5px;">
            <h3>Ticket #${index + 1}</h3>
            <p><strong>Event:</strong> ${ticket.event.name}</p>
            <p><strong>Date:</strong> ${new Date(ticket.event.date).toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}</p>
            <p><strong>Venue:</strong> ${ticket.event.venue}</p>
            <p><strong>Price Paid:</strong> $${(ticket.pricePaid / 100).toFixed(2)}</p>
            ${
              ticket.qrCode
                ? `<div style="margin-top: 15px;">
              <img src="${ticket.qrCode}" alt="QR Code" style="max-width: 200px;" />
              <p style="font-size: 12px; color: #666;">Present this QR code at the venue</p>
            </div>`
                : ''
            }
          </div>
        `
          )
          .join('');

        const msg = {
          to: [customerEmail],
          from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
          subject: `Your Tickets for ${tickets[0].event.name}`,
          html: `
            <html>
              <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
                  <h1 style="color: #333;">Your Ticket Purchase Confirmation</h1>
                </div>
                
                <div style="padding: 20px;">
                  <p>Thank you for your purchase! Here are your tickets:</p>
                  
                  ${ticketDetails}
                  
                  <div style="margin-top: 30px; padding: 15px; background-color: #e9ecef; border-radius: 5px;">
                    <h4>Important Information:</h4>
                    <ul style="line-height: 1.8;">
                      <li>Please save this email or screenshot the QR codes</li>
                      <li>Present the QR code at the venue entrance</li>
                      <li>Each QR code is valid for one entry</li>
                      <li>QR codes expire 24 hours after the event</li>
                    </ul>
                  </div>
                  
                  <div style="margin-top: 20px; text-align: center; color: #666; font-size: 12px;">
                    <p>Questions? Contact us at support@jump.com</p>
                    <p>Confirmation ID: ${tickets[0].stripeTxId}</p>
                  </div>
                </div>
              </body>
            </html>
          `,
        };

        // Send email
        await resend.emails.send(msg);

        logger.info('Ticket email sent successfully', {
          email: customerEmail,
          ticketCount: tickets.length,
          attempt,
          correlationId,
        });

        return; // Success - exit retry loop
      } catch (error) {
        lastError = error;

        logger.warn('Email send attempt failed', {
          email: customerEmail,
          attempt,
          maxRetries,
          error: error.message,
          correlationId,
        });

        // If not the last attempt, wait before retrying
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
        }
      }
    }

    // All retries failed
    logger.error('Failed to send ticket email after all retries', {
      email: customerEmail,
      attempts: maxRetries,
      error: lastError?.message,
      correlationId,
    });

    // Don't throw - we don't want to fail the entire purchase if email fails
    // The tickets are still created and customer can retrieve them via API
  }

  /**
   * Send confirmation email without QR codes (for immediate response)
   * @param {string} customerEmail - Recipient email
   * @param {string} eventName - Event name
   * @param {number} quantity - Number of tickets purchased
   * @param {string} confirmationUrl - URL to view tickets
   * @returns {Promise<void>}
   */
  async sendPurchaseConfirmation(customerEmail, eventName, quantity, confirmationUrl) {
    try {
      const msg = {
        to: [customerEmail],
        from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
        subject: `Purchase Confirmed - ${eventName}`,
        html: `
          <html>
            <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
                <h1 style="color: #333;">✓ Purchase Successful!</h1>
              </div>
              
              <div style="padding: 20px;">
                <p>Your purchase of ${quantity} ticket(s) for <strong>${eventName}</strong> is confirmed.</p>
                
                <p>Your tickets and QR codes will be sent in a separate email shortly.</p>
                
                <div style="margin: 30px 0; text-align: center;">
                  <a href="${confirmationUrl}" style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
                    View Your Tickets
                  </a>
                </div>
                
                <p style="color: #666; font-size: 14px;">
                  If you don't receive your tickets email within 10 minutes, you can always access them at the link above.
                </p>
              </div>
            </body>
          </html>
        `,
      };

      await resend.emails.send(msg);

      logger.info('Purchase confirmation email sent', {
        email: customerEmail,
        eventName,
        quantity,
      });
    } catch (error) {
      logger.error('Failed to send confirmation email', {
        email: customerEmail,
        error: error.message,
      });
      // Don't throw - confirmation email is optional
    }
  }
}

export default new EmailService();
