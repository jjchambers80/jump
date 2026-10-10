// Applications (spec 011) — shapes returned by the backend and small display
// helpers shared by the storefront apply pages, the buyer account and admin.

import { computeOrderFees, roundCurrency } from './fees';

export type FormKind = 'PAID' | 'FREE';
export type FormStatus = 'DRAFT' | 'OPEN' | 'CLOSED';
export type QuestionType = 'SHORT_TEXT' | 'LONG_TEXT' | 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'CHECKBOX' | 'URL' | 'EMAIL' | 'PHONE' | 'NUMBER' | 'PHOTO';
export type ApplicationStatus = 'DRAFT' | 'SUBMITTED' | 'WAITLISTED' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
/**
 * `NOT_DUE` (spec 037 phase 5): a PAID-form application under review — nothing
 * owed yet. `AWAITING_SELECTION`: approved, the vendor still has to choose a
 * space and pay. AWAITING_CARD / CARD_ON_FILE are pre-037 rows only.
 */
export type PaymentStatus = 'NOT_REQUIRED' | 'NOT_DUE' | 'AWAITING_SELECTION' | 'AWAITING_CARD' | 'CARD_ON_FILE' | 'PROCESSING' | 'PAID' | 'PAYMENT_DUE' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
export type Decision = 'APPROVE' | 'REJECT' | 'WAITLIST' | 'WITHDRAW';
export type TemplateAction = 'RECEIVED' | 'APPROVED' | 'CHOOSE_SPACE' | 'REJECTED' | 'WAITLISTED' | 'WITHDRAWN' | 'PAYMENT_DUE' | 'ADD_ONS_CHANGED' | 'TIER_CHANGED' | 'WAIVED' | 'OFFLINE_PAID';

export interface Acceptance {
  open: boolean;
  reason: 'not_published' | 'closed' | 'not_yet_open' | null;
  opensAt?: string;
  closesAt?: string;
}

export interface Question {
  id: string;
  label: string;
  helpText: string | null;
  type: QuestionType;
  required: boolean;
  options: string[];
  displayOrder: number;
  /** Spec 019: shown as a column on the submissions list (≤ MAX_PINNED_QUESTIONS per form). */
  pinned: boolean;
}

export const MAX_PINNED_QUESTIONS = 2;

/** An answer to a pinned question, on list rows. */
export interface PinnedAnswer {
  questionId: string;
  label: string;
  type: QuestionType;
  value: string;
}

export interface TierAmounts {
  subtotal: number;
  platformFee: number;
  processingFee: number;
  tax: number;
  applicantPays: number;
  orgReceives: number;
  feeMode: 'PASS' | 'ABSORB';
}

/** Add-on offered on a tier of a public form, priced per unit under the form's fee mode. */
export interface PublicTierAddOn {
  id: string;
  name: string;
  description: string | null;
  price: number;
  taxable: boolean;
  applicantPays: number;
  maxPerOrder: number | null;
  remaining: number | null;
  soldOut: boolean;
}

/** Add-on offered on an application tier, as the form editor and the edit-lines dialog see it (spec 012). */
export interface TierAddOnOption extends PublicTierAddOn {
  /** Offered on every tier; cannot be toggled per tier. */
  allTiers: boolean;
  isActive: boolean;
}

/** An add-on line on a submitted application. */
export interface ApplicationAddOnLine {
  id: string;
  addOnId: string;
  name: string | null;
  quantity: number;
  unitPrice: number;
  /** This line's share of the applicant's total (fees and tax allocated). */
  applicantPays: number;
}

export interface AddOnLineInput {
  addOnId: string;
  quantity: number;
}

/** Admin shape. */
export interface AdminTier {
  id: string;
  name: string;
  description: string | null;
  price: number;
  quantityTotal: number;
  quantityApproved: number;
  quantityReserved: number;
  remaining: number;
  displayOrder: number;
  isActive: boolean;
  amounts: TierAmounts;
  /** Add-ons this tier offers (spec 012): every `allTiers` add-on plus the attached ones. */
  addOns: TierAddOnOption[];
}

/** Spec 050 §6.2: what a form is for. Places it in a wizard step and labels its storefront pill. */
export type FormPurpose = 'VENDOR' | 'SPONSOR' | 'PRESS' | 'PANEL' | 'SPECIAL_GUEST' | 'VOLUNTEER' | 'OTHER';

/** Short call to action per purpose ("Get involved" pills). */
export const PURPOSE_CTA: Record<FormPurpose, string> = {
  VENDOR: 'Become a vendor',
  SPONSOR: 'Become a sponsor',
  PRESS: 'Press pass',
  PANEL: 'Host a panel',
  SPECIAL_GUEST: 'Apply as a guest',
  VOLUNTEER: 'Volunteer',
  OTHER: 'Apply',
};

export interface AdminForm {
  id: string;
  /** Null on a standing form (spec 044): organization-level, FREE, no tiers. */
  eventId: string | null;
  /** Spec 044 standing forms: ask for the business profile, the storefront button label, the thank-you text. */
  collectBusiness?: boolean;
  buttonLabel?: string | null;
  successMessage?: string | null;
  kind: FormKind;
  purpose: FormPurpose;
  name: string;
  slug: string;
  intro: string | null;
  status: FormStatus;
  opensAt: string | null;
  closesAt: string | null;
  chargeTiming: 'SUBMIT' | 'APPROVAL';
  feeMode: 'PASS' | 'ABSORB';
  taxable: boolean;
  paymentDueDays: number;
  overduePolicy: 'WITHDRAW' | 'HOLD';
  /** Spec 037 D5: approval takes a slot in the category (true) or approved vendors choose first-come (false). */
  reserveOnApproval: boolean;
  /** Spec 039: how an approved vendor chooses — a tier, or a spot on the floor map (PAID forms; null on FREE). */
  spaceSelection?: 'TIERS' | 'MAP' | null;
  displayOrder: number;
  /** Spec 019: the template this form was created from (informational). */
  createdFromTemplateId: string | null;
  acceptance: Acceptance;
  paymentsEnabled: boolean;
  applicationCount: number;
  tiers: AdminTier[];
  questions: Question[];
  /** Every application add-on of the event (spec 012), for the tier dialog. */
  addOns: { id: string; name: string; price: number; allTiers: boolean; isActive: boolean; scope: 'TICKET' | 'APPLICATION' | 'BOTH' }[];
  updatedAt?: string;
}

/** Public shape. */
export interface PublicTier {
  id: string;
  name: string;
  description: string | null;
  price: number;
  applicantPays: number;
  feesIncluded: number;
  tax: number;
  soldOut: boolean;
  addOns: PublicTierAddOn[];
}

export interface PublicForm {
  id: string;
  kind: FormKind;
  /** Spec 050 §6.2. Optional so older payloads still render (they label as OTHER). */
  purpose?: FormPurpose;
  name: string;
  slug: string;
  intro: string | null;
  acceptance: Acceptance;
  chargeTiming: 'SUBMIT' | 'APPROVAL' | null;
  feeMode: 'PASS' | 'ABSORB' | null;
  /** Pay-now window after a declined charge (PAID forms); the card-authorization label names it (spec 024 phase 3). */
  paymentDueDays?: number | null;
  organizationName?: string | null;
  tiers: PublicTier[];
  questions: Question[];
  /** Spec 044 / 050: standing forms and FREE event forms may skip the business step. */
  collectBusiness?: boolean;
  /** Spec 044: standing forms' own button label and thank-you line. */
  buttonLabel?: string | null;
  successMessage?: string | null;
}

export interface ProfilePhoto {
  imageId: string;
  displayOrder: number;
  urls?: Record<string, string>;
}

export interface ApplicantProfile {
  id: string;
  businessName: string;
  description: string | null;
  website: string | null;
  socials: Record<string, string>;
  photos: ProfilePhoto[];
}

export interface AnswerView {
  questionId: string;
  label: string;
  type: QuestionType;
  archived: boolean;
  value: string | string[] | null;
  image: { urls: Record<string, string> } | null;
}

/**
 * Spec 037 phase 5: the choose-your-space step of an approved PAID
 * application, from the status view. `CHOOSE` until the vendor picks, `HELD`
 * while the chosen space (booth or category slot) is held for payment.
 */
/** A space type as the vendor sees it: all-in price and what is left. */
export interface SpaceCategory {
  id: string;
  name: string;
  description: string | null;
  price: number;
  /** Before fees and tax: the tier price, or a staff-placed booth's own price (spec 039). */
  listedPrice?: number;
  applicantPays: number;
  feesIncluded: number;
  tax: number;
  /** Spaces the vendor can still take (their own approval slot counts). */
  spacesLeft: number;
  /** The approval took a slot for this vendor. */
  guaranteed: boolean;
}

export interface SpaceSelection {
  /** Spec 039: the form's `spaceSelection` — pick a tier, or a spot on the floor map. */
  mode?: 'TIERS' | 'MAP';
  /** Spec 039: false while the vendor picks (or holds a tier they picked) on a TIERS form. */
  tierLocked?: boolean;
  /** Spec 039: TIERS form approved without a category — the tiers to pick from, each with its add-ons; `category` is then null. */
  categories?: Array<SpaceCategory & { addOns: PublicTierAddOn[] }> | null;
  state: 'CHOOSE' | 'HELD';
  heldUntil: string | null;
  /** Choose and pay by (the clock started at approval). */
  dueAt: string | null;
  reserveOnApproval: boolean;
  /** The locked (or vendor-picked) category; null while a TIERS vendor still picks (spec 039). */
  category: SpaceCategory | null;
  addOns: PublicTierAddOn[];
  /** The event's published map sells this category (and staff have not placed the vendor yet). */
  map: {
    available: boolean;
    mapId: string | null;
    boothsAvailable: number;
    /** Spec 039: MAP form whose floor map is not published yet — the vendor waits. */
    pending?: boolean;
    /** Spec 039: all-in price range across the category's spots. */
    priceFrom?: number | null;
    priceTo?: number | null;
  };
  /** A booth staff already placed the vendor on: they pay for the category only. */
  placedBooth: { id: string; label: string; w: number; h: number } | null;
  /** A card saved before apply-then-choose, offered as "Pay with … ending 4242". */
  savedCard: { brand: string | null; last4: string | null } | null;
  /** Fee settings to total a choice exactly like the order will (`estimateSpaceTotal`). */
  pricing?: SpacePricing;
}

/** How an application order is priced: the form's fee mode and taxability, the event's tax. */
export interface SpacePricing {
  feeMode: 'PASS' | 'ABSORB';
  taxable: boolean;
  taxRate: number;
  taxInclusive: boolean;
}

/**
 * What the vendor pays for a space at `listed` (before fees and tax) plus the
 * chosen extras, computed like the backend's `applicationAmounts`: one fee
 * calculation over all lines. Summing per-line all-in prices instead counts
 * Stripe's fixed fee once per line (spec 039 smoke test: $83.08 shown, $82.78 charged).
 */
export function estimateSpaceTotal(
  listed: number,
  extras: Array<{ price: number; taxable: boolean; quantity: number }>,
  pricing: SpacePricing
): number {
  const items = [
    { price: listed, quantity: 1, taxable: pricing.taxable },
    ...extras.filter((e) => e.quantity > 0).map((e) => ({ price: e.price, quantity: e.quantity, taxable: e.taxable })),
  ];
  const fees = computeOrderFees(items, pricing.taxRate, pricing.taxInclusive);
  if (pricing.feeMode === 'ABSORB') return roundCurrency(fees.subtotal + fees.tax);
  return fees.total;
}

/** A floor-map booth as an application sees it (spec 014). */
export interface ApplicationBooth {
  id: string;
  mapId: string;
  label: string;
  status: 'AVAILABLE' | 'HELD' | 'SOLD' | 'RESERVED' | 'BLOCKED';
  w: number | null;
  h: number | null;
  /** Set only while HELD. */
  holdExpiresAt: string | null;
}

export interface ApplicantApplication {
  id: string;
  /** Order number of the application's order (spec 024); null on FREE forms. */
  orderRef: string | null;
  form: { id: string; name: string; kind: FormKind };
  event: { id: string; name: string; date: string; timezone?: string | null };
  organization: { id: string; name: string } | null;
  status: ApplicationStatus;
  paymentStatus: PaymentStatus;
  /** `mapBound` (spec 014): the tier is sold from the floor map, so an approved vendor picks a booth before paying. */
  tier: { id: string; name: string; mapBound?: boolean } | null;
  amounts: TierAmounts & { currency: string };
  addOns: ApplicationAddOnLine[];
  /** Spec 018: organizer adjustments on the amount (discounts, fees), shown with their reasons. */
  adjustments?: { id: string; amount: number; reason: string }[];
  paymentSource?: 'stripe' | 'offline';
  paymentDueAt: string | null;
  /** Spec 037 phase 5: set while an approved PAID application chooses or holds its space. */
  selection?: SpaceSelection | null;
  profile: ApplicantProfile;
  answers: AnswerView[];
  boothLabel: string | null;
  /** Spec 014 phase 2: the booth owned (SOLD / RESERVED) or held while paying (HELD, with the deadline). */
  booth?: ApplicationBooth | null;
  /** Spec 014 phase 2: a saved card is charged off-session the moment a booth is chosen. */
  hasCardOnFile?: boolean;
  submittedAt: string | null;
  decidedAt: string | null;
  paidAt: string | null;
  refundedTotal: number;
  canWithdraw: boolean;
  /** DRAFT paid application: Checkout was abandoned; a new session can be minted. */
  canResume: boolean;
  /** APPROVED + PAYMENT_DUE: pay the snapshot amount on a hosted page. */
  canPay: boolean;
  /** Card on file can be replaced (buyer account only). */
  canUpdateCard: boolean;
}

export interface ApplicationRow {
  id: string;
  /** Tail of the id shown on list rows and searchable (spec 019). */
  shortId: string;
  /** The application's order (spec 024); null on FREE forms. */
  orderId: string | null;
  orderRef: string | null;
  /** Null on a standing-form submission (spec 044). */
  eventId: string | null;
  event: { id: string; name: string; date: string; timezone?: string | null } | null;
  /** Unscoped (SYSTEM_ADMIN) callers only. */
  organization?: { id: string; name: string };
  formId: string;
  formName: string;
  formKind: FormKind;
  status: ApplicationStatus;
  paymentStatus: PaymentStatus;
  /** Null when a standing form did not collect business details (spec 044). */
  businessName: string | null;
  /** First profile photo, thumb variant (spec 019). */
  logoUrl: string | null;
  contact: { email: string; firstName: string; lastName: string };
  tier: { id: string; name: string } | null;
  applicantPays: number;
  addOns: { addOnId: string; name: string | null; quantity: number }[];
  submittedAt: string | null;
  decidedAt: string | null;
  paymentDueAt: string | null;
  overdue: boolean;
  boothLabel: string | null;
  /** Spec 014 phase 2: owned or held booth for the Booth column; `mapBound` tells "not chosen" from "no map". */
  booth?: { id: string; label: string; status: ApplicationBooth['status'] } | null;
  mapBound?: boolean;
  /** Spec 037 phase 5: while set, the vendor holds a chosen space and is paying. */
  selectionHeldUntil?: string | null;
  /** Spec 019 phase 3: organizer tags and on-site check-in (APPROVED only). */
  tags: string[];
  checkedInAt: string | null;
  checkedOutAt: string | null;
  /** Answers to the form's pinned questions, in question order. */
  pinnedAnswers: PinnedAnswer[];
  /** The applicant's status-page link, for "Copy status link" (spec 019). */
  statusUrl: string | null;
}

/** Spec 019 phase 2: a form template definition — a snapshot, not a live form. */
export interface TemplateTier {
  name: string;
  description: string | null;
  price: number;
  quantityTotal: number;
  isActive: boolean;
}
export interface TemplateQuestion {
  label: string;
  helpText: string | null;
  type: QuestionType;
  required: boolean;
  options: string[];
  pinned: boolean;
}
export interface TemplateDefinition {
  intro: string | null;
  chargeTiming: 'SUBMIT' | 'APPROVAL' | null;
  feeMode: 'PASS' | 'ABSORB' | null;
  taxable: boolean | null;
  paymentDueDays: number | null;
  overduePolicy: 'WITHDRAW' | 'HOLD' | null;
  reserveOnApproval?: boolean | null;
  spaceSelection?: 'TIERS' | 'MAP' | null;
  tiers: TemplateTier[];
  questions: TemplateQuestion[];
}
export interface FormTemplateSummary {
  id: string;
  name: string;
  kind: FormKind;
  tierCount: number;
  questionCount: number;
  sourceFormId: string | null;
  organization?: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}
export interface FormTemplate {
  id: string;
  organizationId: string;
  name: string;
  kind: FormKind;
  definition: TemplateDefinition;
  sourceFormId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One form across events, from `GET /admin/application-forms` (spec 019). */
export interface OrgForm {
  id: string;
  eventId: string;
  event: { id: string; name: string; date: string; status: string; timezone?: string | null };
  organization?: { id: string; name: string };
  kind: FormKind;
  name: string;
  slug: string;
  status: FormStatus;
  opensAt: string | null;
  closesAt: string | null;
  acceptance: Acceptance;
  applicationCount: number;
  pinnedQuestions: { id: string; label: string; type: QuestionType }[];
  addOns: { id: string; name: string }[];
  updatedAt: string;
}

export interface ApplicationList {
  data: ApplicationRow[];
  total: number;
  page: number;
  pageSize: number;
  summary: Partial<Record<ApplicationStatus, number>>;
  /** Spec 037 phase 5: approved PAID applications still choosing a space (the Awaiting space chip). */
  awaitingSpace?: number;
}

export interface DecisionRecord {
  id: string;
  action: TemplateAction;
  byUserId: string | null;
  note: string | null;
  emailSubject: string | null;
  emailBody: string | null;
  createdAt: string;
}

export type OfflinePaymentMethod = 'CHEQUE' | 'CASH' | 'BANK_TRANSFER' | 'COMPED' | 'OTHER';

export const OFFLINE_METHOD_LABEL: Record<OfflinePaymentMethod, string> = {
  CHEQUE: 'Cheque',
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank transfer',
  COMPED: 'Comped',
  OTHER: 'Other',
};

export interface ApplicationAdjustment {
  id: string;
  kind: 'ADJUSTMENT' | 'WAIVER';
  /** Signed; negative = discount. */
  amount: number;
  reason: string;
  createdById: string | null;
  createdAt: string;
}

/** Decision-log actions that are not a review decision, with their timeline labels. */
export const ACTION_LABEL: Record<string, string> = {
  ADD_ONS_CHANGED: 'Add-ons changed',
  TIER_CHANGED: 'Tier changed',
  ADJUSTED: 'Amount adjusted',
  WAIVED: 'Balance waived',
  OFFLINE_PAID: 'Paid offline',
  MANUAL_REFUND: 'Refund recorded',
  PAYMENT_DUE: 'Payment due',
};

export interface AdminApplication {
  id: string;
  /** The application's order (spec 024); null on FREE forms. */
  orderId: string | null;
  orderRef: string | null;
  form: { id: string; name: string; slug: string; kind: FormKind; chargeTiming: 'SUBMIT' | 'APPROVAL'; feeMode: string; paymentDueDays: number; overduePolicy: 'WITHDRAW' | 'HOLD'; reserveOnApproval?: boolean; spaceSelection?: 'TIERS' | 'MAP' | null };
  /** Spec 037 phase 5: the categories an approval can assign, with what is left. */
  categories?: { id: string; name: string; price: number; isActive: boolean; remaining: number }[];
  /** Spec 037 phase 5: while set, the vendor holds a chosen space and is paying. */
  selectionHeldUntil?: string | null;
  /** Whether the organizer may change the category (freely before a space is chosen). */
  tierEditable?: { allowed: boolean; reason: string | null };
  /** Null on a standing-form submission (spec 044). */
  event: { id: string; name: string; date: string; timezone?: string | null } | null;
  status: ApplicationStatus;
  paymentStatus: PaymentStatus;
  capacitySlot: 'NONE' | 'RESERVED' | 'APPROVED';
  contact: { id: string; email: string; firstName: string; lastName: string; accountCreatedAt: string | null };
  /** Null when a standing form did not collect business details (spec 044). */
  profile: ApplicantProfile | null;
  tier: { id: string; name: string; price: number; mapBound?: boolean } | null;
  amounts: TierAmounts & { currency: string };
  /** What the tier + add-ons cost today vs the snapshot quoted at submission (PAID only; phase 3). */
  pricing: { currentApplicantPays: number; currentOrgReceives: number; changed: boolean } | null;
  addOns: ApplicationAddOnLine[];
  /** Whether the organizer may still change the add-on lines (spec 012 §2.5). */
  addOnsEditable: { allowed: boolean; reason: string | null };
  /** Spec 018 phase 3: manual adjustment lines (and the WAIVER record once waived). */
  adjustments: ApplicationAdjustment[];
  /** Whether tier / adjustments may still change (no money has moved). */
  amountEditable: { allowed: boolean; reason: string | null };
  /** ADMIN may waive the balance or record an offline payment (APPROVED + PAYMENT_DUE). */
  canSettleOffline: boolean;
  paymentSource: 'stripe' | 'offline';
  offlinePayment: { method: OfflinePaymentMethod; reference: string | null; recordedById: string | null } | null;
  payment: {
    stripePaymentIntentId: string | null;
    stripePaymentMethodId: 'on_file' | null;
    stripeAccountId: string | null;
    applicationFee: number | null;
    chargeAttempts: number;
    paidAt: string | null;
    paymentDueAt: string | null;
    overdue: boolean;
    refundedTotal: number;
    refundable: number;
    stripeDashboardUrl: string | null;
    canRefund: boolean;
    /** Offline-paid: a refund is recorded, not sent through Stripe. */
    manualRefund: boolean;
    canRetryCharge: boolean;
  };
  answers: AnswerView[];
  decisions: DecisionRecord[];
  refunds: { id: string; amount: number; status: string; reason: string | null; stripeRefundId: string | null; initiatedBy: string | null; manual?: boolean; createdAt: string }[];
  submittedAt: string | null;
  decidedAt: string | null;
  decidedById: string | null;
  withdrawnBy: 'ORGANIZER' | 'APPLICANT' | 'SYSTEM' | null;
  withdrawReason: string | null;
  boothLabel: string | null;
  /** Owned booth, or (spec 014 phase 2) the one HELD while the vendor pays. */
  booth: ApplicationBooth | null;
  publicProfile: boolean;
  internalNote: string | null;
  tags: string[];
  checkedInAt: string | null;
  checkedOutAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageTemplate {
  action: TemplateAction;
  subject: string;
  body: string;
  isDefault: boolean;
  updatedAt: string | null;
}

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  WAITLISTED: 'Waitlisted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
};

export const STATUS_STYLE: Record<ApplicationStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300',
  SUBMITTED: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  WAITLISTED: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  APPROVED: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  REJECTED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  WITHDRAWN: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300',
};

export const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  NOT_REQUIRED: 'No payment',
  NOT_DUE: 'Not due yet',
  AWAITING_SELECTION: 'Awaiting space',
  AWAITING_CARD: 'Awaiting card',
  CARD_ON_FILE: 'Card on file',
  PROCESSING: 'Processing',
  PAID: 'Paid',
  PAYMENT_DUE: 'Payment due',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partly refunded',
};

export const PAYMENT_STYLE: Record<PaymentStatus, string> = {
  NOT_REQUIRED: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-400',
  NOT_DUE: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-400',
  AWAITING_SELECTION: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
  AWAITING_CARD: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  CARD_ON_FILE: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  PROCESSING: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  PAID: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  PAYMENT_DUE: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  REFUNDED: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300',
  PARTIALLY_REFUNDED: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300',
};

export const DECISION_LABEL: Record<Decision, string> = { APPROVE: 'Approve', REJECT: 'Reject', WAITLIST: 'Waitlist', WITHDRAW: 'Withdraw' };

/** Decisions available from a review status (mirrors the backend state machine). */
export function decisionsFor(status: ApplicationStatus): Decision[] {
  switch (status) {
    case 'SUBMITTED':
      return ['APPROVE', 'WAITLIST', 'REJECT', 'WITHDRAW'];
    case 'WAITLISTED':
      return ['APPROVE', 'REJECT', 'WITHDRAW'];
    case 'APPROVED':
      return ['WITHDRAW'];
    default:
      return [];
  }
}

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  SHORT_TEXT: 'Short text',
  LONG_TEXT: 'Long text',
  SINGLE_CHOICE: 'Single choice',
  MULTI_CHOICE: 'Multiple choice',
  CHECKBOX: 'Checkbox',
  URL: 'Website link',
  EMAIL: 'Email',
  PHONE: 'Phone',
  NUMBER: 'Number',
  PHOTO: 'Photo upload',
};

export const SOCIAL_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'instagram', label: 'Instagram', placeholder: '@handle' },
  { key: 'tiktok', label: 'TikTok', placeholder: '@handle' },
  { key: 'facebook', label: 'Facebook', placeholder: 'page name or URL' },
  { key: 'x', label: 'X', placeholder: '@handle' },
  { key: 'youtube', label: 'YouTube', placeholder: 'channel URL' },
];

/** Mirrors the backend `shortId`: the last 8 characters, upper-cased. */
export function shortId(id: string): string {
  return id.slice(-8).toUpperCase();
}

export function money(value: number | string | null | undefined): string {
  return `$${Number(value || 0).toFixed(2)}`;
}

export function formatDate(value?: string | null, withTime = false): string {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
}

/**
 * Spec 037 phase 5: an approved PAID application whose vendor still chooses
 * (or is paying for) a space gets the choose-your-space step. Legacy rows
 * approved before the change (PAYMENT_DUE without a hold) keep the plain
 * pay-now button.
 */
export function needsSpaceChoice(app: Pick<ApplicantApplication, 'status' | 'selection'>): boolean {
  return app.status === 'APPROVED' && Boolean(app.selection);
}

/** Applicant-facing price line for a tier. */
export function tierPriceLine(tier: PublicTier, feeMode: 'PASS' | 'ABSORB' | null): string {
  if (tier.applicantPays === 0) return 'Free';
  if (feeMode === 'PASS' && tier.feesIncluded > 0) return `${money(tier.applicantPays)} incl. ${money(tier.feesIncluded)} fees`;
  return `${money(tier.applicantPays)}${tier.tax > 0 ? ' incl. tax' : ''}`;
}

/**
 * Estimated applicant total for a tier plus chosen add-ons, from the per-unit
 * figures the public form carries. The server snapshot allocates fees across
 * the real lines and can differ by a cent or two.
 */
export function estimatedApplicantTotal(tier: PublicTier, quantities: Record<string, number>): number {
  const addOns = (tier.addOns ?? []).reduce((sum, a) => sum + a.applicantPays * (quantities[a.id] ?? 0), 0);
  return Math.round((tier.applicantPays + addOns) * 100) / 100;
}

/** "Booth power ×1, Extra badge ×2" for list rows and summaries. */
export function addOnSummary(lines: { name: string | null; quantity: number }[] | undefined): string {
  return (lines ?? []).map((l) => `${l.name ?? 'Add-on'} ×${l.quantity}`).join(', ');
}

export function acceptanceLine(a: Acceptance): string | null {
  if (a.open) return null;
  if (a.reason === 'not_yet_open') return a.opensAt ? `Opens ${formatDate(a.opensAt)}` : 'Not open yet';
  if (a.reason === 'closed') return 'Closed';
  return 'Not available';
}

/** Who applied: the business, or the person when a standing form asked for no business (spec 044). */
export function applicantName(a: { businessName?: string | null; profile?: { businessName: string } | null; contact: { firstName: string; lastName: string } }): string {
  return a.businessName ?? a.profile?.businessName ?? `${a.contact.firstName} ${a.contact.lastName}`.trim();
}
