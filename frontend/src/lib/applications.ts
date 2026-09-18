// Applications (spec 011) — shapes returned by the backend and small display
// helpers shared by the storefront apply pages, the buyer account and admin.

export type FormKind = 'PAID' | 'FREE';
export type FormStatus = 'DRAFT' | 'OPEN' | 'CLOSED';
export type QuestionType = 'SHORT_TEXT' | 'LONG_TEXT' | 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'CHECKBOX' | 'URL' | 'EMAIL' | 'PHONE' | 'NUMBER' | 'PHOTO';
export type ApplicationStatus = 'DRAFT' | 'SUBMITTED' | 'WAITLISTED' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
export type PaymentStatus = 'NOT_REQUIRED' | 'AWAITING_CARD' | 'CARD_ON_FILE' | 'PROCESSING' | 'PAID' | 'PAYMENT_DUE' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
export type Decision = 'APPROVE' | 'REJECT' | 'WAITLIST' | 'WITHDRAW';
export type TemplateAction = 'RECEIVED' | 'APPROVED' | 'REJECTED' | 'WAITLISTED' | 'WITHDRAWN' | 'PAYMENT_DUE' | 'ADD_ONS_CHANGED' | 'TIER_CHANGED' | 'WAIVED' | 'OFFLINE_PAID';

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

export interface AdminForm {
  id: string;
  eventId: string;
  kind: FormKind;
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
  displayOrder: number;
  acceptance: Acceptance;
  paymentsEnabled: boolean;
  applicationCount: number;
  tiers: AdminTier[];
  questions: Question[];
  /** Every application add-on of the event (spec 012), for the tier dialog. */
  addOns: { id: string; name: string; price: number; allTiers: boolean; isActive: boolean; scope: 'TICKET' | 'APPLICATION' | 'BOTH' }[];
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
  name: string;
  slug: string;
  intro: string | null;
  acceptance: Acceptance;
  chargeTiming: 'SUBMIT' | 'APPROVAL' | null;
  feeMode: 'PASS' | 'ABSORB' | null;
  tiers: PublicTier[];
  questions: Question[];
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

export interface ApplicantApplication {
  id: string;
  form: { id: string; name: string; kind: FormKind };
  event: { id: string; name: string; date: string };
  organization: { id: string; name: string } | null;
  status: ApplicationStatus;
  paymentStatus: PaymentStatus;
  tier: { id: string; name: string } | null;
  amounts: TierAmounts & { currency: string };
  addOns: ApplicationAddOnLine[];
  /** Spec 018: organizer adjustments on the amount (discounts, fees), shown with their reasons. */
  adjustments?: { id: string; amount: number; reason: string }[];
  paymentSource?: 'stripe' | 'offline';
  paymentDueAt: string | null;
  profile: ApplicantProfile;
  answers: AnswerView[];
  boothLabel: string | null;
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
  formId: string;
  formName: string;
  formKind: FormKind;
  status: ApplicationStatus;
  paymentStatus: PaymentStatus;
  businessName: string;
  contact: { email: string; firstName: string; lastName: string };
  tier: { id: string; name: string } | null;
  applicantPays: number;
  addOns: { addOnId: string; name: string | null; quantity: number }[];
  submittedAt: string | null;
  decidedAt: string | null;
  paymentDueAt: string | null;
  overdue: boolean;
  boothLabel: string | null;
}

export interface ApplicationList {
  data: ApplicationRow[];
  total: number;
  page: number;
  pageSize: number;
  summary: Partial<Record<ApplicationStatus, number>>;
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
  form: { id: string; name: string; slug: string; kind: FormKind; chargeTiming: 'SUBMIT' | 'APPROVAL'; feeMode: string; paymentDueDays: number; overduePolicy: 'WITHDRAW' | 'HOLD' };
  event: { id: string; name: string; date: string };
  status: ApplicationStatus;
  paymentStatus: PaymentStatus;
  capacitySlot: 'NONE' | 'RESERVED' | 'APPROVED';
  contact: { id: string; email: string; firstName: string; lastName: string; accountCreatedAt: string | null };
  profile: ApplicantProfile;
  tier: { id: string; name: string; price: number } | null;
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
  internalNote: string | null;
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
