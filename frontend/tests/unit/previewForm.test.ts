import { describe, expect, it } from 'vitest';
import { PREVIEW_MESSAGE, draftPreviewForm, isPreviewMessage, previewForm } from '@/components/event-setup/previewMessages';
import type { AdminForm } from '@/lib/applications';

const admin = {
  id: 'f1', eventId: 'e1', kind: 'PAID', purpose: 'VENDOR', name: 'Vendors', slug: 'vendors', intro: 'Saved intro', status: 'DRAFT',
  opensAt: null, closesAt: null, chargeTiming: 'APPROVAL', feeMode: 'PASS', taxable: false, paymentDueDays: 7, overduePolicy: 'WITHDRAW',
  reserveOnApproval: true, displayOrder: 0, createdFromTemplateId: null, acceptance: { open: false, reason: 'not_published' }, paymentsEnabled: true,
  applicationCount: 0, collectBusiness: true, addOns: [], timezone: 'America/New_York',
  tiers: [{ id: 't1', name: 'Corner', description: null, price: 120, quantityTotal: 4, quantityApproved: 0, quantityReserved: 0, remaining: 4, displayOrder: 0, isActive: true, amounts: {}, addOns: [] }],
  questions: [{ id: 'q1', label: 'What do you sell?', helpText: null, type: 'SHORT_TEXT', required: true, options: [], displayOrder: 0 }],
} as unknown as AdminForm;

describe('previewForm (spec 051)', () => {
  it('shows the saved form as open, with what is being typed on top', () => {
    const form = previewForm(admin, { name: 'Makers', intro: '' }, 'Retro Org');
    expect(form).toMatchObject({ name: 'Makers', intro: null, acceptance: { open: true, reason: null }, organizationName: 'Retro Org' });
    expect(form.tiers[0]).toMatchObject({ id: 't1', name: 'Corner', price: 120, applicantPays: 120, soldOut: false });
    expect(form.questions.map((q) => q.label)).toEqual(['What do you sell?']);
  });
  it('keeps the saved name and intro when nothing is typed', () => {
    expect(previewForm(admin)).toMatchObject({ name: 'Vendors', intro: 'Saved intro' });
    expect(previewForm(admin, { name: '   ' }).name).toBe('Vendors');
  });
  it('accepts a message carrying a form, refuses a malformed one', () => {
    const base = { type: PREVIEW_MESSAGE, orgId: 'o1', eventId: 'e1', overlay: {}, revision: 0, anchor: 'apply-top' };
    expect(isPreviewMessage({ ...base, form: previewForm(admin) })).toBe(true);
    expect(isPreviewMessage({ ...base, form: null })).toBe(true);
    expect(isPreviewMessage({ ...base, form: { name: 'x' } })).toBe(false);
    expect(isPreviewMessage({ ...base, form: 'x' })).toBe(false);
  });
});

describe('draftPreviewForm (spec 051 Start step)', () => {
  it('previews the form being set up: typed name, kind, purpose, no questions yet', () => {
    expect(draftPreviewForm({ name: '  Makers  ', kind: 'PAID', purpose: 'VENDOR' }, 'Retro Org')).toMatchObject({
      name: 'Makers', kind: 'PAID', purpose: 'VENDOR', questions: [], tiers: [], collectBusiness: false, collectName: false, acceptance: { open: true, reason: null }, organizationName: 'Retro Org',
    });
    expect(draftPreviewForm({ name: '', kind: 'FREE', purpose: 'VOLUNTEER' })).toMatchObject({ name: 'Untitled application', collectBusiness: false });
  });
});
