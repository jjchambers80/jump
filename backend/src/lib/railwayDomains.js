// Railway custom-domain client (spec 007 phase 3)
//
// Attaches an organization's storefront hostname to the frontend service so
// Railway issues the TLS certificate. Entirely optional: when RAILWAY_API_TOKEN
// or RAILWAY_FRONTEND_SERVICE_ID is missing, isConfigured() is false and
// DomainService activates domains on DNS proof alone (the operator must then
// add the domain in the Railway dashboard by hand).
//
// Railway injects RAILWAY_PROJECT_ID and RAILWAY_ENVIRONMENT_ID into every
// service; only the token and the frontend service id must be set manually.

import logger from '../utils/logger.js';

const ENDPOINT = process.env.RAILWAY_API_URL || 'https://backboard.railway.com/graphql/v2';

function config() {
  return {
    token: process.env.RAILWAY_API_TOKEN,
    projectId: process.env.RAILWAY_PROJECT_ID,
    environmentId: process.env.RAILWAY_ENVIRONMENT_ID,
    serviceId: process.env.RAILWAY_FRONTEND_SERVICE_ID,
  };
}

export function isConfigured() {
  const c = config();
  return Boolean(c.token && c.projectId && c.environmentId && c.serviceId);
}

async function graphql(query, variables) {
  const { token } = config();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors?.length) {
    const message = json.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
    throw new Error(`Railway API: ${message}`);
  }
  return json.data;
}

/**
 * Create the custom domain on the frontend service.
 * @param {string} hostname
 * @returns {Promise<{ id: string, cnameTarget: string|null }>}
 */
export async function createCustomDomain(hostname) {
  const { projectId, environmentId, serviceId } = config();
  const data = await graphql(
    `mutation ($input: CustomDomainCreateInput!) {
       customDomainCreate(input: $input) {
         id
         domain
         status { dnsRecords { hostlabel recordType requiredValue currentValue status } }
       }
     }`,
    { input: { domain: hostname, projectId, environmentId, serviceId } }
  );
  const created = data.customDomainCreate;
  const cname = created.status?.dnsRecords?.find((r) => r.recordType === 'DNS_RECORD_TYPE_CNAME');
  logger.info('Railway custom domain created', { hostname, railwayDomainId: created.id });
  return { id: created.id, cnameTarget: cname?.requiredValue || null };
}

/**
 * Certificate / DNS status for a Railway custom domain.
 * @param {string} id
 * @returns {Promise<{ certificateReady: boolean, dnsOk: boolean }>}
 */
export async function getCustomDomainStatus(id) {
  const { projectId } = config();
  const data = await graphql(
    `query ($id: String!, $projectId: String!) {
       customDomain(id: $id, projectId: $projectId) {
         id
         status { certificateStatus dnsRecords { status } }
       }
     }`,
    { id, projectId }
  );
  const status = data.customDomain?.status || {};
  return {
    certificateReady: status.certificateStatus === 'CERTIFICATE_STATUS_TYPE_VALID',
    dnsOk: (status.dnsRecords || []).every((r) => r.status === 'DNS_RECORD_STATUS_PROPAGATED'),
  };
}

/** Remove a Railway custom domain. Missing domains are treated as removed. */
export async function deleteCustomDomain(id) {
  try {
    await graphql(`mutation ($id: String!) { customDomainDelete(id: $id) }`, { id });
    logger.info('Railway custom domain deleted', { railwayDomainId: id });
  } catch (error) {
    if (/not found/i.test(error.message)) return;
    throw error;
  }
}
