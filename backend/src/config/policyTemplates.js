// Spec 052: Settings › Policies starter text. Generic starting points an
// organization reviews and edits before publishing — not legal advice. The
// store's own details are filled in where known; nothing here is stored until
// the organization saves a policy.

import { escapeHtml } from '../utils/plainToHtml.js';

/** Display order, titles and default URL handles of the written policies. */
export const POLICY_TYPES = [
  { type: 'REFUND', title: 'Return and refund policy', slug: 'refund-policy' },
  { type: 'PRIVACY', title: 'Privacy policy', slug: 'privacy-policy' },
  { type: 'TERMS', title: 'Terms of service', slug: 'terms-of-service' },
  { type: 'SHIPPING', title: 'Shipping policy', slug: 'shipping-policy' },
  { type: 'CONTACT', title: 'Contact information', slug: 'contact-information' },
  { type: 'LEGAL_NOTICE', title: 'Legal notice', slug: 'legal-notice' },
  { type: 'ACCESSIBILITY', title: 'Accessibility statement', slug: 'accessibility-statement' },
];

export const POLICY_TYPE_KEYS = POLICY_TYPES.map((p) => p.type);

export function policyMeta(type) {
  return POLICY_TYPES.find((p) => p.type === type);
}

function details(org) {
  const name = escapeHtml(org.companyName || org.name || 'our organization');
  const address = [org.addressLine1, org.addressLine2, [org.city, org.state].filter(Boolean).join(', '), org.postalCode]
    .filter(Boolean)
    .map(escapeHtml)
    .join('<br>');
  return { name, address };
}

function refundTerms(org) {
  if (!org.selfServeRefundsEnabled) {
    return '<p>Refund requests are reviewed by our team. Contact us before the event and we will let you know whether your order can be refunded.</p>';
  }
  const cutoff = org.selfServeRefundCutoffHours
    ? `up to ${org.selfServeRefundCutoffHours} hours before the event starts`
    : 'until the event starts';
  let fee = '';
  if (org.selfServeRefundFeeType === 'FIXED' && org.selfServeRefundFeeValue) {
    fee = ` A processing fee of $${Number(org.selfServeRefundFeeValue).toFixed(2)} per ticket is kept from each refund.`;
  } else if (org.selfServeRefundFeeType === 'PERCENT' && org.selfServeRefundFeeValue) {
    fee = ` A processing fee of ${Number(org.selfServeRefundFeeValue)}% is kept from each refund.`;
  }
  return `<p>You can request a refund for eligible tickets from your account ${cutoff}.${fee} Some ticket types are marked non-refundable at checkout.</p>`;
}

// The store's email and phone are never copied into starter text: the
// organization adds the contact details it wants public itself.
const CONTACT_LINE = '<p>If you have any questions about this policy, please contact us.</p>';

const TEMPLATES = {
  REFUND: (org, d) => `
<h2>Refunds</h2>
${refundTerms(org)}
<p>If an event is cancelled, we refund the full ticket price to the original payment method. If an event is rescheduled, your tickets remain valid for the new date, or you may request a refund.</p>
<p>Approved refunds are returned to the original payment method. Your bank may take 5–10 business days to show the credit.</p>
<h2>Add-ons and merchandise</h2>
<p>Unused add-ons purchased with a ticket are refunded with that ticket. Physical items may be returned unused within 30 days of receipt.</p>
${CONTACT_LINE}`,

  PRIVACY: (_org, d) => `
<p>${d.name} respects your privacy. This policy explains what personal information we collect when you buy tickets, register or apply for our events, and how we use it.</p>
<h2>Information we collect</h2>
<p>Your name, email address, phone number and billing details when you place an order or submit an application, and basic technical information (such as browser type) when you visit this site.</p>
<h2>How we use it</h2>
<p>To process orders, deliver tickets, run our events, contact you about your purchases, prevent fraud, and — only when you opt in — send you news about future events.</p>
<h2>Sharing</h2>
<p>We share information only with service providers who help us run our store and events (for example payment processing and email delivery). We do not sell your personal information.</p>
<h2>Your choices</h2>
<p>You may request a copy of your data, ask us to correct it, or ask us to delete it. You can unsubscribe from marketing emails at any time.</p>
${CONTACT_LINE}`,

  TERMS: (_org, d) => `
<p>These terms apply to purchases and registrations made through this store, operated by ${d.name}.</p>
<h2>Tickets</h2>
<p>A ticket is a license to attend the event it names. Tickets may be scanned once; keep your ticket private. We may refuse entry to anyone with a duplicated, altered or resold ticket.</p>
<h2>Pricing and payment</h2>
<p>Prices, fees and taxes are shown before you pay. Payment is taken at checkout.</p>
<h2>Event changes</h2>
<p>Lineups, times and venues may change. If an event is cancelled or materially changed, our refund policy applies.</p>
<h2>Conduct</h2>
<p>Attendees must follow venue rules and staff instructions. We may remove anyone who endangers others, without a refund.</p>
<h2>Liability</h2>
<p>To the extent permitted by law, our liability is limited to the amount you paid for your order.</p>
${CONTACT_LINE}`,

  SHIPPING: (_org, d) => `
<h2>Tickets</h2>
<p>Tickets are delivered by email right after your order is confirmed and are always available from your account. There is no physical shipping for tickets.</p>
<h2>Physical items</h2>
<p>Any physical items are available for pickup at the event unless the product says otherwise. Where shipping is offered, delivery times and costs are shown at checkout.</p>
${CONTACT_LINE}`,

  CONTACT: (_org, d) => `
<p><strong>${d.name}</strong></p>
${d.address ? `<p>${d.address}</p>` : ''}
<p>We'd love to hear from you. Contact us with any questions about your order, tickets or our events.</p>`,

  LEGAL_NOTICE: (_org, d) => `
<p>This store is operated by <strong>${d.name}</strong>.</p>
${d.address ? `<p>${d.address}</p>` : ''}
<p>Add your registered business name, registration or tax number, and the person responsible for this site if the law where you operate requires it.</p>`,

  ACCESSIBILITY: (_org, d) => `
<p>${d.name} wants everyone to be able to use this website and attend our events.</p>
<h2>Website</h2>
<p>We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.1 level AA and continue to improve this site.</p>
<h2>Events</h2>
<p>Ask us about accessible seating, step-free access, companion tickets and other accommodations before you attend.</p>
<h2>Feedback</h2>
<p>If something on this site or at our events is hard to use, please tell us so we can fix it.</p>
${CONTACT_LINE}`,
};

/** Starter `{ title, content }` for one policy type, filled from the organization. */
export function starterPolicy(type, org) {
  const meta = policyMeta(type);
  const html = TEMPLATES[type](org, details(org))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
  return { title: meta.title, content: html };
}
