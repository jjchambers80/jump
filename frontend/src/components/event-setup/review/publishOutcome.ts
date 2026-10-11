// What Review hands to Done (spec 050 §7.2): the per-form results of a
// publish, with the form names, kept in module scope across the step change.

export interface FormResult {
  formId: string;
  status: 'OPEN' | 'REFUSED';
  code?: string;
  message?: string;
}

export interface PublishOutcome {
  eventId: string;
  results: (FormResult & { name: string })[];
}

let outcome: PublishOutcome | null = null;

export const setPublishOutcome = (next: PublishOutcome | null) => {
  outcome = next;
};

export const readPublishOutcome = (eventId: string) => (outcome?.eventId === eventId ? outcome : null);
