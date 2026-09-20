const segment = (value: string) => encodeURIComponent(value);

export function organizationPath(organizationSlug: string) {
  return `/organizations/${segment(organizationSlug)}`;
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
