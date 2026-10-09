const segment = (value: string) => encodeURIComponent(value);

export function organizationPath(organizationSlug: string) {
  return `/organizations/${segment(organizationSlug)}`;
}

/**
 * The store's public homepage: `<slug>.<root>` when store subdomains are on
 * (NEXT_PUBLIC_STOREFRONT_ROOT_DOMAIN), else the platform path. Keeps the
 * current page's scheme and port, so `acme.localhost:3001` works in dev.
 */
export function storefrontUrl(organizationSlug: string) {
  const root = process.env.NEXT_PUBLIC_STOREFRONT_ROOT_DOMAIN?.trim();
  if (!root || typeof window === 'undefined') return organizationPath(organizationSlug);
  const port = window.location.port ? `:${window.location.port}` : '';
  return `${window.location.protocol}//${organizationSlug}.${root}${port}/`;
}

export function organizationAccountPath(organizationSlug: string) {
  return `${organizationPath(organizationSlug)}/account`;
}

export function eventPath(eventSlug: string) {
  return `/events/${segment(eventSlug)}`;
}

export function venuePath(venueSlug: string) {
  return `/venues/${segment(venueSlug)}`;
}

export function pagePath(organizationSlug: string, pageSlug: string) {
  return `${organizationPath(organizationSlug)}/pages/${segment(pageSlug)}`;
}

export function blogPath(organizationSlug: string, blogHandle: string) {
  return `${organizationPath(organizationSlug)}/blogs/${segment(blogHandle)}`;
}

export function blogPostPath(
  organizationSlug: string,
  blogHandle: string,
  postHandle: string
) {
  return `${blogPath(organizationSlug, blogHandle)}/${segment(postHandle)}`;
}
