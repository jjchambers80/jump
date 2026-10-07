// A vendor recruitment landing page built only from theme sections: the
// Raleigh Retro Gamers "Vendors" page rewritten section by section. The
// e2e storefront fixture serves it, so the specs check the whole layout
// (headings, lists, links, axe) on a real page rather than one section.

const p = (text) => `<p>${text}</p>`;

/** Content › Files ids of the event photos on the "Why" cards (3:2, so the
 *  card's 3:2 frame never crops them). The e2e fixture resolves these keys. */
export const VENDOR_PHOTOS = { audience: 'vendor-outdoor-sale', marketing: 'vendor-mall-table', partner: 'vendor-expo-badge' };

/** `applyPageId`: the Content page holding the vendor application form; `faqPageId`: the Vendor FAQ page. */
export function vendorLandingDocument(applyPageId, photos = VENDOR_PHOTOS, faqPageId = 'p-faq') {
  const apply = { type: 'PAGE', targetId: applyPageId };
  const faq = { type: 'PAGE', targetId: faqPageId };
  const applyButton = (id) => ({ type: 'Button', props: { id, label: 'Apply to be a vendor', link: apply, style: 'primary' } });
  const faqButton = (id) => ({ type: 'Button', props: { id, label: 'Read the vendor FAQ', link: faq, style: 'secondary' } });
  const photo = (fileId, alt) => ({ fileId, alt });
  const item = (id, text) => ({ type: 'ChecklistItem', props: { id, text } });

  return {
    root: { props: {} },
    content: [
      {
        type: 'ImageWithText',
        props: {
          id: 'Vendor-intro',
          headingLevel: 'h1',
          heading: 'Interested in becoming a vendor?',
          body: p(
            'Raleigh Retro Gamers is the largest gaming event company in North Carolina. We bring thousands of people together across the Triangle through pop-up activations at malls, shopping centers, museums, City Parks, and community hubs throughout the Raleigh-Durham area.',
          ),
          videoUrl: 'https://www.youtube.com/watch?v=UavsDmOhMys',
          videoTitle: 'Raleigh Retro Gamers vendor video',
          imagePosition: 'right',
          sectionWidth: 'wide',
          blocks: [applyButton('Intro-apply'), faqButton('Intro-faq')],
        },
      },
      {
        type: 'Stats',
        props: {
          id: 'Vendor-stats',
          heading: 'We are always looking for new vendors',
          intro:
            'Pop-up markets, expos, gaming and esports tournaments, and other gaming-related experiences across the Triangle, marketed to the general public and to our database of thousands of local gamers, collectors, and geek fanatics.',
          blocks: [
            { type: 'Stat', props: { id: 'Stat-attendees', value: '25,000+', label: 'Attendees at our events every year, and growing' } },
            { type: 'Stat', props: { id: 'Stat-rank', value: '#1', label: 'Largest gaming event company in North Carolina' } },
            { type: 'Stat', props: { id: 'Stat-database', value: '1,000s', label: 'Local gamers, collectors and geek fanatics in our database' } },
            { type: 'Stat', props: { id: 'Stat-venues', value: 'Indoor & outdoor', label: 'Events that vary in size based on the venue' } },
          ],
        },
      },
      {
        type: 'FeatureGrid',
        props: {
          id: 'Vendor-why',
          heading: 'Why should I become a vendor?',
          intro:
            'Raleigh Retro Gamers has built one of the most engaged gaming and geek culture communities in North Carolina. Our mission is to amplify that culture and connect it with the people and businesses that serve it.',
          columns: '3',
          alignment: 'left',
          blocks: [
            {
              type: 'Feature',
              props: {
                id: 'Why-audience',
                image: photo(photos.audience, 'A shopper in a Raleigh Retro Gamers cap pays a vendor at a shaded outdoor booth stacked with games, while other attendees browse the tables behind them.'),
                title: 'A highly targeted audience',
                text: 'Get in front of a highly targeted audience in person, at events built for gaming and geek culture.',
              },
            },
            {
              type: 'Feature',
              props: {
                id: 'Why-marketing',
                image: photo(photos.marketing, 'A vendor shows games to a visitor at the Raleigh Retro Gamers table at an indoor mall event, beside a neighboring vendor’s banner.'),
                title: 'Our marketing, your business',
                text: 'We showcase your business through our marketing efforts to thousands of potential customers.',
              },
            },
            {
              type: 'Feature',
              props: {
                id: 'Why-partner',
                image: photo(photos.partner, 'A vendor wearing a Raleigh Retro Gamers Summer Expo vendor badge talks with a customer across a table of boxed games at an outdoor market.'),
                title: 'A real partner',
                text: 'We believe in partnering with you to drive real brand awareness and sales.',
              },
            },
          ],
        },
      },
      {
        type: 'Checklist',
        props: {
          id: 'Vendor-wanted',
          heading: 'What types of vendors are you looking for?',
          marker: 'check',
          columns: '3',
          blocks: [
            item('Want-games', 'Anything retro or modern gaming related: video games, consoles, merchandise, accessories, etc.'),
            item('Want-toys', 'Vintage toys, pop-culture collectibles, vintage clothing, etc.'),
            item('Want-tcg', 'TCG: Pokémon, Magic: The Gathering, Yu-Gi-Oh!, pop culture trading cards'),
            item('Want-art', 'Gaming or geek-related art, crafts, food, handmade goods, etc.'),
            item('Want-software', 'Gaming-related software companies, developers and designers'),
            item('Want-stores', 'Game stores, and any gaming or geek-related business'),
            item('Want-comics', 'Comics, anime, Funko Pops, etc.'),
            item('Want-apparel', 'Gaming or geek-related clothes, hats, apparel, etc.'),
            item('Want-board', 'Board games and tabletop games'),
            item('Want-promo', 'Promotional vendors, for example Red Bull or Rockstar'),
            item('Want-retro', 'Retro pop culture: electronics, collectibles and things from the 80s and 90s'),
            item('Want-services', 'Services, products or experiences that relate to gaming or geek culture'),
            item('Want-food', 'Food trucks'),
          ],
        },
      },
      {
        type: 'Checklist',
        props: {
          id: 'Vendor-not-allowed',
          heading: 'What types of vendors are not allowed?',
          marker: 'cross',
          columns: '2',
          paddingTop: 0,
          blocks: [
            item('No-mlm', 'MLM vendors'),
            item('No-offtopic', 'Vendors that are not gaming or geek related'),
            item('No-knockoffs', 'Knock-off or reproduction products'),
            item('No-misaligned', 'Vendors who don’t align with our event goals'),
          ],
        },
      },
      {
        type: 'Steps',
        props: {
          id: 'Vendor-steps',
          heading: 'How to sign up',
          blocks: [
            {
              type: 'Step',
              props: {
                id: 'Step-find',
                title: 'Find your event',
                text: p(
                  'The application form lists all events we are currently seeking vendors for. You may also check the <a href="https://raleighretrogamers.com/event-details/" target="_blank" rel="noopener">event page</a>.',
                ),
              },
            },
            {
              type: 'Step',
              props: { id: 'Step-cost', title: 'Check the cost', text: p('Pricing varies depending on the venue and event size. The cost is listed on the application form for each event.') },
            },
            {
              type: 'Step',
              props: { id: 'Step-tax', title: 'Have your tax ID ready', text: p('Yes, you need one. NCDOR requires all vendors to have a tax ID. This is a state requirement, not ours.') },
            },
            {
              type: 'Step',
              props: {
                id: 'Step-waitlist',
                title: 'Sold out? You’re on the list',
                text: p('If an event is sold out, the application form will show that. By signing up you’re automatically added to the waiting list, to be reviewed for a spot if one opens up.'),
              },
            },
          ],
        },
      },
      {
        type: 'CallToAction',
        props: {
          id: 'Vendor-cta',
          heading: 'Ready to become a vendor?',
          text: 'Pick your events on the application form. Still have questions? Our vendor FAQ has the answers.',
          blocks: [applyButton('Cta-apply'), faqButton('Cta-faq')],
        },
      },
    ],
  };
}
