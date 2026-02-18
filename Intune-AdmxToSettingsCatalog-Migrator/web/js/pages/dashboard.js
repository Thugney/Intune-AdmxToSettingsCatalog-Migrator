// dashboard.js - Dashboard page logic
import { state, showToast, escapeHtml, saveState } from '../app.js';
import { getAdmxPolicies, getAdmxDefinitionValues, getAdmxAssignments } from '../graph.js';

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-refresh-dashboard').addEventListener('click', refreshDashboard);

  window.addEventListener('page-loaded', (e) => {
    if (e.detail.page === 'dashboard') updateDashboardStats();
  });
});

async function refreshDashboard() {
  const btn = document.getElementById('btn-refresh-dashboard');
  btn.disabled = true;
  btn.innerHTML = '<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Loading...';

  try {
    const policies = await getAdmxPolicies();

    // Fetch settings count for each policy (lightweight - just count)
    let totalSettings = 0;
    const policyData = [];

    for (const p of policies) {
      let settingsCount = 0;
      let assignmentCount = 0;
      try {
        const dv = await getAdmxDefinitionValues(p.id);
        settingsCount = dv.length;
        totalSettings += settingsCount;
      } catch {}
      try {
        const assignments = await getAdmxAssignments(p.id);
        assignmentCount = assignments.length;
      } catch {}

      policyData.push({
        id: p.id,
        displayName: p.displayName,
        description: p.description || '',
        lastModifiedDateTime: p.lastModifiedDateTime,
        settingsCount,
        assignmentCount
      });
    }

    // Store lightweight summary in state
    state.dashboardPolicies = policyData;
    state.dashboardStats = { totalPolicies: policies.length, totalSettings };
    saveState();

    updateDashboardStats();
    renderPoliciesTable(policyData);
    showToast(`Loaded ${policies.length} ADMX policies`, 'success');
  } catch (error) {
    showToast('Failed to load policies: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Refresh';
  }
}

function updateDashboardStats() {
  const stats = state.dashboardStats;
  document.getElementById('stat-admx').textContent = stats ? stats.totalPolicies : '-';
  document.getElementById('stat-settings').textContent = stats ? stats.totalSettings : '-';

  if (state.duplicateReport) {
    document.getElementById('stat-duplicates').textContent = state.duplicateReport.summary.duplicateGroups;
    document.getElementById('stat-conflicts').textContent = state.duplicateReport.summary.conflicts;
  }
}

function renderPoliciesTable(policies) {
  const container = document.getElementById('dashboard-policies-table');

  if (!policies || policies.length === 0) {
    container.innerHTML = '<div class="p-8 text-center text-gray-400">No ADMX policies found in your tenant.</div>';
    return;
  }

  let html = `
    <table class="w-full text-sm">
      <thead class="bg-gray-50 text-left">
        <tr>
          <th class="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Policy Name</th>
          <th class="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Settings</th>
          <th class="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Assignments</th>
          <th class="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Last Modified</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100">
  `;

  for (const p of policies) {
    const date = p.lastModifiedDateTime ? new Date(p.lastModifiedDateTime).toLocaleDateString() : 'N/A';
    html += `
      <tr class="table-row">
        <td class="px-6 py-4">
          <div class="font-medium text-gray-900">${escapeHtml(p.displayName)}</div>
          <div class="text-xs text-gray-400 truncate max-w-xs">${escapeHtml(p.description || '')}</div>
        </td>
        <td class="px-6 py-4">
          <span class="px-2.5 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-700">${p.settingsCount}</span>
        </td>
        <td class="px-6 py-4">
          <span class="px-2.5 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-700">${p.assignmentCount}</span>
        </td>
        <td class="px-6 py-4 text-gray-500">${date}</td>
      </tr>
    `;
  }

  html += '</tbody></table>';
  container.innerHTML = html;
}
