// Form purposes (spec 050 §6.2). A new event form starts blank: only first
// name, last name and email, which every apply form asks. Organizers add the
// rest on the Fields step (createForm).

export const FORM_PURPOSES = new Set(['VENDOR', 'SPONSOR', 'PRESS', 'PANEL', 'SPECIAL_GUEST', 'VOLUNTEER', 'OTHER']);

/** Purposes that never charge the applicant (special guests appear for free; volunteers give time). */
export const FREE_ONLY_PURPOSES = new Set(['SPECIAL_GUEST', 'VOLUNTEER']);
