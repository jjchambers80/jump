// Applications (spec 011) — shapes returned by the backend and small display
// helpers shared by the storefront apply pages, the buyer account and admin.

export type FormKind = 'PAID' | 'FREE';
export type FormStatus = 'DRAFT' | 'OPEN' | 'CLOSED';
export type QuestionType = 'SHORT_TEXT' | 'LONG_TEXT' | 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'CHECKBOX' | 'URL' | 'EMAIL' | 'PHONE' | 'NUMBER' | 'PHOTO';
export type ApplicationStatus = 'DRAFT' | 'SUBMITTED' | 'WAITLISTED' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
export type PaymentStatus = 'NOT_REQUIRED' | 'AWAITING_CARD' | 'CARD_ON_FILE' | 'PROCESSING' | 'PAID' | 'PAYMENT_DUE' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
export type Decision = 'APPROVE' | 'REJECT' | 'WAITLIST' | 'WITHDRAW';
export type TemplateAction = 'RECEIVED' | 'APPROVED' | 'REJECTED' | 'WAITLISTED' | 'WITHDRAWN' | 'PAYMENT_DUE';

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
  paymentDueAt: string | null;
  profile: ApplicantProfile;
  answers: AnswerView[];
  boothLabel: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  canWithdraw: boolean;
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

export interface AdminApplication {
  id: string;
  form: { id: string; name: string; slug: string; kind: FormKind; chargeTiming: string; feeMode: string };
  event: { id: string; name: string; date: string };
  status: ApplicationStatus;
  paymentStatus: PaymentStatus;
  capacitySlot: 'NONE' | 'RESERVED' | 'APPROVED';
  contact: { id: string; email: string; firstName: string; lastName: string; accountCreatedAt: string | null };
  profile: ApplicantProfile;
  tier: { id: string; name: string; price: number } | null;
  amounts: TierAmounts & { currency: string };
  payment: {
    stripePaymentIntentId: string | null;
    stripePaymentMethodId: 'on_file' | null;
    stripeAccountId: string | null;
    applicationFee: number | null;
    chargeAttempts: number;
    paidAt: string | null;
    paymentDueAt: string | null;
    overdue: boolean;
  };
  answers: AnswerView[];
  decisions: DecisionRecord[];
  refunds: { id: string; amount: number; status: string; reason: string | null; createdAt: string }[];
  submittedAt: string | null;
  decidedAt: string | null;
  decidedById: string | null;
  withdrawnBy: 'ORGANIZER' | 'APPLICANT' | 'SYSTEM' | null;
  withdrawReason: string | null;
  boothLabel: string | null;
  internalNote: string | null;
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

export function acceptanceLine(a: Acceptance): string | null {
  if (a.open) return null;
  if (a.reason === 'not_yet_open') return a.opensAt ? `Opens ${formatDate(a.opensAt)}` : 'Not open yet';
  if (a.reason === 'closed') return 'Closed';
  return 'Not available';
}
