import type { SetupFields } from '../steps';

/** Venue as the wizard lists it (GET /organizations/:orgId/venues). */
export interface SetupVenue {
  id: string;
  name: string;
  address: string;
  timezone: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  /** Where the zone came from (spec 033): DEFAULT or a near-the-line DERIVED is a guess. */
  timezoneSource?: 'DERIVED' | 'MANUAL' | 'DEFAULT' | null;
}

export interface StepFormProps {
  fields: SetupFields;
  onChange: (patch: Partial<SetupFields>) => void;
  /** Inline error per field id, shown while the error summary is up. */
  errors: Record<string, string>;
  /** The saved row's status: a PUBLISHED event's edits go live (§11.5). */
  status: string | null;
}

/** Steps that save on their own (image upload, tier dialogs) and then refresh the preview. */
export interface SavedRowProps {
  orgId: string;
  saved: import('../steps').SavedEvent;
  setSaved: import('react').Dispatch<import('react').SetStateAction<import('../steps').SavedEvent | null>>;
  /** The saved venue's zone: tier sale windows are typed in it (gotcha 28). */
  zone: string | null;
  refreshPreview: () => void;
}
