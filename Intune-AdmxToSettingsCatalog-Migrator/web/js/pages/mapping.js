// mapping.js - Settings mapping page
import { state, showToast, escapeHtml, downloadJson, saveState } from '../app.js';
import { searchSettingsCatalog, getSearchErrors } from '../graph.js';

let activeFilter = 'all';

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-generate-mapping').addEventListener('click', generateMapping);
  document.getElementById('btn-download-mapping').addEventListener('click', downloadMapping);

  // Filter buttons
  document.querySelectorAll('.mapping-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter;
      document.querySelectorAll('.mapping-filter-btn').forEach(b => b.classList.remove('ring-2', 'ring-brand-500'));
      btn.classList.add('ring-2', 'ring-brand-500');
      renderMappingTable();
    });
  });

  initSearchModal();

  window.addEventListener('page-loaded', (e) => {
    if (e.detail.page === 'mapping' && state.mappingSuggestions) {
      updateStats();
      renderMappingTable();
      document.getElementById('mapping-results').classList.remove('hidden');
      document.getElementById('btn-download-mapping').classList.remove('hidden');
    }
  });
});

// Build search queries from ADMX definition metadata.
// Returns an array of queries to try in order of specificity.
// ADMX policies are always Windows, so queries are tailored for finding
// the Windows Settings Catalog equivalent.
function buildSearchQueries(dv) {
  const queries = [];
  const def = dv.definition;

  if (def && def.displayName) {
    const name = def.displayName.replace(/"/g, '');

    // Primary: exact definition display name
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

  if (odataType.includes('ChoiceSettingDefinition') || odataType.includes('Choice') || !odataType) {
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

function updateStats() {
  const suggestions = state.mappingSuggestions || [];
  const high = suggestions.filter(s => s.confidence === 'high').length;
  const med = suggestions.filter(s => s.confidence === 'medium').length;
  const none = suggestions.filter(s => s.confidence === 'none').length;

  document.getElementById('mapping-stat-total').textContent = suggestions.length;
  document.getElementById('mapping-stat-high').textContent = high;
  document.getElementById('mapping-stat-medium').textContent = med;
  document.getElementById('mapping-stat-none').textContent = none;
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

        // Determine confidence based on name similarity and setting ID plausibility
        let confidence = 'none';
        if (top.length > 0) {
          const bestName = (top[0].displayName || '').toLowerCase();
          const bestId = (top[0].settingDefinitionId || '').toLowerCase();
          const srcName = settingName.toLowerCase();

          // Bonus: does the setting ID look like a proper Windows ADMX setting?
          const isAdmxId = bestId.includes('_policy_config_') || bestId.includes('admx_');

          if (bestName === srcName) {
            confidence = 'high';
          } else if (bestName.includes(srcName) || srcName.includes(bestName)) {
            confidence = isAdmxId ? 'high' : 'medium';
          } else {
            const srcWords = new Set(srcName.split(/\s+/).filter(w => w.length > 3));
            const bestWords = new Set(bestName.split(/\s+/).filter(w => w.length > 3));
            const overlap = [...srcWords].filter(w => bestWords.has(w));
            if (overlap.length >= 2 && isAdmxId) {
              confidence = 'high';
            } else if (overlap.length >= 2) {
              confidence = 'medium';
            } else {
              confidence = 'medium';
            }
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

    updateStats();
    renderMappingTable();
    document.getElementById('mapping-results').classList.remove('hidden');
    document.getElementById('btn-download-mapping').classList.remove('hidden');
    document.getElementById('mapping-progress').classList.add('hidden');

    const highCount = suggestions.filter(s => s.confidence === 'high').length;
    const medCount = suggestions.filter(s => s.confidence === 'medium').length;
    const noMatch = suggestions.filter(s => s.confidence === 'none').length;

    let msg = `Mapping complete: ${highCount} high, ${medCount} medium, ${noMatch} no match`;
    if (apiErrors > 0) msg += ` (${apiErrors} API errors)`;

    // Check for search errors and surface them
    const searchErrors = getSearchErrors();
    if (searchErrors.length > 0 && noMatch > suggestions.length * 0.5) {
      const uniqueErrs = [...new Set(searchErrors.map(e => e.error))];
      msg += `. Search API issues: ${uniqueErrs.slice(0, 2).join('; ')}`;
      console.warn('Search errors:', searchErrors);
    }

    showToast(msg, noMatch === suggestions.length ? 'warning' : 'success');
  } catch (error) {
    showToast('Mapping failed: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ==================== INDIVIDUAL MAPPING SEARCH ====================
let currentSearchIndex = -1;

function openSearchModal(suggestionIndex) {
  currentSearchIndex = suggestionIndex;
  const s = state.mappingSuggestions[suggestionIndex];
  const modal = document.getElementById('mapping-search-modal');
  const input = document.getElementById('mapping-search-input');
  const resultsContainer = document.getElementById('mapping-search-results');
  const sourceLabel = document.getElementById('mapping-search-source');

  sourceLabel.textContent = `Mapping: ${s.sourceSettingName}`;
  input.value = s.sourceSettingName;
  resultsContainer.innerHTML = '<div class="p-8 text-center text-gray-400 text-sm">Enter a search term and click Search</div>';
  modal.classList.remove('hidden');
  input.focus();
  input.select();
}

function initSearchModal() {
  const modal = document.getElementById('mapping-search-modal');
  const input = document.getElementById('mapping-search-input');
  const searchBtn = document.getElementById('mapping-search-btn');
  const closeBtn = document.getElementById('mapping-search-close');
  const cancelBtn = document.getElementById('mapping-search-cancel');
  const clearBtn = document.getElementById('mapping-search-clear');
  const resultsContainer = document.getElementById('mapping-search-results');

  async function doSearch() {
    const query = input.value.trim();
    if (!query) return;

    searchBtn.disabled = true;
    searchBtn.innerHTML = '<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>';
    resultsContainer.innerHTML = '<div class="p-8 text-center text-gray-400 text-sm">Searching...</div>';

    try {
      const results = await searchSettingsCatalog(query.replace(/"/g, ''));
      if (!results || results.length === 0) {
        resultsContainer.innerHTML = '<div class="p-8 text-center text-gray-400 text-sm">No results found. Try different keywords.</div>';
        return;
      }

      let html = '';
      for (const r of results.slice(0, 15)) {
        html += `
          <button class="mapping-search-pick w-full text-left px-4 py-3 hover:bg-brand-50 transition" data-id="${escapeHtml(r.id)}" data-name="${escapeHtml(r.displayName)}" data-desc="${escapeHtml(r.description || '')}" data-type="${escapeHtml(r['@odata.type'] || '')}">
            <div class="text-sm font-medium text-gray-900">${escapeHtml(r.displayName)}</div>
            <div class="text-xs text-gray-400 truncate mt-0.5">${escapeHtml(r.id)}</div>
            ${r.description ? `<div class="text-xs text-gray-500 mt-1 line-clamp-2">${escapeHtml(r.description.substring(0, 150))}</div>` : ''}
          </button>
        `;
      }
      resultsContainer.innerHTML = html;

      // Wire up pick buttons
      resultsContainer.querySelectorAll('.mapping-search-pick').forEach(btn => {
        btn.addEventListener('click', () => {
          const picked = {
            settingDefinitionId: btn.dataset.id,
            displayName: btn.dataset.name,
            description: btn.dataset.desc,
            odataType: btn.dataset.type
          };
          applyManualMapping(currentSearchIndex, picked);
          closeModal();
        });
      });
    } catch (err) {
      resultsContainer.innerHTML = `<div class="p-8 text-center text-red-400 text-sm">Search failed: ${escapeHtml(err.message)}</div>`;
    } finally {
      searchBtn.disabled = false;
      searchBtn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg> Search';
    }
  }

  function closeModal() {
    modal.classList.add('hidden');
    currentSearchIndex = -1;
  }

  searchBtn.addEventListener('click', doSearch);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  clearBtn.addEventListener('click', () => {
    if (currentSearchIndex >= 0) {
      applyManualMapping(currentSearchIndex, null);
      closeModal();
    }
  });
}

function applyManualMapping(index, picked) {
  const s = state.mappingSuggestions[index];
  if (picked) {
    s.recommended = picked;
    s.candidates = [picked, ...s.candidates.filter(c => c.settingDefinitionId !== picked.settingDefinitionId)].slice(0, 5);
    s.confidence = 'high';
  } else {
    s.recommended = null;
    s.candidates = [];
    s.confidence = 'none';
  }
  saveState();
  updateStats();
  renderMappingTable();
  showToast(picked ? `Mapped: ${s.sourceSettingName} → ${picked.displayName}` : `Removed mapping for: ${s.sourceSettingName}`, picked ? 'success' : 'info');
}

// ==================== RENDER ====================
function updateFilterCounts() {
  const suggestions = state.mappingSuggestions || [];
  const high = suggestions.filter(s => s.confidence === 'high').length;
  const med = suggestions.filter(s => s.confidence === 'medium').length;
  const none = suggestions.filter(s => s.confidence === 'none').length;

  document.querySelectorAll('.mapping-filter-btn').forEach(btn => {
    const f = btn.dataset.filter;
    if (f === 'all') btn.textContent = `All (${suggestions.length})`;
    else if (f === 'high') btn.textContent = `High (${high})`;
    else if (f === 'medium') btn.textContent = `Medium (${med})`;
    else if (f === 'none') btn.textContent = `No Match (${none})`;
  });
}

function confirmMapping(index) {
  const s = state.mappingSuggestions[index];
  s.confidence = 'high';
  saveState();
  updateStats();
  updateFilterCounts();
  renderMappingTable();
  showToast(`Confirmed: ${s.sourceSettingName}`, 'success');
}

function rejectMapping(index) {
  const s = state.mappingSuggestions[index];
  s.recommended = null;
  s.candidates = [];
  s.confidence = 'none';
  saveState();
  updateStats();
  updateFilterCounts();
  renderMappingTable();
  showToast(`Rejected mapping for: ${s.sourceSettingName}`, 'info');
}

function renderMappingTable() {
  const container = document.getElementById('mapping-table');
  const suggestions = state.mappingSuggestions || [];

  updateFilterCounts();

  if (suggestions.length === 0) {
    container.innerHTML = '<div class="p-8 text-center text-gray-400">No mapping suggestions generated.</div>';
    return;
  }

  // Apply filter
  const filtered = activeFilter === 'all' ? suggestions : suggestions.filter(s => s.confidence === activeFilter);

  if (filtered.length === 0) {
    container.innerHTML = `<div class="p-8 text-center text-gray-400">No settings match the "${activeFilter}" filter.</div>`;
    return;
  }

  // Group by policy for per-policy summaries
  const policyGroups = new Map();
  for (const s of filtered) {
    if (!policyGroups.has(s.sourcePolicyName)) policyGroups.set(s.sourcePolicyName, []);
    policyGroups.get(s.sourcePolicyName).push(s);
  }

  let html = '';

  for (const [policyName, items] of policyGroups) {
    const pHigh = items.filter(s => s.confidence === 'high').length;
    const pMed = items.filter(s => s.confidence === 'medium').length;
    const pNone = items.filter(s => s.confidence === 'none').length;

    // Policy group header with per-policy stats
    html += `
      <div class="px-6 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between gap-4">
        <span class="text-sm font-semibold text-gray-700 truncate">${escapeHtml(policyName)}</span>
        <div class="flex items-center gap-3 text-xs flex-shrink-0">
          <span class="text-gray-500">${items.length} settings</span>
          ${pHigh ? `<span class="text-green-600 font-medium">${pHigh} ready</span>` : ''}
          ${pMed ? `<span class="text-amber-500 font-medium">${pMed} review</span>` : ''}
          ${pNone ? `<span class="text-gray-400">${pNone} none</span>` : ''}
        </div>
      </div>
    `;

    // Table header
    html += `
      <div class="px-6 py-2 grid grid-cols-12 gap-3 text-xs font-medium text-gray-400 uppercase tracking-wider border-b border-gray-100 bg-gray-50/50">
        <div class="col-span-1">Status</div>
        <div class="col-span-4">ADMX Setting (source)</div>
        <div class="col-span-1 text-center"></div>
        <div class="col-span-4">Settings Catalog Match (target)</div>
        <div class="col-span-2 text-right">Action</div>
      </div>
    `;

    for (const s of items) {
      // Find the real index in state.mappingSuggestions for this item
      const realIndex = state.mappingSuggestions.indexOf(s);

      const badgeClass = s.confidence === 'high'
        ? 'bg-green-100 text-green-700'
        : s.confidence === 'medium'
          ? 'bg-yellow-100 text-yellow-700'
          : 'bg-gray-100 text-gray-500';
      const badgeText = s.confidence === 'high' ? 'Ready' : s.confidence === 'medium' ? 'Review' : 'None';

      let matchHtml;
      if (s.recommended) {
        matchHtml = `<div class="text-sm text-gray-900 truncate">${escapeHtml(s.recommended.displayName)}</div>
           <div class="text-xs text-gray-400 truncate">${escapeHtml(s.recommended.settingDefinitionId)}</div>`;
      } else {
        const searchedQuery = s.searchQuery ? escapeHtml(s.searchQuery) : '';
        matchHtml = `<div class="text-sm text-gray-400 italic">No match found</div>
           <div class="text-xs text-gray-300">Searched: "${searchedQuery}"</div>`;
      }

      const catPath = s.sourceCategoryPath
        ? `<div class="text-xs text-gray-400 truncate">${escapeHtml(s.sourceCategoryPath)}</div>`
        : '';

      // Build action buttons based on confidence
      let actionHtml = '';
      if (s.confidence === 'medium') {
        // Review items: Accept, Reject, or Change
        actionHtml = `
          <div class="flex items-center gap-1 justify-end">
            <button class="mapping-row-accept px-2 py-1 text-xs font-medium rounded-lg bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 transition" data-index="${realIndex}" title="Accept this mapping">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
            </button>
            <button class="mapping-row-reject px-2 py-1 text-xs font-medium rounded-lg bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition" data-index="${realIndex}" title="Reject — not the right match">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
            <button class="mapping-row-search px-2 py-1 text-xs font-medium rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 hover:border-brand-400 hover:text-brand-600 transition" data-index="${realIndex}" title="Search for a different match">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            </button>
          </div>`;
      } else if (s.confidence === 'none') {
        // No match: Search manually
        actionHtml = `
          <button class="mapping-row-search px-2.5 py-1 text-xs font-medium rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 hover:border-brand-400 hover:text-brand-600 transition" data-index="${realIndex}">
            <svg class="w-3.5 h-3.5 inline -mt-0.5 mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            Search
          </button>`;
      } else {
        // High confidence: Change option
        actionHtml = `
          <button class="mapping-row-search px-2.5 py-1 text-xs font-medium rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 hover:border-brand-400 hover:text-brand-600 transition" data-index="${realIndex}">
            <svg class="w-3.5 h-3.5 inline -mt-0.5 mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            Change
          </button>`;
      }

      html += `
        <div class="px-6 py-3 grid grid-cols-12 gap-3 items-center table-row border-b border-gray-50">
          <div class="col-span-1">
            <span class="px-2 py-0.5 text-xs font-medium rounded-full ${badgeClass}">${badgeText}</span>
          </div>
          <div class="col-span-4 min-w-0">
            <div class="text-sm font-medium text-gray-900 truncate">${escapeHtml(s.sourceSettingName)}</div>
            ${catPath}
          </div>
          <div class="col-span-1 text-center">
            <svg class="w-4 h-4 text-gray-300 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
          </div>
          <div class="col-span-4 min-w-0">
            ${matchHtml}
          </div>
          <div class="col-span-2 text-right">
            ${actionHtml}
          </div>
        </div>
      `;
    }
  }

  container.innerHTML = html;

  // Wire up search buttons
  container.querySelectorAll('.mapping-row-search').forEach(btn => {
    btn.addEventListener('click', () => {
      openSearchModal(parseInt(btn.dataset.index));
    });
  });

  // Wire up accept buttons
  container.querySelectorAll('.mapping-row-accept').forEach(btn => {
    btn.addEventListener('click', () => {
      confirmMapping(parseInt(btn.dataset.index));
    });
  });

  // Wire up reject buttons
  container.querySelectorAll('.mapping-row-reject').forEach(btn => {
    btn.addEventListener('click', () => {
      rejectMapping(parseInt(btn.dataset.index));
    });
  });
}

function downloadMapping() {
  if (!state.mappingSuggestions) return;

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
