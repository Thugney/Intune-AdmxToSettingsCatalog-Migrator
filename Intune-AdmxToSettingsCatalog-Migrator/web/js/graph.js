// graph.js - Microsoft Graph API client for browser
// Handles REST calls with retry logic for throttling

import { getToken } from './auth.js';

const GRAPH_BASE = 'https://graph.microsoft.com';
let apiVersion = 'beta';

export function setApiVersion(version) {
  apiVersion = version;
}

export function getApiVersion() {
  return apiVersion;
}

async function graphRequest(method, url, body = null, extraHeaders = {}) {
  const token = await getToken();
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...extraHeaders
  };

  const maxRetries = 4;
  let delay = 2000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const options = { method, headers };
      if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);

      if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
        if (attempt < maxRetries) {
          const retryAfter = response.headers.get('Retry-After');
          const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : delay;
          await new Promise(r => setTimeout(r, waitMs));
          delay *= 2;
          continue;
        }
      }

      if (response.status === 204) return null; // DELETE success

      if (!response.ok) {
        const errText = await response.text();
        let errMsg = `Graph API ${response.status}`;
        try { errMsg += ': ' + JSON.parse(errText).error.message; } catch {}
        throw new Error(errMsg);
      }

      return await response.json();
    } catch (error) {
      if (attempt < maxRetries && error.message.includes('Failed to fetch')) {
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
        continue;
      }
      throw error;
    }
  }
}

export async function graphGet(path, extraHeaders = {}) {
  const url = path.startsWith('http') ? path : `${GRAPH_BASE}/${apiVersion}${path}`;
  return graphRequest('GET', url, null, extraHeaders);
}

export async function graphPost(path, body, extraHeaders = {}) {
  const url = path.startsWith('http') ? path : `${GRAPH_BASE}/${apiVersion}${path}`;
  return graphRequest('POST', url, body, extraHeaders);
}

export async function graphDelete(path) {
  const url = path.startsWith('http') ? path : `${GRAPH_BASE}/${apiVersion}${path}`;
  return graphRequest('DELETE', url);
}

export async function graphGetPaged(path, extraHeaders = {}) {
  const items = [];
  let url = path.startsWith('http') ? path : `${GRAPH_BASE}/${apiVersion}${path}`;

  while (url) {
    const resp = await graphRequest('GET', url, null, extraHeaders);
    if (resp && resp.value) {
      items.push(...resp.value);
    }
    url = resp && resp['@odata.nextLink'] ? resp['@odata.nextLink'] : null;
  }

  return items;
}

// High-level Intune operations
export async function getAdmxPolicies() {
  return graphGetPaged('/deviceManagement/groupPolicyConfigurations');
}

export async function getAdmxAssignments(policyId) {
  return graphGetPaged(`/deviceManagement/groupPolicyConfigurations/${policyId}/assignments`);
}

export async function getAdmxDefinitionValues(policyId) {
  return graphGetPaged(`/deviceManagement/groupPolicyConfigurations/${policyId}/definitionValues`);
}

export async function searchSettingsCatalog(query) {
  return graphGet(
    `/deviceManagement/configurationSettings?$search="${encodeURIComponent(query)}"`,
    { 'ConsistencyLevel': 'eventual' }
  ).then(r => r && r.value ? r.value : []).catch(() => []);
}

export async function getSettingsCatalogPolicies() {
  return graphGetPaged('/deviceManagement/configurationPolicies');
}

export async function createSettingsCatalogPolicy(name, description, platform = 'windows10', technologies = 'mdm') {
  return graphPost('/deviceManagement/configurationPolicies', {
    name, description, platforms: platform, technologies
  });
}

export async function addSettingsToCatalogPolicy(policyId, settings) {
  for (const s of settings) {
    await graphPost(`/deviceManagement/configurationPolicies/${policyId}/settings`, s);
  }
}

export async function assignSettingsCatalogPolicy(policyId, assignments) {
  return graphPost(`/deviceManagement/configurationPolicies/${policyId}/assign`, { assignments });
}

export async function deleteSettingsCatalogPolicy(policyId) {
  return graphDelete(`/deviceManagement/configurationPolicies/${policyId}`);
}
