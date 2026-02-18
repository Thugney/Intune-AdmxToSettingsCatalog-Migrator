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
    const progressBar = document.getElementById('mapping-progress-bar');
    const progressText = document.getElementById('mapping-progress-text');

    for (const policy of state.exportData) {
      for (const dv of (policy.definitionValues || [])) {
        processed++;
        const pct = Math.round((processed / totalSettings) * 100);
        progressBar.style.width = pct + '%';
        progressText.textContent = `${processed} / ${totalSettings}`;

        // Determine setting name
        let settingName = null;
        if (dv.definition && dv.definition.displayName) settingName = dv.definition.displayName;
        else if (dv.displayName) settingName = dv.displayName;
        else settingName = `definitionValue:${dv.id}`;

        // Search Settings Catalog
        const query = settingName.replace(/"/g, '');
        let candidates = [];
        try {
          candidates = await searchSettingsCatalog(query);
        } catch {}

        const top = (candidates || []).slice(0, 5).map(c => ({
          settingDefinitionId: c.id,
          displayName: c.displayName,
          description: c.description || ''
        }));

        // Determine confidence
        let confidence = 'none';
        if (top.length > 0) {
          const bestName = (top[0].displayName || '').toLowerCase();
          const srcName = settingName.toLowerCase();
          if (bestName === srcName || bestName.includes(srcName) || srcName.includes(bestName)) {
            confidence = 'high';
          } else {
            confidence = 'medium';
          }
        }

        suggestions.push({
          sourcePolicyId: policy.id,
          sourcePolicyName: policy.displayName,
          sourceDefinitionValueId: dv.id,
          sourceSettingName: settingName,
          candidates: top,
          recommended: top[0] || null,
          confidence
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

    showToast(`Mapping complete: ${highCount} high, ${medCount} medium, ${noMatch} no match`, 'success');
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

    html += `
      <div class="px-6 py-3 flex items-center gap-4 table-row">
        <div class="w-3 h-3 rounded-full ${confColor} flex-shrink-0" title="${confLabel}"></div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-gray-900 truncate">${escapeHtml(s.sourceSettingName)}</div>
          <div class="text-xs text-gray-400">Source: ${escapeHtml(s.sourceDefinitionValueId.substring(0, 8))}...</div>
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

  // Build a curated mapping.json from suggestions (using recommended matches)
  const entries = state.mappingSuggestions
    .filter(s => s.recommended)
    .map(s => ({
      sourcePolicyId: s.sourcePolicyId,
      sourceDefinitionValueId: s.sourceDefinitionValueId,
      targetSettingDefinitionId: s.recommended.settingDefinitionId,
      settingPayload: {
        '@odata.type': '#microsoft.graph.deviceManagementConfigurationSetting',
        settingInstance: {
          '@odata.type': '#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance',
          settingDefinitionId: s.recommended.settingDefinitionId,
          choiceSettingValue: {
            '@odata.type': '#microsoft.graph.deviceManagementConfigurationChoiceSettingValue',
            value: 'enabled',
            children: []
          }
        }
      }
    }));

  downloadJson({ entries }, 'mapping.json');
  state.mappingEntries = entries;
  saveState();
}
