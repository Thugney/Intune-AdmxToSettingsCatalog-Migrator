// mapping.js - Settings mapping page
import { state, showToast, escapeHtml, downloadJson, saveState } from '../app.js';
import { searchSettingsCatalog } from '../graph.js';

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-generate-mapping').addEventListener('click', generateMapping);
  document.getElementById('btn-download-mapping').addEventListener('click', downloadMapping);

  window.addEventListener('page-loaded', (e) => {
    if (e.detail.page === 'mapping' && state.mappingSuggestions) {
      renderMappingTable();
      document.getElementById('mapping-results').classList.remove('hidden');
      document.getElementById('btn-download-mapping').classList.remove('hidden');
    }
  });
});

// Build search queries from ADMX definition metadata.
// Returns an array of queries to try in order of specificity.
function buildSearchQueries(dv) {
  const queries = [];
  const def = dv.definition;

  // Primary: definition display name (the actual ADMX setting name)
  if (def && def.displayName) {
    const name = def.displayName.replace(/"/g, '');
    queries.push(name);

    // Secondary: strip common ADMX prefixes for broader match
    const stripped = name
      .replace(/^(configure|enable|disable|allow|set|specify|turn on|turn off)\s+/i, '')
      .trim();
    if (stripped !== name && stripped.length > 3) {
      queries.push(stripped);
    }

    // Tertiary: use last segment of categoryPath + display name keywords
    if (def.categoryPath) {
      const segments = def.categoryPath.replace(/\\/g, '/').split('/').filter(Boolean);
      const lastSeg = segments[segments.length - 1];
      if (lastSeg && !name.toLowerCase().includes(lastSeg.toLowerCase())) {
        queries.push(`${lastSeg} ${stripped || name}`);
      }
    }
  }

  // Fallback: definitionValue displayName (rarely populated)
  if (queries.length === 0 && dv.displayName) {
    queries.push(dv.displayName.replace(/"/g, ''));
  }

  return queries;
}

// Determine the best setting name for display purposes
function getSettingName(dv) {
  if (dv.definition && dv.definition.displayName) return dv.definition.displayName;
  if (dv.displayName) return dv.displayName;
  return `definitionValue:${dv.id}`;
}

// Extract presentation values from the definitionValue for payload building
function extractSourceValues(dv) {
  const result = { enabled: dv.enabled !== false };
  const pvs = dv.presentationValues || [];
  for (const pv of pvs) {
    if (pv.value !== undefined && pv.value !== null) {
      // Store by type for payload building
      if (typeof pv.value === 'string') result.stringValue = pv.value;
      else if (typeof pv.value === 'number') result.numberValue = pv.value;
      else if (typeof pv.value === 'boolean') result.booleanValue = pv.value;
    }
    if (pv.values) result.listValues = pv.values;
  }
  return result;
}

// Build setting payload based on the Settings Catalog definition type and source values
function buildSettingPayload(candidate, sourceValues) {
  const odataType = candidate['@odata.type'] || candidate.odataType || '';
  const defId = candidate.settingDefinitionId;

  // Choice setting (most common for ADMX-backed settings)
  if (odataType.includes('ChoiceSettingDefinition') || odataType.includes('Choice') || !odataType) {
    // For ADMX-backed settings in SC, enabled = {defId}_1, disabled = {defId}_0
    const choiceValue = sourceValues.enabled ? `${defId}_1` : `${defId}_0`;
    return {
      '@odata.type': '#microsoft.graph.deviceManagementConfigurationSetting',
      settingInstance: {
        '@odata.type': '#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance',
        settingDefinitionId: defId,
        choiceSettingValue: {
          '@odata.type': '#microsoft.graph.deviceManagementConfigurationChoiceSettingValue',
          value: choiceValue,
          children: []
        }
      }
    };
  }

  // Simple setting (string/integer)
  if (odataType.includes('SimpleSettingDefinition') || odataType.includes('Simple')) {
    const val = sourceValues.stringValue || sourceValues.numberValue || '';
    return {
      '@odata.type': '#microsoft.graph.deviceManagementConfigurationSetting',
      settingInstance: {
        '@odata.type': '#microsoft.graph.deviceManagementConfigurationSimpleSettingInstance',
        settingDefinitionId: defId,
        simpleSettingValue: {
          '@odata.type': typeof val === 'number'
            ? '#microsoft.graph.deviceManagementConfigurationIntegerSettingValue'
            : '#microsoft.graph.deviceManagementConfigurationStringSettingValue',
          value: val
        }
      }
    };
  }

  // Default: generic choice (safest for ADMX-backed SC settings)
  return {
    '@odata.type': '#microsoft.graph.deviceManagementConfigurationSetting',
    settingInstance: {
      '@odata.type': '#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance',
      settingDefinitionId: defId,
      choiceSettingValue: {
        '@odata.type': '#microsoft.graph.deviceManagementConfigurationChoiceSettingValue',
        value: sourceValues.enabled ? `${defId}_1` : `${defId}_0`,
        children: []
      }
    }
  };
}

async function generateMapping() {
  if (!state.exportData || state.exportData.length === 0) {
    showToast('No export data found. Run Export first.', 'warning');
    return;
  }

  const btn = document.getElementById('btn-generate-mapping');
  btn.disabled = true;

  document.getElementById('mapping-progress').classList.remove('hidden');
  document.getElementById('mapping-results').classList.add('hidden');

  try {
    const suggestions = [];
    let totalSettings = 0;
    state.exportData.forEach(p => totalSettings += (p.definitionValues || []).length);

    let processed = 0;
    let apiErrors = 0;
    const progressBar = document.getElementById('mapping-progress-bar');
    const progressText = document.getElementById('mapping-progress-text');

    for (const policy of state.exportData) {
      for (const dv of (policy.definitionValues || [])) {
        processed++;
        const pct = Math.round((processed / totalSettings) * 100);
        progressBar.style.width = pct + '%';
        progressText.textContent = `${processed} / ${totalSettings}`;

        const settingName = getSettingName(dv);
        const queries = buildSearchQueries(dv);
        const sourceValues = extractSourceValues(dv);

        // Try each search query until we find candidates
        let candidates = [];
        let usedQuery = '';
        for (const q of queries) {
          if (candidates.length > 0) break;
          usedQuery = q;
          try {
            candidates = await searchSettingsCatalog(q);
          } catch (err) {
            apiErrors++;
            candidates = [];
          }
        }

        // If no queries could be built (no definition data), note it
        if (queries.length === 0) {
          usedQuery = settingName;
          // Still try searching with whatever name we have
          try {
            candidates = await searchSettingsCatalog(settingName.replace(/"/g, ''));
          } catch {
            apiErrors++;
          }
        }

        const top = (candidates || []).slice(0, 5).map(c => ({
          settingDefinitionId: c.id,
          displayName: c.displayName,
          description: c.description || '',
          odataType: c['@odata.type'] || ''
        }));

        // Determine confidence
        let confidence = 'none';
        if (top.length > 0) {
          const bestName = (top[0].displayName || '').toLowerCase();
          const srcName = settingName.toLowerCase();
          if (bestName === srcName) {
            confidence = 'high';
          } else if (bestName.includes(srcName) || srcName.includes(bestName)) {
            confidence = 'high';
          } else {
            // Check if significant keywords overlap
            const srcWords = new Set(srcName.split(/\s+/).filter(w => w.length > 3));
            const bestWords = new Set(bestName.split(/\s+/).filter(w => w.length > 3));
            const overlap = [...srcWords].filter(w => bestWords.has(w));
            confidence = overlap.length >= 2 ? 'high' : 'medium';
          }
        }

        const categoryPath = (dv.definition && dv.definition.categoryPath) || '';

        suggestions.push({
          sourcePolicyId: policy.id,
          sourcePolicyName: policy.displayName,
          sourceDefinitionValueId: dv.id,
          sourceSettingName: settingName,
          sourceCategoryPath: categoryPath,
          sourceValues,
          candidates: top,
          recommended: top[0] || null,
          confidence,
          searchQuery: usedQuery
        });
      }
    }

    state.mappingSuggestions = suggestions;
    saveState();

    renderMappingTable();
    document.getElementById('mapping-results').classList.remove('hidden');
    document.getElementById('btn-download-mapping').classList.remove('hidden');
    document.getElementById('mapping-progress').classList.add('hidden');

    const highCount = suggestions.filter(s => s.confidence === 'high').length;
    const medCount = suggestions.filter(s => s.confidence === 'medium').length;
    const noMatch = suggestions.filter(s => s.confidence === 'none').length;

    let msg = `Mapping complete: ${highCount} high, ${medCount} medium, ${noMatch} no match`;
    if (apiErrors > 0) msg += ` (${apiErrors} API errors)`;
    showToast(msg, noMatch === suggestions.length ? 'warning' : 'success');
  } catch (error) {
    showToast('Mapping failed: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function renderMappingTable() {
  const container = document.getElementById('mapping-table');
  const suggestions = state.mappingSuggestions || [];

  if (suggestions.length === 0) {
    container.innerHTML = '<div class="p-8 text-center text-gray-400">No mapping suggestions generated.</div>';
    return;
  }

  let html = '';
  let currentPolicy = '';

  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i];

    // Policy group header
    if (s.sourcePolicyName !== currentPolicy) {
      currentPolicy = s.sourcePolicyName;
      html += `
        <div class="px-6 py-3 bg-gray-50 border-b border-gray-200">
          <span class="text-sm font-semibold text-gray-700">${escapeHtml(currentPolicy)}</span>
        </div>
      `;
    }

    const confColor = s.confidence === 'high' ? 'confidence-high' : s.confidence === 'medium' ? 'confidence-medium' : 'confidence-none';
    const confLabel = s.confidence === 'high' ? 'High' : s.confidence === 'medium' ? 'Medium' : 'No match';
    const matchName = s.recommended ? escapeHtml(s.recommended.displayName) : '<span class="text-gray-400 italic">No match found</span>';
    const catPath = s.sourceCategoryPath ? `<div class="text-xs text-gray-400 truncate">${escapeHtml(s.sourceCategoryPath)}</div>` : '';

    html += `
      <div class="px-6 py-3 flex items-center gap-4 table-row">
        <div class="w-3 h-3 rounded-full ${confColor} flex-shrink-0" title="${confLabel}"></div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-gray-900 truncate">${escapeHtml(s.sourceSettingName)}</div>
          ${catPath}
        </div>
        <svg class="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
        <div class="flex-1 min-w-0">
          <div class="text-sm">${matchName}</div>
          ${s.candidates.length > 1 ? `<div class="text-xs text-gray-400">${s.candidates.length - 1} more candidates</div>` : ''}
        </div>
        <span class="px-2 py-0.5 text-xs font-medium rounded-full ${s.confidence === 'high' ? 'bg-green-100 text-green-700' : s.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'}">${confLabel}</span>
      </div>
    `;
  }

  container.innerHTML = html;
}

function downloadMapping() {
  if (!state.mappingSuggestions) return;

  // Build mapping.json from suggestions using recommended matches
  const entries = state.mappingSuggestions
    .filter(s => s.recommended)
    .map(s => {
      const payload = buildSettingPayload(s.recommended, s.sourceValues || { enabled: true });
      return {
        sourcePolicyId: s.sourcePolicyId,
        sourceDefinitionValueId: s.sourceDefinitionValueId,
        targetSettingDefinitionId: s.recommended.settingDefinitionId,
        settingPayload: payload
      };
    });

  downloadJson({ entries }, 'mapping.json');
  state.mappingEntries = entries;
  saveState();
}
