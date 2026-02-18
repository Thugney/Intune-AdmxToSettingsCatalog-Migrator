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
        try {
          const errJson = JSON.parse(errText);
          const err = errJson.error || {};
          errMsg += ': ' + (err.message || errText);
          // Include inner error details and target for debugging
          if (err.details) errMsg += ' | Details: ' + JSON.stringify(err.details);
          if (err.innerError) {
            const inner = err.innerError;
            if (inner.message) errMsg += ' | Inner: ' + inner.message;
            if (inner.date) errMsg += ' (' + inner.date + ')';
          }
        } catch {
          errMsg += ': ' + errText;
        }
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
  return graphGetPaged(
    `/deviceManagement/groupPolicyConfigurations/${policyId}/definitionValues?$expand=definition($select=id,displayName,categoryPath,classType,policyType),presentationValues`
  );
}

// Track search errors for diagnostics (exposed on window for debug)
const _searchErrors = [];
export function getSearchErrors() { return _searchErrors; }

export async function searchSettingsCatalog(query) {
  const safe = query.replace(/'/g, "''");
  let results = [];

  // Strategy 1: $filter with contains() on displayName (most reliable per MS docs)
  try {
    const r = await graphGet(
      `/deviceManagement/configurationSettings?$filter=contains(displayName,'${safe}')&$top=25`
    );
    results = r && r.value ? r.value : [];
  } catch (e) {
    _searchErrors.push({ strategy: 'filter-displayName', query, error: e.message });
  }

  if (results.length > 0) return results;

  // Strategy 2: $filter with contains() on id (SC setting IDs are descriptive strings
  // like "device_vendor_msft_policy_config_admx_settingname")
  const idQuery = safe.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  try {
    const r = await graphGet(
      `/deviceManagement/configurationSettings?$filter=contains(id,'${idQuery}')&$top=25`
    );
    results = r && r.value ? r.value : [];
  } catch (e) {
    _searchErrors.push({ strategy: 'filter-id', query: idQuery, error: e.message });
  }

  if (results.length > 0) return results;

  // Strategy 3: $search with ConsistencyLevel header (may not be supported on all tenants)
  try {
    const r = await graphGet(
      `/deviceManagement/configurationSettings?$search="${encodeURIComponent(query)}"&$top=25`,
      { 'ConsistencyLevel': 'eventual' }
    );
    results = r && r.value ? r.value : [];
  } catch (e) {
    _searchErrors.push({ strategy: '$search', query, error: e.message });
  }

  if (results.length > 0) return results;

  // Strategy 4: try individual significant words with $filter contains on displayName
  const words = query.split(/\s+/).filter(w =>
    w.length >= 4 && !/^(configure|enable|disable|allow|with|from|that|this|have|been|will|your|each|turn|specify|set)$/i.test(w)
  );
  for (const word of words.slice(0, 3)) {
    if (results.length > 0) break;
    const wordSafe = word.replace(/'/g, "''");
    try {
      const r = await graphGet(
        `/deviceManagement/configurationSettings?$filter=contains(displayName,'${wordSafe}')&$top=25`
      );
      results = r && r.value ? r.value : [];
    } catch (e) {
      _searchErrors.push({ strategy: 'filter-word', query: word, error: e.message });
    }
  }

  return results;
}

export async function getSettingsCatalogPolicies() {
  return graphGetPaged('/deviceManagement/configurationPolicies');
}

export async function createSettingsCatalogPolicy(name, description, settings = [], platform = 'windows10', technologies = 'mdm') {
  // Filter out any null/undefined entries from settings
  const validSettings = settings.filter(s => s && s.settingInstance);

  const body = {
    '@odata.type': '#microsoft.graph.deviceManagementConfigurationPolicy',
    name,
    description,
    platforms: platform,
    technologies,
    roleScopeTagIds: ['0'],
    templateReference: {
      '@odata.type': 'microsoft.graph.deviceManagementConfigurationPolicyTemplateReference',
      templateId: '',
      templateFamily: 'none'
    },
    settings: validSettings
  };

  console.log('[Graph] Creating policy with body:', JSON.stringify(body, null, 2));

  try {
    return await graphPost('/deviceManagement/configurationPolicies', body);
  } catch (err) {
    // If creation with settings fails, try without settings then add them individually
    if (err.message.includes('400') && validSettings.length > 0) {
      console.warn('[Graph] Create with settings failed, retrying without settings:', err.message);
      const policy = await graphPost('/deviceManagement/configurationPolicies', { ...body, settings: [] });

      // Add settings one at a time via the settings relationship endpoint
      for (const s of validSettings) {
        try {
          await graphPost(`/deviceManagement/configurationPolicies/${policy.id}/settings`, s);
        } catch (settingErr) {
          console.warn(`[Graph] Failed to add setting ${s.settingInstance?.settingDefinitionId}:`, settingErr.message);
        }
      }

      return policy;
    }
    throw err;
  }
}

export async function assignSettingsCatalogPolicy(policyId, assignments) {
  return graphPost(`/deviceManagement/configurationPolicies/${policyId}/assign`, { assignments });
}

export async function deleteSettingsCatalogPolicy(policyId) {
  return graphDelete(`/deviceManagement/configurationPolicies/${policyId}`);
}
