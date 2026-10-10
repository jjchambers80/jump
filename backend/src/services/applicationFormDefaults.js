// Per-purpose starting point for a new event application form (spec 050 §5.2).
// ApplicationFormService.createForm applies these when no template is given and
// the body sends no questions, so the wizard, CLI and MCP all get the same form.
// Explicit body fields always win.

export const FORM_PURPOSES = new Set(['VENDOR', 'SPONSOR', 'PRESS', 'PANEL', 'SPECIAL_GUEST', 'VOLUNTEER', 'OTHER']);

/** Purposes that never charge the applicant (special guests appear for free; volunteers give time). */
export const FREE_ONLY_PURPOSES = new Set(['SPECIAL_GUEST', 'VOLUNTEER']);

const DAYS = ['Friday', 'Saturday', 'Sunday'];

const DEFAULTS = {
  VENDOR: {
    questions: [
      { label: 'What do you sell?', type: 'LONG_TEXT', required: true },
      { label: 'Do you need power?', type: 'SINGLE_CHOICE', required: true, options: ['Yes', 'No'] },
      { label: 'How many tables do you need?', type: 'NUMBER', required: false },
    ],
  },
  SPECIAL_GUEST: {
    questions: [
      { label: 'Appearance fee expectations', type: 'LONG_TEXT', required: false },
      { label: 'Travel needs', type: 'LONG_TEXT', required: false },
      { label: 'A/V needs', type: 'LONG_TEXT', required: false },
      { label: 'Which days are you available?', type: 'MULTI_CHOICE', required: true, options: DAYS },
    ],
  },
  VOLUNTEER: {
    collectBusiness: false,
    questions: [
      { label: 'Which days are you available?', type: 'MULTI_CHOICE', required: true, options: DAYS },
      { label: 'Which roles interest you?', type: 'MULTI_CHOICE', required: false, options: ['Setup', 'Front door', 'Info desk', 'Teardown'] },
      { label: 'T-shirt size', type: 'SINGLE_CHOICE', required: false, options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
      { label: 'Emergency contact (name and phone)', type: 'SHORT_TEXT', required: true },
    ],
  },
};

/** `{ collectBusiness?, questions? }` for a purpose; empty for SPONSOR, PRESS, PANEL and OTHER. */
export function defaultsFor(purpose) {
  const d = DEFAULTS[purpose];
  return d ? { ...d, questions: d.questions.map((q) => ({ ...q, options: q.options ? [...q.options] : [] })) } : {};
}
