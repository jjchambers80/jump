// Plain-text email templates with merge fields (spec 011, shared by spec 053).
//
// Syntax: {{path.to.value}} and {{#path}}…{{/path}} (section shown when the
// value is truthy). Unknown paths render empty; objects never render.
// Output is plain text: callers escape it when they build HTML.

import { ValidationError } from '../middleware/errorHandler.js';

function lookup(context, path) {
  return path.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), context);
}

/** Render a template string against a context. Sections first, then fields. */
export function renderTemplate(text, context) {
  const withSections = String(text ?? '').replace(/\{\{#([\w.]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_m, path, inner) =>
    lookup(context, path) ? inner : ''
  );
  return withSections.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path) => {
    const value = lookup(context, path);
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return '';
    return String(value);
  });
}

export function assertBalancedSections(text) {
  const opens = [...text.matchAll(/\{\{#([\w.]+)\}\}/g)].map((m) => m[1]);
  const closes = [...text.matchAll(/\{\{\/([\w.]+)\}\}/g)].map((m) => m[1]);
  if (opens.length !== closes.length || opens.some((o) => !closes.includes(o))) {
    throw new ValidationError('Every {{#section}} needs a matching {{/section}}');
  }
}

/** Trimmed, length-checked subject and body, or a ValidationError. */
export function cleanTemplate({ subject, body }) {
  const cleanSubject = String(subject ?? '').trim();
  const cleanBody = String(body ?? '').trim();
  if (cleanSubject.length < 1 || cleanSubject.length > 200) throw new ValidationError('subject must be 1-200 characters');
  if (cleanBody.length < 1 || cleanBody.length > 10000) throw new ValidationError('body must be 1-10000 characters');
  assertBalancedSections(cleanBody);
  assertBalancedSections(cleanSubject);
  return { subject: cleanSubject, body: cleanBody };
}
