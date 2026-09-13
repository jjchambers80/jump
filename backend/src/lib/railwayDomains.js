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

// Railway's public API guide lists plain enum values (PENDING | ISSUED | FAILED,
// PENDING | VALID | INVALID); the GraphQL schema exposes prefixed ones
// (CERTIFICATE_STATUS_TYPE_VALID, DNS_RECORD_STATUS_PROPAGATED). Accept both
// until an introspection run against the live token pins the spelling.
export function normalizeCertificateStatus(raw) {
  const v = String(raw || '').toUpperCase();
  if (/VALID|ISSUED/.test(v)) return 'ISSUED';
  if (/FAIL/.test(v)) return 'FAILED';
  return 'PENDING';
}

function dnsRecordOk(raw) {
  return /PROPAGATED|VALID$/.test(String(raw || '').toUpperCase());
}

function recordType(r) {
  const t = String(r.recordType || r.type || '').toUpperCase();
  if (t.includes('CNAME')) return 'CNAME';
  if (t.includes('TXT')) return 'TXT';
  // No type field: infer from the value shape
  if (/^railway-verify=/i.test(r.requiredValue || '')) return 'TXT';
  if (/\.railway\.app\.?$/i.test(r.requiredValue || '')) return 'CNAME';
  return null;
}

/**
 * Create the custom domain on the frontend service.
 * Railway requires BOTH records it returns: the CNAME and a TXT
 * (_railway-verify.<host> -> railway-verify=<token>); without the TXT the
 * host answers 404 even once the CNAME resolves.
 * @param {string} hostname
 * @returns {Promise<{ id: string, cnameTarget: string|null, txtHost: string|null, txtValue: string|null }>}
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
  const records = created.status?.dnsRecords || [];
  const cname = records.find((r) => recordType(r) === 'CNAME');
  const txt = records.find((r) => recordType(r) === 'TXT');
  logger.info('Railway custom domain created', { hostname, railwayDomainId: created.id, txtPresent: Boolean(txt) });
  return {
    id: created.id,
    cnameTarget: cname?.requiredValue || null,
    txtHost: txt?.hostlabel || null,
    txtValue: txt?.requiredValue || null,
  };
}

/**
 * Certificate / DNS status for a Railway custom domain.
 * @param {string} id
 * @returns {Promise<{ certificateStatus: 'PENDING'|'ISSUED'|'FAILED', certificateReady: boolean, dnsOk: boolean }>}
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
  const certificateStatus = normalizeCertificateStatus(status.certificateStatus);
  return {
    certificateStatus,
    certificateReady: certificateStatus === 'ISSUED',
    dnsOk: (status.dnsRecords || []).every((r) => dnsRecordOk(r.status)),
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
