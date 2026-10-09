// Spec 048: how each audited Prisma model reads in the Activity log.
//   feature — the admin area the change belongs to
//   label   — column snapshotted as the record's name
//   org     — relation path to the organization, for models without an
//             organizationId column (used when the request has no active org,
//             e.g. a Stripe webhook)
// A unit test fails when a model is neither listed here nor excluded in
// packages/db/src/audit.js, so every new model makes that call.

export const MODEL_FEATURES = {
  // People and access
  User: { feature: 'Account', label: 'email' },
  Account: { feature: 'Account' },
  Passkey: { feature: 'Account', label: 'label' },
  RecoveryCode: { feature: 'Account' },
  OrganizationMember: { feature: 'Settings › Users' },
  OrganizationPerson: { feature: 'Settings › Users' },
  DeveloperToken: { feature: 'Settings › Developers', label: 'name' },
  OAuthClient: { feature: 'Settings › Agent access', label: 'name' },
  OAuthGrant: { feature: 'Settings › Agent access' },

  // Organization settings
  Organization: { feature: 'Settings', label: 'name' },
  OrganizationDomain: { feature: 'Settings › Domains', label: 'hostname' },
  OrganizationStripeAccount: { feature: 'Settings › Payments' },
  PlatformCustomer: { feature: 'Settings › Plan' },
  TaxRegion: { feature: 'Settings › Tax' },
  PlatformSetting: { feature: 'Platform' },

  // Events and tickets
  Venue: { feature: 'Venues', label: 'name' },
  Event: { feature: 'Events', label: 'name', org: 'venue' },
  PriceTier: { feature: 'Tickets', label: 'name', org: 'event.venue' },
  TierPreset: { feature: 'Tickets', label: 'name' },
  AddOnProduct: { feature: 'Add-ons', label: 'name' },
  AddOn: { feature: 'Add-ons', label: 'name', org: 'event.venue' },
  PriceTierAddOn: { feature: 'Add-ons', org: 'priceTier.event.venue' },
  ApplicationTierAddOn: { feature: 'Add-ons', org: 'tier.form' },
  EventRsvp: { feature: 'RSVPs', org: 'event.venue' },

  // Orders and money
  Order: { feature: 'Orders', org: 'event.venue' },
  OrderItem: { feature: 'Orders', org: 'order.event.venue' },
  OrderAddOn: { feature: 'Orders', label: 'name', org: 'order.event.venue' },
  Ticket: { feature: 'Orders', org: 'event.venue' },
  PaymentTransaction: { feature: 'Orders', org: 'order.event.venue' },
  Refund: { feature: 'Orders', org: 'order.event.venue' },
  Dispute: { feature: 'Orders', org: 'order.event.venue' },

  // Customers
  Contact: { feature: 'Customers', label: 'email' },
  ContactComment: { feature: 'Customers' },
  ErasureSuppression: { feature: 'Customers' },

  // Applications and maps
  ApplicationForm: { feature: 'Applications', label: 'name' },
  ApplicationTier: { feature: 'Applications', label: 'name', org: 'form' },
  ApplicationQuestion: { feature: 'Applications', label: 'label', org: 'form' },
  ApplicationFormTemplate: { feature: 'Applications', label: 'name' },
  ApplicationMessageTemplate: { feature: 'Applications' },
  Application: { feature: 'Applications' },
  ApplicationAnswer: { feature: 'Applications', org: 'application' },
  ApplicationDecision: { feature: 'Applications', org: 'application' },
  ApplicantProfile: { feature: 'Applications' },
  ApplicantProfileImage: { feature: 'Applications', org: 'profile' },
  FloorMap: { feature: 'Floor maps', label: 'name' },
  FloorMapTemplate: { feature: 'Floor maps', label: 'name' },
  Booth: { feature: 'Floor maps', label: 'label', org: 'map' },

  // Content and online store
  File: { feature: 'Content › Files' },
  Image: { feature: 'Content › Files' },
  StoreFile: { feature: 'Content › Files', label: 'name' },
  Blog: { feature: 'Content › Blog posts', label: 'title' },
  BlogPost: { feature: 'Content › Blog posts', label: 'title' },
  Page: { feature: 'Content › Pages', label: 'title' },
  PageTemplate: { feature: 'Content › Pages', label: 'name' },
  Menu: { feature: 'Content › Menus', label: 'title' },
  MenuItem: { feature: 'Content › Menus', label: 'label', org: 'menu' },
  UrlRedirect: { feature: 'Content › URL redirects', label: 'fromPath' },
  Gallery: { feature: 'Content › Galleries', label: 'title' },
  GallerySection: { feature: 'Content › Galleries', label: 'title', org: 'gallery' },
  GalleryItem: { feature: 'Content › Galleries', org: 'section.gallery' },
  Theme: { feature: 'Online store', label: 'name' },
  ThemeDocument: { feature: 'Online store', org: 'theme' },
};

export const featureFor = (model) => MODEL_FEATURES[model] || { feature: 'Other' };

/** "PriceTier" → "price_tier" */
export const entityKey = (model) => model.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
