// duplicates.js - Duplicate settings detection page
import { state, showToast, escapeHtml, downloadJson, saveState } from '../app.js';

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-analyze-duplicates').addEventListener('click', analyzeDuplicates);
  document.getElementById('btn-download-dup-report').addEventListener('click', () => {
    if (state.duplicateReport) downloadJson(state.duplicateReport, 'duplicate-report.json');
  });

  // Filter buttons
  document.querySelectorAll('.dup-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = btn.dataset.filter;
      filterDuplicates(filter);
      document.querySelectorAll('.dup-filter-btn').forEach(b => b.classList.remove('ring-2', 'ring-brand-500'));
      btn.classList.add('ring-2', 'ring-brand-500');
    });
  });

  window.addEventListener('page-loaded', (e) => {
    if (e.detail.page === 'duplicates' && state.duplicateReport) {
      document.getElementById('btn-download-dup-report').classList.remove('hidden');
      showDuplicateResults();
    }
  });
});

function analyzeDuplicates() {
  if (!state.exportData || state.exportData.length === 0) {
    showToast('No export data found. Run Export first.', 'warning');
    return;
  }

  const btn = document.getElementById('btn-analyze-duplicates');
  btn.disabled = true;
  btn.innerHTML = '<svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Analyzing...';

  // Run analysis (client-side, no API calls needed)
  setTimeout(() => {
    try {
      const report = runDuplicateAnalysis(state.exportData);
      state.duplicateReport = report;
      saveState();

      // Update badge
      const badge = document.getElementById('dup-badge');
      if (report.summary.duplicateGroups > 0) {
        badge.textContent = report.summary.duplicateGroups;
        badge.classList.remove('hidden');
        badge.classList.add('badge-bounce');
      }

      // Update dashboard stats
      document.getElementById('stat-duplicates').textContent = report.summary.duplicateGroups;
      document.getElementById('stat-conflicts').textContent = report.summary.conflicts;

      document.getElementById('btn-download-dup-report').classList.remove('hidden');
      showDuplicateResults();
      showToast(`Analysis complete: ${report.summary.duplicateGroups} duplicate groups found`, report.summary.conflicts > 0 ? 'warning' : 'success');
    } catch (error) {
      showToast('Analysis failed: ' + error.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg> Analyze Duplicates';
    }
  }, 100);
}

function runDuplicateAnalysis(data) {
  const settingIndex = {};

  for (const policy of data) {
    for (const dv of (policy.definitionValues || [])) {
      let defId = null;
      if (dv.definition && dv.definition.id) defId = dv.definition.id;

      let defDisplayName = null;
      if (dv.definition && dv.definition.displayName) defDisplayName = dv.definition.displayName;
      else if (dv.displayName) defDisplayName = dv.displayName;

      let configuredState = 'unknown';
      if (dv.enabled === true) configuredState = 'enabled';
      else if (dv.enabled === false) configuredState = 'disabled';

      const settingKey = defId ? `defId:${defId}` : defDisplayName ? `name:${defDisplayName.toLowerCase().trim()}` : `dvId:${dv.id}`;

      if (!settingIndex[settingKey]) settingIndex[settingKey] = [];
      settingIndex[settingKey].push({
        policyId: policy.id,
        policyName: policy.displayName,
        definitionValueId: dv.id,
        settingName: defDisplayName,
        configuredState
      });
    }
  }

  const duplicateGroups = [];
  let conflictCount = 0;

  for (const key of Object.keys(settingIndex)) {
    const occurrences = settingIndex[key];
    if (occurrences.length <= 1) continue;

    const states = [...new Set(occurrences.map(o => o.configuredState))].sort();
    const isConflict = states.length > 1;
    if (isConflict) conflictCount++;

    const settingName = (occurrences.find(o => o.settingName) || {}).settingName || key;

    duplicateGroups.push({
      settingKey: key,
      settingName,
      occurrenceCount: occurrences.length,
      isConflict,
      states,
      policies: occurrences,
      recommendation: isConflict
        ? 'CONFLICT - Review manually: same setting configured differently'
        : 'CONSISTENT - Safe to merge or deduplicate'
    });
  }

  // Build merge candidates
  const policyOverlap = {};
  for (const dup of duplicateGroups) {
    const ids = dup.policies.map(p => p.policyId);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const pair = [ids[i], ids[j]].sort().join('|');
        if (!policyOverlap[pair]) {
          policyOverlap[pair] = {
            policy1: dup.policies.find(p => p.policyId === [ids[i], ids[j]].sort()[0]),
            policy2: dup.policies.find(p => p.policyId === [ids[i], ids[j]].sort()[1]),
            sharedSettings: [],
            conflicts: 0
          };
        }
        policyOverlap[pair].sharedSettings.push(dup.settingName);
        if (dup.isConflict) policyOverlap[pair].conflicts++;
      }
    }
  }

  const mergeCandidates = Object.values(policyOverlap)
    .map(pair => ({
      policy1Name: pair.policy1.policyName,
      policy2Name: pair.policy2.policyName,
      sharedSettingsCount: pair.sharedSettings.length,
      sharedSettings: [...new Set(pair.sharedSettings)],
      conflictCount: pair.conflicts,
      canAutoMerge: pair.conflicts === 0
    }))
    .sort((a, b) => b.sharedSettingsCount - a.sharedSettingsCount);

  let totalSettings = 0;
  data.forEach(p => totalSettings += (p.definitionValues || []).length);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalPolicies: data.length,
      totalSettings,
      duplicateGroups: duplicateGroups.length,
      conflicts: conflictCount,
      consistentDuplicates: duplicateGroups.length - conflictCount
    },
    duplicateGroups,
    mergeCandidates
  };
}

function showDuplicateResults() {
  const report = state.duplicateReport;
  if (!report) return;

  document.getElementById('dup-results').classList.remove('hidden');

  // Summary cards
  document.getElementById('dup-total-policies').textContent = report.summary.totalPolicies;
  document.getElementById('dup-total-groups').textContent = report.summary.duplicateGroups;
  document.getElementById('dup-consistent').textContent = report.summary.consistentDuplicates;
  document.getElementById('dup-conflicts').textContent = report.summary.conflicts;

  renderDuplicateGroups(report.duplicateGroups);
  renderMergeCandidates(report.mergeCandidates);
}

function renderDuplicateGroups(groups, filter = 'all') {
  const container = document.getElementById('dup-groups-list');

  const filtered = filter === 'all' ? groups
    : filter === 'conflict' ? groups.filter(g => g.isConflict)
    : groups.filter(g => !g.isConflict);

  if (filtered.length === 0) {
    container.innerHTML = '<div class="p-8 text-center text-gray-400">No duplicates found matching this filter.</div>';
    return;
  }

  let html = '';
  for (const dup of filtered) {
    const statusColor = dup.isConflict ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700';
    const statusLabel = dup.isConflict ? 'CONFLICT' : 'CONSISTENT';
    const icon = dup.isConflict
      ? '<svg class="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
      : '<svg class="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';

    html += `
      <div class="px-6 py-4">
        <div class="flex items-start gap-3">
          ${icon}
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-1">
              <span class="font-medium text-gray-900">${escapeHtml(dup.settingName)}</span>
              <span class="px-2 py-0.5 text-xs font-medium rounded-full ${statusColor}">${statusLabel}</span>
              <span class="text-xs text-gray-400">in ${dup.occurrenceCount} policies</span>
            </div>
            <div class="flex flex-wrap gap-2 mt-2">
              ${dup.policies.map(p => `
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg bg-gray-100 text-gray-700">
                  ${escapeHtml(p.policyName)}
                  <span class="px-1.5 py-0.5 rounded text-xs font-medium ${p.configuredState === 'enabled' ? 'bg-green-200 text-green-800' : p.configuredState === 'disabled' ? 'bg-red-200 text-red-800' : 'bg-gray-200 text-gray-600'}">${p.configuredState}</span>
                </span>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

function renderMergeCandidates(candidates) {
  const container = document.getElementById('dup-merge-list');

  if (!candidates || candidates.length === 0) {
    container.innerHTML = '<div class="p-8 text-center text-gray-400">No merge candidates found.</div>';
    return;
  }

  let html = '';
  for (const mc of candidates) {
    const canMerge = mc.canAutoMerge;
    const badgeColor = canMerge ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700';
    const badgeText = canMerge ? 'SAFE TO MERGE' : 'REVIEW NEEDED';

    html += `
      <div class="px-6 py-4">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-3">
            <span class="font-medium text-gray-900">${escapeHtml(mc.policy1Name)}</span>
            <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4"/></svg>
            <span class="font-medium text-gray-900">${escapeHtml(mc.policy2Name)}</span>
          </div>
          <span class="px-2.5 py-1 text-xs font-medium rounded-full ${badgeColor}">${badgeText}</span>
        </div>
        <div class="flex items-center gap-4 text-sm text-gray-500">
          <span>${mc.sharedSettingsCount} shared settings</span>
          ${mc.conflictCount > 0 ? `<span class="text-red-500">${mc.conflictCount} conflicts</span>` : ''}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

function filterDuplicates(filter) {
  if (state.duplicateReport) {
    renderDuplicateGroups(state.duplicateReport.duplicateGroups, filter);
  }
}
