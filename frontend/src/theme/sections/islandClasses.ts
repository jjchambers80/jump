// Class names the server sections put on their slot wrappers and the client
// islands look up. Kept out of the 'use client' modules: a constant exported
// from one reaches a server component as a client reference, not a string.

export const CAROUSEL_TRACK_CLASS = 'hero-carousel-track';
export const FAQ_LIST_CLASS = 'faq-list';
/** Data attribute on every gallery photo button; its value is the photo's index across the gallery. */
export const GALLERY_OPEN_ATTR = 'data-gallery-open';
