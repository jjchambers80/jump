// The Raleigh Retro Gamers "Vendor FAQ" page (raleighretrogamers.com/vendor-faq)
// rebuilt as a landing page from theme sections, every answer of the original
// kept. The questions are grouped into three accordions (Faq sections); the
// accepted vendor types and the standards get their own sections. Primary
// call to action: the vendor application. The e2e storefront fixture serves it.

const p = (t) => `<p>${t}</p>`;
const ul = (...items) => `<ul>${items.map((t) => `<li>${t}</li>`).join('')}</ul>`;
const photo = (fileId, alt) => ({ fileId, alt });

/** Content › Files ids of the event photos (prod ids). The e2e fixture resolves these keys. */
export const VENDOR_FAQ_PHOTOS = {
  booth: 'cmuojdc970007p91wnbv9bt1v',
  table: 'cmuxl8973001ipa1w1teuq5kn',
  market: 'cmuxl89wq001spa1woyhsy4bi',
};

/** `applyPageId`: the Vendor Application page; `contactPageId`: the Contact page. */
export function vendorFaqLandingDocument(applyPageId, contactPageId, photos = VENDOR_FAQ_PHOTOS) {
  const applyButton = (id, style = 'primary', size = 'medium') => ({ type: 'Button', props: { id, label: 'Apply to be a vendor', link: { type: 'PAGE', targetId: applyPageId }, style, size } });
  const contactButton = (id, style = 'secondary', size = 'medium') => ({ type: 'Button', props: { id, label: 'Contact us', link: { type: 'PAGE', targetId: contactPageId }, style, size } });
  const item = (id, text) => ({ type: 'ChecklistItem', props: { id, text } });
  const qa = (id, question, answer) => ({ type: 'FaqItem', props: { id, question, answer } });
  const faq = (id, heading, intro, blocks, extra = {}) => ({ type: 'Faq', props: { id, heading, intro, singleOpen: false, openFirst: false, width: 'normal', blocks, ...extra } });

  return {
    root: { props: {} },
    content: [
      {
        type: 'Hero',
        props: {
          id: 'Faq-hero',
          headingLevel: 'h1',
          heading: 'Vendor FAQ',
          subheading: 'Everything you need to know before you vend at a Raleigh Retro Gamers market: who we accept, how selection works, fees, refunds and what to bring.',
          image: photo(photos.booth, 'A vendor wearing a lanyard stands at his outdoor booth under a canopy, with boxed video games on the table in front of a shopper.'),
          layout: 'full-bleed',
          overlay: 60,
          alignment: 'left',
          textStyle: 'retro',
          height: 'medium',
          mobileLayout: 'button-bottom',
          blocks: [applyButton('Hero-apply', 'primary', 'large'), contactButton('Hero-contact', 'secondary', 'large')],
        },
      },
      {
        type: 'Stats',
        props: {
          id: 'Faq-glance',
          heading: 'At a glance',
          blocks: [
            { type: 'Stat', props: { id: 'Stat-fee', value: '$75–150', label: 'Typical fee per space. Some events are free to vend.' } },
            { type: 'Stat', props: { id: 'Stat-booked', value: '90%', label: 'Of vendors are booked at least 30 days in advance' } },
            { type: 'Stat', props: { id: 'Stat-review', value: '2 weeks', label: 'Typical time to review an application' } },
            { type: 'Stat', props: { id: 'Stat-tax', value: 'Tax ID', label: 'Required for every vendor, no exceptions' } },
          ],
        },
      },
      {
        type: 'Checklist',
        props: {
          id: 'Faq-types',
          heading: 'What type of vendors do you accept?',
          marker: 'check',
          columns: '3',
          blocks: [
            item('Type-gaming', 'Anything retro or modern gaming related. Video games, consoles, merchandise, etc.'),
            item('Type-toys', 'Vintage toys, pop-culture collectibles, etc.'),
            item('Type-art', 'Gaming-related art, crafts, food, handmade, etc.'),
            item('Type-software', 'Gaming-related software companies, developers, designers'),
            item('Type-stores', 'Game stores, and any gaming-related business'),
            item('Type-geek', 'Any geek-related vendors, comics, pop-culture related'),
            item('Type-clothes', 'Gaming, retro, vintage or geek-related clothes, shoes, hats'),
            item('Type-tcg', 'Board games, card-based games, Pokémon, Magic: The Gathering, Yu-Gi-Oh'),
            item('Type-promo', 'Promotional vendors, for example Red Bull, Rockstar, etc.'),
            item('Type-misc', 'Retro pop culture misc like electronics, collectibles, clothes, etc.'),
            item('Type-services', 'Services, products, or experiences that relate to gaming or geek-related culture'),
            item('Type-food', 'Food trucks'),
          ],
        },
      },
      {
        type: 'ImageWithText',
        props: {
          id: 'Faq-standards',
          heading: 'Vendor standards & expectations',
          image: photo(photos.table, 'A vendor table packed with boxed retro consoles and games, including a PlayStation, a Pokémon box and a Game Boy carrying case.'),
          imagePosition: 'left',
          body:
            p('We pride ourselves on creating a marketplace where attendees can “shop with confidence”. To maintain this environment, we have a selective application process focused on quality, transparency, and professionalism.') +
            '<h3>Product integrity & authenticity</h3>' +
            ul(
              '<strong>Knowledge is key:</strong> We seek vendors who are true experts in their field and deeply knowledgeable about the products they carry.',
              '<strong>Condition matters:</strong> Items must be in “working and complete condition”. If an item is incomplete or non-functional, this must be clearly and prominently disclosed to the buyer before purchase.',
              '<strong>Strict no-reproduction policy:</strong> We have a zero-tolerance policy for reproduction or counterfeit items. This includes, but is not limited to, reproduction video games, “proxy” Pokémon cards, and knock-off merchandise.',
              '<strong>Accountability:</strong> If a vendor is found selling counterfeit, knock-off, or undisclosed non-working items, they will be removed and barred from all future events.',
            ) +
            '<h3>Professionalism & presentation</h3>' +
            p('Stand out in the selection process by bringing your “A-game.” We prioritize vendors who demonstrate a professional presence, including:') +
            ul(
              '<strong>Branding:</strong> A clean booth setup with clear signage and cohesive branding.',
              '<strong>Organization:</strong> Items should be clearly labeled and individually priced to ensure a smooth experience for our shoppers.',
            ) +
            '<h3>Buyer protection</h3>' +
            p('We are committed to a positive attendee experience. Please be aware that if a buyer reports a significant issue with a purchase, we reserve the right to provide them with the contact information you submitted during registration to facilitate a resolution.'),
          blocks: [],
        },
      },
      faq('Faq-selection', 'Applying and getting selected', 'How we choose vendors, and what happens after you apply.', [
        qa(
          'Q-selected',
          'How are vendors selected?',
          p('<strong>We start accepting and reviewing vendors for an event after we announce it publicly on the website and social channels</strong>, so be sure to follow us and turn on notifications. Vendor selection is based on a mix of who signs up and our preferred list.') +
            p('New vendors must complete a full application so we can assess fit, while returning vendors just need to provide a small amount of info. We categorize vendors into two groups: gaming-related (video games, consoles, or related products) and geek-related (arts & crafts, comics, Funko Pops, TCG, toys, clothing, etc.).') +
            p('We strive to offer a variety of vendors at each market, but as a video gaming market first, we prioritize gaming vendors. Geek vendors are important to us, but space is limited, and we can only select a certain number for each event.') +
            p('While we don’t charge for applications, this means we receive many to review. We value every submission and wish we could accept everyone who meets our criteria. If you’re not chosen this time, please know there will be more opportunities in the future!'),
        ),
        qa(
          'Q-how-long',
          'How long until I find out if I’m selected?',
          p('It’s a bit complex because we have so many vendors signing up for each event. This year, we introduced a preferred video game and geek vendor list, and those vendors receive invites first. Depending on the event size, this group makes up 50–80% of our vendors. After that, we aim to include a mix of new and returning vendors while ensuring we don’t have too much overlap in offerings. Additionally, we reserve a handful of spaces closer to the event date in case any last-minute vendors we really want to feature decide to join.') +
            p('There’s no specific time, but <strong>90% of vendors are booked at least 30 days in advance</strong>. Sometimes we add extra space closer to the event or fill spots due to last-minute cancellations. If you’ve applied, you’re automatically on the waitlist and could get a last-minute invite. When we send these invites, we reach out to multiple vendors, so if you’re available, be sure to secure your spot quickly!'),
        ),
        qa(
          'Q-preferred',
          'How do I get on the preferred list?',
          p('Our preferred list of vendors consists of two main categories: video game vendors and geek vendors. These are vendors we’ve worked with for a long time, or who we receive exceptional feedback about from attendees and staff. The majority of these vendors are video game related as that is what our events are based upon.') +
            p('These vendors typically have professional setups and are known in the gaming and geek community. They help ensure we keep a high standard for our marketplaces. There is no way to get on this list: RRG staff choose to add these vendors based on our experience working with them and what they bring to the marketplaces and overall event.'),
        ),
        qa(
          'Q-applied',
          'I’ve applied, what do I do now?',
          p('We typically review all applications within two weeks of receiving them. If you have applied please allow at least that amount of time for a response. However, it also depends on how far in advance the event is as well as other factors. If you do not hear from us it may be because we are full, we have other vendors who were selected over you, we’re still deciding or trying to find the right balance, or you were not a fit for this particular event. However, we do keep you on our potential vendor mailing list and send out other opportunities as they arrive. We keep all your information confidential and we never sell, share, or distribute your information to anyone else.'),
        ),
        qa(
          'Q-not-heard',
          'Why haven’t I heard back after applying?',
          p('We receive a lot of applications for each event. We carefully select each vendor based on many factors. We have to take into consideration the venue size, the event theme, and the type of vendors we need. We also have to factor in the public and want to make sure they have a nice selection of vendors. Our events are a niche market so we have to be selective and make sure each vendor we choose is right for the event. If you are not chosen it may not mean you would not be a fit for the event but we may have already accepted others similar to you and we don’t have space left. But rest assured we keep your info on file and send out opportunities to all potential vendors when future events are being booked.'),
        ),
        qa(
          'Q-chances',
          'How can I improve my chances of being selected?',
          p('One of the main things we look for in vendors is a professional web presence. This means you have an updated website, or social media page(s), and clearly show the products or services you sell that relate to the gaming or geek culture. Extra consideration is given to those who have photos of being in other markets so we can see an example of your setup.') +
            p('We look that you filled out the application correctly and provided links to your channels so we can properly vet you. (Saying “I’m on Facebook, eBay, Etsy, IG” etc. without providing a link is not helpful!) Also, if we can see you have helped promote similar events that you may or may not have been a part of, that shows you care! We want businesses and individuals who really want to be there and help promote the event! Positivity and enthusiasm on your application and social pages go a long way!'),
        ),
      ]),
      {
        type: 'Steps',
        props: {
          id: 'Faq-steps',
          heading: 'From application to booth',
          blocks: [
            { type: 'Step', props: { id: 'Step-apply', title: 'Apply', text: p('Applications open once an event is announced on the website and social channels. Applying is free.') } },
            { type: 'Step', props: { id: 'Step-review', title: 'We review', text: p('Most applications are reviewed within two weeks. Applying puts you on the waitlist too.') } },
            { type: 'Step', props: { id: 'Step-invite', title: 'Get your invitation', text: p('Accepted vendors receive an email with the event details and a link to pay the vendor fee.') } },
            { type: 'Step', props: { id: 'Step-pay', title: 'Pay to secure your spot', text: p('You are not an official vendor until the fee is paid. Those who pay first secure their spot.') } },
          ],
        },
      },
      faq('Faq-fees', 'Fees, tax ID and refunds', 'What vending costs, what it pays for, and when it is refundable.', [
        qa(
          'Q-fee',
          'How much is the vendor fee?',
          p('The vendor fee is based on the event size and venue. Some venues charge more than others so that dictates the price. However, we try and stay competitive and work with venues to keep the fees as low as we can. <strong>Typically most events range from $75–$150 per space.</strong> However, we do host events that are FREE to vend at. We make sure to inform vendors if it’s a FREE or paid event.'),
        ),
        qa(
          'Q-covers',
          'What does my vendor fee cover?',
          p('Your vendor fee buys you a defined space at the event. (Space size may depend on the venue and we’ll inform you what the space is.) We do not provide tables, tents, or setups. You are responsible for bringing everything you need to properly set up. Your fee also goes towards the promotion of the event which in turn promotes your business or brand!'),
        ),
        qa(
          'Q-towards',
          'What does the vendor fee go towards?',
          p('The vendor fee is used to cover the costs associated with the event. This includes marketing, advertising, photography, videography, entertainment, attractions, venue fees, signage, insurance, taxes, staff, and other costs associated with the event. It’s our job to ensure the event is well publicized so people attend and can buy your products or services! We put a great deal of time and effort into organizing and promoting every event. Advertising is not cheap!'),
        ),
        qa(
          'Q-refund',
          'Are vendor fees refundable?',
          p('<strong>Yes, if the event date is more than 30 days away.</strong> Vendor fees are non-refundable if within 30 days of the event date. There is a 5% refund fee if you cancel outside of 30 days. (This goes to the fees we have to pay our payment merchant.)') +
            p('The amount of vendors we book for each event is calculated based on our costs. Vendor fees go to the production of the event and if someone pulls out we usually do not have time to fill that vacancy which in turn affects our total costs. However, if the event has to be rescheduled or canceled due to acts of god, weather, or unforeseen circumstances you will be credited for a future event.'),
        ),
        qa(
          'Q-tax',
          'Do you require a tax ID to participate?',
          p('<strong>As of January 1st 2024, all vendors participating in a RRG market MUST have a tax ID, no exceptions.</strong> This is the law in NC. Businesses and individuals who are selling taxable goods at retail should have a tax ID. If you do not have a tax ID you can get one for free online by visiting <a href="https://www.ncdor.gov/taxes-forms/business-registration/online-business-registration" target="_blank" rel="noopener">NCDOR online business registration</a>.') +
            p('It’s the individual’s or business’s sole responsibility to report any taxable income to the IRS and NCDOR and to learn about tax regulations in the city and state you are selling in. By applying to be a vendor you will be asked to provide your tax ID.'),
        ),
      ]),
      {
        type: 'ImageWithText',
        props: {
          id: 'Faq-promote',
          heading: 'How do you promote your events?',
          image: photo(photos.market, 'Shoppers browse vendor tables of games and collectibles at an indoor market under a Raleigh Retro Gamers banner.'),
          imagePosition: 'right',
          body: p('We promote our events to the general public as well as our community of gaming and geek-related fans. Our database consists of thousands of potential buyers who have signed up, followed, or expressed interest in gaming and geek-related events. We send out eblasts, and promote heavily on social media, our website, local news organizations, our partner sites, as well as paid advertising spots across NC. We spend a lot of time on the promotion of our events and do everything within budget to make sure we have a successful turnout.'),
          blocks: [applyButton('Promote-apply')],
        },
      },
      faq('Faq-accepted', 'Once you’re accepted', 'Securing your spot and getting ready for event day.', [
        qa(
          'Q-accepted-email',
          'I got an email saying I was accepted for the event, now what?',
          p('Once we have reviewed your application and decided to accept you for an event, we’ll send you an invitation to be a vendor email. That email will outline more information about that particular event and go into more details that the vendor would need to know. There will also be a link in that email to pay your vendor fee online or we’ll send you an invoice.') +
            p('<strong>Note: You are not an official vendor for an event until you have paid the vendor fee.</strong> We suggest paying that as soon as possible to secure your spot, because we may accept multiple vendors and if space is limited those who pay first will secure their spot. Once the event is fully booked that link will no longer work and you will not be able to vend at that event even if you already received an invite. So time is of the essence once you receive an email to vend.'),
        ),
        qa(
          'Q-bring',
          'If I’m accepted, what do I need to bring to setup?',
          p('This completely depends on the event and venue. We do not provide anything but space for vendors unless otherwise stated. It’s recommended vendors have the following:') +
            ul('Table and tablecloth', 'Chair(s)', 'Card reader and change', 'Tent and tent weights (if outdoor event)') +
            p('In most locations we choose, power and wifi is available. However, it is not guaranteed and depending on the venue might come at an extra cost. Those things will be explained and addressed in the vendor invitation email you receive once we’ve approved your application, so you can make the decision whether to continue to vend for that event and it’s addressed before you pay the vendor fee.'),
        ),
        qa('Q-more-space', 'Can I purchase more than one booth or space?', p('Generally speaking yes. If for some reason we have to limit the amount of space per vendor we will notify you.')),
      ]),
      {
        type: 'CallToAction',
        props: {
          id: 'Faq-cta',
          heading: 'Still have questions?',
          text: 'We are happy to answer any questions you have. Reach out through our contact form, or apply for an upcoming event.',
          blocks: [contactButton('Cta-contact', 'primary'), applyButton('Cta-apply', 'secondary')],
        },
      },
    ],
  };
}
