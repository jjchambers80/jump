// Signup / onboarding API calls (spec 022). Backend routes live in
// backend/src/api/routes/signup.js. Pending organizations never go through
// X-Jump-Org: every route takes the organization id in its path.

import api from './api';
import type { Organization } from '@/components/OrgContext';
import type { PendingOrganization, SurveyAnswers } from '@/lib/onboarding';

export interface SignupCurrent {
  organization: PendingOrganization | null;
  billingEnabled: boolean;
}

const signupService = {
  current(): Promise<SignupCurrent> {
    return api.get<SignupCurrent>('/signup/current');
  },
  get(orgId: string): Promise<PendingOrganization> {
    return api.get<PendingOrganization>(`/signup/${orgId}`);
  },
  start(name: string, source: 'admin' | 'public'): Promise<PendingOrganization> {
    return api.post<PendingOrganization>('/signup', { name, source });
  },
  saveSurvey(orgId: string, answers: SurveyAnswers): Promise<PendingOrganization> {
    return api.patch<PendingOrganization>(`/signup/${orgId}/survey`, answers);
  },
  skipSurvey(orgId: string): Promise<PendingOrganization> {
    return api.post<PendingOrganization>(`/signup/${orgId}/survey/skip`, {});
  },
  skipSubscribe(orgId: string): Promise<PendingOrganization> {
    return api.post<PendingOrganization>(`/signup/${orgId}/subscribe/skip`, {});
  },
  complete(orgId: string): Promise<Organization> {
    return api.post<Organization>(`/signup/${orgId}/complete`, {});
  },
  discard(orgId: string): Promise<void> {
    return api.delete(`/signup/${orgId}`);
  },
};

export default signupService;
