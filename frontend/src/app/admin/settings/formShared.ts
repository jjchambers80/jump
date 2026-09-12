// Shared styling, validation, and display formatting for Settings › General
// so the summary rows and the edit dialogs stay consistent.

export const fieldClass =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
export const labelClass = 'block text-sm font-medium text-gray-700 dark:text-slate-300';
export const errorClass = 'mt-1 text-sm text-red-600 dark:text-red-400';
export const hintClass = 'mt-1 text-xs text-gray-500 dark:text-slate-400';
export const formAlertClass =
  'rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300';

const ZIP_PATTERN = /^\d{5}(-\d{4})?$/;
// Mirrors the backend's deliberately loose check: one "@", no whitespace, a dot in the domain.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const phoneDigits = (value: string) => value.replace(/\D/g, '');

export function zipError(value: string): string | undefined {
  return ZIP_PATTERN.test(value.trim()) ? undefined : 'Enter a 5-digit ZIP code or ZIP+4.';
}

/** Phone is optional; when provided it must contain exactly 10 digits. */
export function phoneError(value: string): string | undefined {
  if (!value) return undefined;
  return phoneDigits(value).length === 10 ? undefined : 'Enter a 10-digit phone number.';
}

/** Email is optional; when provided it must look like an email address. */
export function emailError(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return EMAIL_PATTERN.test(trimmed) ? undefined : 'Enter a valid email address.';
}

export function formatPhone(phone: string | null) {
  if (!phone || phone.length !== 10) return phone || '';
  return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`;
}

interface AddressParts {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}

/** One-line "1 Main St., Suite 2, Cary, NC 27511, United States"; empty when no address saved. */
export function formatAddress(parts: AddressParts) {
  if (!parts.addressLine1) return '';
  const cityState = [parts.city, [parts.state, parts.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [parts.addressLine1, parts.addressLine2, cityState, 'United States'].filter(Boolean).join(', ');
}
