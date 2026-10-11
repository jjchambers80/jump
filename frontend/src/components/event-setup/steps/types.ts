import type { SetupFields } from '../steps';

/** Venue as the wizard lists it (GET /organizations/:orgId/venues). */
export interface SetupVenue {
  id: string;
  name: string;
  address: string;
  timezone: string | null;
  city?: string | null;
  state?: string | null;
}

export interface StepFormProps {
  fields: SetupFields;
  onChange: (patch: Partial<SetupFields>) => void;
  /** Inline error per field id, shown while the error summary is up. */
  errors: Record<string, string>;
  /** The saved row's status: a PUBLISHED event's edits go live (§11.5). */
  status: string | null;
}
