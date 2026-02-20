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

// Known non-Windows setting ID prefixes. Settings starting with these are
// macOS, iOS, or Android and must be excluded when migrating ADMX (Windows).
const NON_WINDOWS_PREFIXES = [
  'com.apple.',          // macOS / iOS
  'ade_',                // Apple Device Enrollment
  'appleosxconfiguration', // macOS configuration profiles
  'ios_',                // iOS
  'android',             // Android
];

// Check if a setting definition ID belongs to the Windows platform.
// Windows SC IDs typically start with "device_vendor_msft_" or "user_vendor_msft_".
function isWindowsSetting(settingId) {
  if (!settingId) return false;
  const id = settingId.toLowerCase();
  for (const prefix of NON_WINDOWS_PREFIXES) {
    if (id.startsWith(prefix)) return false;
  }
  return true;
}

// Filter search results to only include settings compatible with the given platform.
function filterByPlatform(results, platform) {
  if (!platform || platform !== 'windows10') return results;
  return results.filter(r => {
    const id = (r.id || '').toLowerCase();
    // Exclude known non-Windows settings
    if (!isWindowsSetting(id)) return false;
    // If the result includes applicability info, also check that
    if (r.applicability) {
      const appStr = JSON.stringify(r.applicability).toLowerCase();
      if (appStr.includes('macos') || appStr.includes('ios') || appStr.includes('android')) {
        // Only exclude if it does NOT also mention windows
        if (!appStr.includes('windows')) return false;
      }
    }
    return true;
  });
}

export async function searchSettingsCatalog(query, platform = 'windows10') {
  const safe = query.replace(/'/g, "''");
  let results = [];

  // Strategy 1: $filter with contains() on displayName (most reliable per MS docs)
  try {
    const r = await graphGet(
      `/deviceManagement/configurationSettings?$filter=contains(displayName,'${safe}')&$top=50`
    );
    results = filterByPlatform(r && r.value ? r.value : [], platform);
  } catch (e) {
    _searchErrors.push({ strategy: 'filter-displayName', query, error: e.message });
  }

  if (results.length > 0) return results;

  // Strategy 2: $filter with contains() on id (SC setting IDs are descriptive strings
  // like "device_vendor_msft_policy_config_admx_settingname")
  const idQuery = safe.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  try {
    const r = await graphGet(
      `/deviceManagement/configurationSettings?$filter=contains(id,'${idQuery}')&$top=50`
    );
    results = filterByPlatform(r && r.value ? r.value : [], platform);
  } catch (e) {
    _searchErrors.push({ strategy: 'filter-id', query: idQuery, error: e.message });
  }

  if (results.length > 0) return results;

  // Strategy 3: $search with ConsistencyLevel header (may not be supported on all tenants)
  try {
    const r = await graphGet(
      `/deviceManagement/configurationSettings?$search="${encodeURIComponent(query)}"&$top=50`,
      { 'ConsistencyLevel': 'eventual' }
    );
    results = filterByPlatform(r && r.value ? r.value : [], platform);
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
        `/deviceManagement/configurationSettings?$filter=contains(displayName,'${wordSafe}')&$top=50`
      );
      results = filterByPlatform(r && r.value ? r.value : [], platform);
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
  // Filter out null/undefined entries, deduplicate, and reject non-Windows settings
  const seen = new Set();
  const validSettings = settings.filter(s => {
    if (!s || !s.settingInstance) return false;
    const id = s.settingInstance.settingDefinitionId;
    if (seen.has(id)) {
      console.warn(`[Graph] Skipping duplicate setting: ${id}`);
      return false;
    }
    // Platform safety: reject settings that clearly belong to other platforms
    if (platform === 'windows10' && !isWindowsSetting(id)) {
      console.warn(`[Graph] Rejecting non-Windows setting: ${id}`);
      return false;
    }
    seen.add(id);
    return true;
  });

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
    if (!err.message.includes('400') || validSettings.length === 0) {
      throw err;
    }

    const inlineError = err.message;
    console.warn('[Graph] Create with inline settings failed:', inlineError);

    // Check for platform mismatch errors before attempting fallback
    if (inlineError.includes('applicability') && inlineError.includes('does not match')) {
      console.error('[Graph] Platform mismatch detected — settings belong to a different platform than the policy');
      throw new Error(
        `Platform mismatch: One or more settings are for a different platform (e.g., macOS) ` +
        `but the policy targets Windows. Re-run the mapping to fix incorrect matches. ` +
        `Original error: ${inlineError}`
      );
    }

    console.warn('[Graph] Fallback: creating policy without settings, then adding individually');

    // Fallback: create the policy WITHOUT the settings property.
    // The API rejects settings:[] ("Count is not >= 1") so we omit it entirely.
    const { settings: _, ...bodyWithoutSettings } = body;

    let policy;
    try {
      policy = await graphPost('/deviceManagement/configurationPolicies', bodyWithoutSettings);
    } catch (createErr) {
      // Both approaches failed — surface both errors so the user can diagnose
      throw new Error(
        `Failed to create policy. ` +
        `Inline settings error: ${inlineError} | ` +
        `Create-then-add error: ${createErr.message}`
      );
    }

    // Add settings one at a time via the settings relationship endpoint
    let added = 0;
    const failures = [];
    for (const s of validSettings) {
      try {
        await graphPost(`/deviceManagement/configurationPolicies/${policy.id}/settings`, s);
        added++;
      } catch (settingErr) {
        const sid = s.settingInstance?.settingDefinitionId || 'unknown';
        console.warn(`[Graph] Failed to add setting ${sid}:`, settingErr.message);
        failures.push(sid);
      }
    }

    console.log(`[Graph] Added ${added}/${validSettings.length} settings individually`);
    if (failures.length > 0) {
      console.warn(`[Graph] ${failures.length} settings failed to add:`, failures);
    }

    return policy;
  }
}

export async function assignSettingsCatalogPolicy(policyId, assignments) {
  return graphPost(`/deviceManagement/configurationPolicies/${policyId}/assign`, { assignments });
}

export async function deleteSettingsCatalogPolicy(policyId) {
  return graphDelete(`/deviceManagement/configurationPolicies/${policyId}`);
}
