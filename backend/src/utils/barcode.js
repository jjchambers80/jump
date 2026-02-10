// Barcode generation utility
// Generates unique human-readable barcodes for tickets
// Format: JUMP-XXXXXXXXXXXX (14-char alphanumeric after prefix)
// Per FR-031, data-model.md

import { randomBytes } from 'crypto';

const PREFIX = 'JUMP';
const CODE_LENGTH = 12;
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No 0/O/1/I to avoid confusion

/**
 * Generate a single unique barcode string.
 * Format: JUMP-XXXXXXXXXXXX (e.g., JUMP-A3BK7NP2XWRQ)
 *
 * @returns {string} Barcode string
 */
export function generateBarcode() {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CHARSET[bytes[i] % CHARSET.length];
  }
  return `${PREFIX}-${code}`;
}

/**
 * Generate multiple unique barcodes.
 *
 * @param {number} count - Number of barcodes to generate
 * @returns {string[]} Array of unique barcode strings
 */
export function generateBarcodes(count) {
  const barcodes = new Set();
  while (barcodes.size < count) {
    barcodes.add(generateBarcode());
  }
  return Array.from(barcodes);
}

/**
 * Validate barcode format.
 *
 * @param {string} barcode - Barcode string to validate
 * @returns {boolean} True if valid format
 */
export function isValidBarcode(barcode) {
  return /^JUMP-[A-HJ-NP-Z2-9]{12}$/.test(barcode);
}

export default { generateBarcode, generateBarcodes, isValidBarcode };
