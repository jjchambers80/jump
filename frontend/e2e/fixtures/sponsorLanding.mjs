// A sponsor recruitment landing page built only from theme sections: the
// Raleigh Retro Gamers "Sponsors" page rewritten section by section, every
// line of the original kept. The e2e storefront fixture serves it, so the
// specs check the whole layout (headings, tiers, links, axe) on a real page.

const p = (text) => `<p>${text}</p>`;

/** Content › Files ids of the event photos. The e2e fixture resolves these keys. */
export const SPONSOR_PHOTOS = {
  crowd: 'vendor-outdoor-sale',
  aerial: 'sponsor-aerial-market',
  brand: 'vendor-mall-table',
  partner: 'vendor-expo-badge',
  esports: 'sponsor-esports',
};

const photo = (fileId, alt) => ({ fileId, alt });

/** The four standard tiers, benefits verbatim from the original page. */
export const SPONSOR_TIERS = [
  {
    id: 'Tier-final-boss',
    name: 'Final Boss Sponsor',
    tagline: 'Recommended for corporate sponsors',
    benefits: [
      'Company name and logo incorporated into event name for all advertising and promotional purposes, including all print & digital advertising, radio spots (if applicable), posters/handbills, event program, website, social channels, event video, event signage, main event banner, t-shirts/merch (if applicable)',
      'Digital Ads directing traffic to your main social channel or website',
      'Large banner(s) placed around the event site (sponsor to provide)',
      '30-second promotional spot to be projected on a large screen and/or over our on-site sound system throughout the event (sponsor to provide promotional video or script)',
      'Prime placement on website, event page, and digital marketing materials',
      'Preferred placement and 2 – 10×10 vendor booths at the event',
      '25 Event Tickets (if applicable)',
    ],
  },
  {
    id: 'Tier-level-up',
    name: 'Level Up Sponsor',
    tagline: 'Recommended for businesses',
    benefits: [
      'Company logo prominently displayed in all advertising digital and print and on RRG homepage and event page',
      'Company name, links, and logos, on all organic digital marketing campaigns, website, and social channels',
      '15-second promotional spot can be projected on the screens or over our on-site sound system throughout the event (sponsor to provide promotional spot/copy)',
      'Zone sponsorship (free-play gaming station area, kids zone etc)',
      'Preferred placement and 1 – 10×10 vendor booth at the event',
      '15 Event Tickets (if applicable)',
    ],
  },
  {
    id: 'Tier-pro',
    name: 'Pro Sponsor',
    featured: true,
    badge: 'Most popular',
    benefits: [
      'Company logo displayed on the RRG homepage and event page',
      'Company logo added to event flyer (digital and print)',
      'Company social channel or website promoted through digital advertising',
      'Eblast with company name, logo, and link to our database',
      'Company name, logo, and link mentioned on RRG social channels at least 5 times before event',
      'Standard placement and 1 – 10×10 vendor booth at the event',
      '5 Event tickets (if applicable)',
    ],
  },
  {
    id: 'Tier-participating',
    name: 'Participating Sponsor',
    benefits: [
      'Logo and link to sponsor’s website displayed on the official event page',
      'Company name and page mentioned at least 2 times on RRG social channels',
      'Eblast with company name, logo, and link to our database',
    ],
  },
];

/**
 * `applyPageId`: the Content page holding the sponsor application form.
 * `contactPageId`: the store's Contact page.
 */
export function sponsorLandingDocument(applyPageId, contactPageId, photos = SPONSOR_PHOTOS) {
  const apply = { type: 'PAGE', targetId: applyPageId };
  const applyButton = (id, label = 'Become a sponsor', size = 'medium') => ({ type: 'Button', props: { id, label, link: apply, style: 'primary', size } });
  const contactButton = (id) => ({ type: 'Button', props: { id, label: 'Contact us', link: { type: 'PAGE', targetId: contactPageId }, style: 'secondary' } });

  return {
    root: { props: {} },
    content: [
      {
        type: 'Hero',
        props: {
          id: 'Sponsor-hero',
          headingLevel: 'h1',
          heading: 'Sponsor Raleigh Retro Gamers',
          subheading: 'Interested in becoming a sponsor or sponsoring a particular event? We’re always looking for sponsors who share our passion.',
          image: {
            fileId: photos.crowd,
            alt: 'A shopper in a Raleigh Retro Gamers cap pays a vendor at a shaded outdoor booth stacked with games, while other attendees browse the tables behind them.',
          },
          layout: 'full-bleed',
          overlay: 60,
          alignment: 'left',
          textStyle: 'retro',
          height: 'large',
          mobileLayout: 'button-bottom',
          blocks: [applyButton('Hero-apply', 'Become a sponsor', 'large')],
        },
      },
      {
        type: 'FeatureGrid',
        props: {
          id: 'Sponsor-why',
          heading: 'Reach the crowd that lives for gaming',
          intro: 'Our sponsorship packages are designed to help you reach a large audience of active, dedicated gaming and geek fanatics.',
          columns: '3',
          alignment: 'left',
          blocks: [
            {
              type: 'Feature',
              props: {
                id: 'Why-crowds',
                image: photo(photos.aerial, 'An aerial view of a Raleigh Retro Gamers outdoor market: rows of colorful vendor tents along park paths, filled with attendees.'),
                title: 'Thousands at every event',
                text: 'Our events bring out thousands of dedicated gaming & geek crowds.',
              },
            },
            {
              type: 'Feature',
              props: {
                id: 'Why-marketing',
                image: photo(photos.brand, 'Visitors chat at a table draped in a Raleigh Retro Gamers banner at an indoor mall event, beside a video game artist’s display.'),
                title: 'Seen long before the doors open',
                text: 'We reach even more people through our extensive digital marketing in the days and months leading up to an event.',
              },
            },
            {
              type: 'Feature',
              props: {
                id: 'Why-term',
                image: photo(photos.partner, 'A vendor wearing a Raleigh Retro Gamers Summer Expo vendor badge talks with a customer across a table of boxed games at an outdoor market.'),
                title: 'One event or the whole year',
                text: 'Sponsorships can be for single events or for the entire year.',
              },
            },
          ],
        },
      },
      {
        type: 'Tiers',
        props: {
          id: 'Sponsor-tiers',
          heading: 'Sponsorship tiers',
          intro: 'These are our standard sponsorship tiers. Choose the level of visibility that fits your brand.',
          blocks: SPONSOR_TIERS.map(({ id, benefits, ...tier }) => ({ type: 'Tier', props: { id, ...tier, benefits: benefits.join('\n') } })),
        },
      },
      {
        type: 'ImageWithText',
        props: {
          id: 'Sponsor-custom',
          heading: 'Need something different? Build a custom package',
          body:
            p('Beyond our standard tiers, we can customize an exclusive partnership catered to your exact needs and goals.') +
            p('Pick <strong>Custom Package</strong> on the sponsor application and tell us what you have in mind.'),
          image: photo(photos.esports, 'Esports players in headsets compete at a row of gaming PCs on a convention floor while spectators watch.'),
          imagePosition: 'right',
          blocks: [applyButton('Custom-apply', 'Ask about a custom package')],
        },
      },
      {
        type: 'Steps',
        props: {
          id: 'Sponsor-steps',
          heading: 'How sponsorship works',
          blocks: [
            { type: 'Step', props: { id: 'Step-tier', title: 'Choose your tier', text: p('Pick one of our standard tiers, or a custom package built around your goals.') } },
            { type: 'Step', props: { id: 'Step-goals', title: 'Tell us your goals', text: p('Fill in the sponsor application with your company details and what you want this sponsorship to achieve.') } },
            { type: 'Step', props: { id: 'Step-plan', title: 'Plan it together', text: p('We get in touch to plan the perfect partnership for your brand, business, or event.') } },
          ],
        },
      },
      {
        type: 'CallToAction',
        props: {
          id: 'Sponsor-cta',
          heading: 'Let’s plan the perfect partnership',
          text: 'For more information and to plan the perfect partnership for your brand, business, or event, please contact us! We look forward to speaking with you.',
          blocks: [applyButton('Cta-apply'), contactButton('Cta-contact')],
        },
      },
    ],
  };
}
