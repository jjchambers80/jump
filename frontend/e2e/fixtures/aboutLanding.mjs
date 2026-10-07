// The Raleigh Retro Gamers "About" page rewritten as a landing page from
// theme sections, every sentence of the original kept. Primary calls to
// action: upcoming events and become a vendor (the Vendors landing page,
// like the home hero). The e2e storefront fixture serves it.

const p = (t) => `<p>${t}</p>`;
const photo = (fileId, alt) => ({ fileId, alt });
const EVENTS = { type: 'EVENTS' };

/** Content › Files ids of the event photos (prod ids). The e2e fixture resolves these keys. */
export const ABOUT_PHOTOS = {
  market: 'cmuxl89wq001spa1woyhsy4bi',
  vendorTable: 'cmuxl96tt0031pa1wmqan7g85',
  artists: 'cmuxl98we003lpa1wc4g3g7i9',
  gameDemo: 'cmuxl89kq001npa1wrct6mj13',
  freePlay: 'cmuxl8cj2002mpa1w4i38oxth',
  expo: 'cmuxl96jf002wpa1wpffb259m',
  esports: 'cmunj78vm0003p31w6wgwi4c9',
  popUp: 'cmuxl8b1u0027pa1w4he3r6ny',
  schedule: 'cmuxl9a4w0045pa1w6n1gjcan',
};

const eventsButton = (id, style = 'primary', size = 'medium') => ({ type: 'Button', props: { id, label: 'See upcoming events', link: EVENTS, style, size } });

/** `vendorsPageId`: the Vendors landing page. */
export function aboutLandingDocument(vendorsPageId, photos = ABOUT_PHOTOS) {
  const vendorButton = (id, style = 'secondary', size = 'medium') => ({ type: 'Button', props: { id, label: 'Become a vendor', link: { type: 'PAGE', targetId: vendorsPageId }, style, size } });
  return {
    root: { props: {} },
    content: [
      {
        type: 'Hero',
        props: {
          id: 'About-hero',
          headingLevel: 'h1',
          heading: 'About Raleigh Retro Gamers',
          subheading: 'Raleigh Retro Gamers was founded in 2018 with a simple goal: bring together collectors, gamers, and nostalgia seekers across the Triangle.',
          image: photo(photos.market, 'Shoppers browse vendor tables of games and collectibles beneath a Raleigh Retro Gamers banner at an indoor evening market.'),
          layout: 'full-bleed',
          overlay: 60,
          alignment: 'left',
          textStyle: 'retro',
          height: 'large',
          mobileLayout: 'button-bottom',
          blocks: [eventsButton('Hero-events', 'primary', 'large'), vendorButton('Hero-vendor', 'secondary', 'large')],
        },
      },
      {
        type: 'Stats',
        props: {
          id: 'About-stats',
          heading: 'A community of thousands',
          intro: 'Uniting fans of retro and modern gaming alike.',
          blocks: [
            { type: 'Stat', props: { id: 'Stat-founded', value: '2018', label: 'Founded in the Triangle' } },
            { type: 'Stat', props: { id: 'Stat-community', value: 'Thousands', label: 'Community members across North Carolina' } },
            { type: 'Stat', props: { id: 'Stat-gaming', value: 'Retro + modern', label: 'Every era of gaming, one community' } },
          ],
        },
      },
      {
        type: 'ImageWithText',
        props: {
          id: 'About-story',
          heading: 'From pop-ups to a full-scale movement',
          videoUrl: 'https://www.youtube.com/watch?v=xaLGbcQvlTU',
          videoTitle: 'Raleigh Retro Gamers video',
          imagePosition: 'left',
          body:
            p('Today, Raleigh Retro Gamers is a thriving community of thousands across North Carolina, uniting fans of retro and modern gaming alike. What started as grassroots pop-ups and intimate local meetups has evolved into a full-scale movement.') +
            p('From those early community-driven events to now producing massive experiences like our annual <strong>GGE convention</strong> and the <strong>Triangle Town Market</strong> series, Raleigh Retro Gamers has become a driving force and central hub for gaming culture across the region.'),
          blocks: [eventsButton('Story-events')],
        },
      },
      {
        type: 'FeatureGrid',
        props: {
          id: 'About-people',
          heading: 'More than just games. We’re about people.',
          intro: 'At our core, we’re about more than just games—we’re about people. From vendors and artists to developers and collectors, we create opportunities for the entire ecosystem to thrive.',
          columns: '3',
          alignment: 'left',
          blocks: [
            { type: 'Feature', props: { id: 'People-business', image: photo(photos.vendorTable, 'A vendor wearing a lanyard stands behind an outdoor table covered in boxed video games and controllers.'), title: 'We champion small businesses', text: 'Local shops and independent vendors get a stage in front of the gaming community.' } },
            { type: 'Feature', props: { id: 'People-creators', image: photo(photos.artists, 'Two artists sit at their booth under a canopy, surrounded by video game art prints and a hanging T-shirt.'), title: 'We elevate creators', text: 'Artists and makers share their work with fans who love it as much as they do.' } },
            { type: 'Feature', props: { id: 'People-industry', image: photo(photos.gameDemo, 'An attendee stands at a demo station playing the retro-style game Micro Mages on a big screen inside a dimly lit venue.'), title: 'We connect industry professionals', text: 'Developers and industry pros meet a passionate, engaged audience.' } },
          ],
        },
      },
      {
        type: 'ImageWithText',
        props: {
          id: 'About-rooted',
          heading: 'Proudly rooted in North Carolina',
          image: photo(photos.freePlay, 'A GameCube and controller sit ready for free play on a table wrapped in a Raleigh Retro Gamers banner.'),
          imagePosition: 'right',
          body:
            p('We’re proudly rooted in North Carolina, and that local love is at the heart of everything we do—but the movement is growing.') +
            p('Each year, we’re welcoming more fans, vendors, and partners from across the region and beyond, expanding the reach of what started right here in the Triangle.'),
          blocks: [vendorButton('Rooted-vendor', 'primary')],
        },
      },
      {
        type: 'FeatureGrid',
        props: {
          id: 'About-experiences',
          heading: 'Where gamers of all ages show up',
          intro: 'From conventions and expos to esports, pop-up markets, and live event experiences, we create high-energy spaces where gamers of all ages can show up, connect, discover, and be part of something bigger.',
          columns: '4',
          alignment: 'left',
          blocks: [
            { type: 'Feature', props: { id: 'Exp-conventions', image: photo(photos.expo, 'Crowds browse rows of vendor tables piled with games and collectibles inside a brewery warehouse.'), title: 'Conventions and expos', text: 'Massive experiences like our annual GGE convention.' } },
            { type: 'Feature', props: { id: 'Exp-esports', image: photo(photos.esports, 'Esports players in headsets compete at a row of gaming PCs on a convention floor while spectators watch.'), title: 'Esports', text: 'Players compete while the crowd cheers them on.' } },
            { type: 'Feature', props: { id: 'Exp-markets', image: photo(photos.popUp, 'A Raleigh Retro Gamers tent with T-shirts and collectible figures set up under the trees at an outdoor pop-up market.'), title: 'Pop-up markets', text: 'Our Triangle Town Market series and pop-ups across the region.' } },
            { type: 'Feature', props: { id: 'Exp-live', image: photo(photos.schedule, 'A projector screen at a Raleigh Retro Gamers pop-up market announces more upstairs: a second bar, free play, more vendors, a 1:00 PM gaming tournament and 3:30 PM retro trivia.'), title: 'Live event experiences', text: 'Free play, tournaments, trivia and more.' } },
          ],
        },
      },
      {
        type: 'UpcomingEvents',
        props: { id: 'About-upcoming', heading: 'Upcoming events', count: 3, layout: 'grid', showViewAll: true },
      },
      {
        type: 'CallToAction',
        props: {
          id: 'About-cta',
          heading: 'Be part of something bigger',
          text: 'Come to an event, or bring your shop, art or games to our next one as a vendor.',
          blocks: [eventsButton('Cta-events'), vendorButton('Cta-vendor')],
        },
      },
    ],
  };
}
