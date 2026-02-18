// export.js - Export page logic
import { state, showToast, escapeHtml, downloadJson, saveState, logLine } from '../app.js';
import { getAdmxPolicies, getAdmxDefinitionValues, getAdmxAssignments } from '../graph.js';

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-export').addEventListener('click', runExport);
  document.getElementById('btn-download-export').addEventListener('click', () => {
    if (state.exportData) downloadJson(state.exportData, 'export.admx.json');
  });
});

async function runExport() {
  const btn = document.getElementById('btn-export');
  btn.disabled = true;

  document.getElementById('export-progress').classList.remove('hidden');
  document.getElementById('export-results').classList.add('hidden');
  document.getElementById('export-log').innerHTML = '';

  try {
    logLine('export-log', 'Fetching ADMX policies from Intune...');
    const policies = await getAdmxPolicies();
    logLine('export-log', `Found ${policies.length} ADMX policies`);

    const progressBar = document.getElementById('export-progress-bar');
    const progressText = document.getElementById('export-progress-text');

    const exportData = [];
    let warnings = 0;

    for (let i = 0; i < policies.length; i++) {
      const p = policies[i];
      const pct = Math.round(((i + 1) / policies.length) * 100);
      progressBar.style.width = pct + '%';
      progressText.textContent = `${i + 1} / ${policies.length}`;

      logLine('export-log', `Exporting: ${p.displayName} (${p.id})`);

      let assignments = [];
      try {
        assignments = await getAdmxAssignments(p.id);
        if (assignments.length > 0) {
          logLine('export-log', `  Found ${assignments.length} assignment(s)`);
        }
      } catch (err) {
        warnings++;
        logLine('export-log', `WARN: Failed to get assignments for ${p.displayName}: ${err.message}`, 'warn');
      }

      let defValues = [];
      try {
        defValues = await getAdmxDefinitionValues(p.id);
      } catch (err) {
        warnings++;
        logLine('export-log', `WARN: Failed to get definitionValues for ${p.displayName}: ${err.message}`, 'warn');
      }

      exportData.push({
        id: p.id,
        displayName: p.displayName,
        description: p.description,
        lastModifiedDateTime: p.lastModifiedDateTime,
        assignments,
        definitionValues: defValues,
        raw: p
      });
    }

    state.exportData = exportData;
    saveState();

    logLine('export-log', `Export complete: ${exportData.length} policies, ${warnings} warnings`);
    if (warnings > 0) {
      logLine('export-log', `${warnings} warning(s) occurred. Some data may be incomplete.`, 'warn');
    }

    // Update dashboard stats
    let totalSettings = 0;
    exportData.forEach(p => totalSettings += (p.definitionValues || []).length);
    state.dashboardStats = { totalPolicies: exportData.length, totalSettings };
    saveState();

    renderExportTable(exportData);
    document.getElementById('export-results').classList.remove('hidden');
    document.getElementById('btn-download-export').classList.remove('hidden');

    showToast(`Exported ${exportData.length} policies successfully`, 'success');
  } catch (error) {
    logLine('export-log', `ERROR: ${error.message}`, 'error');
    showToast('Export failed: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function renderExportTable(data) {
  const container = document.getElementById('export-table');
  let html = `
    <table class="w-full text-sm">
      <thead class="bg-gray-50 text-left">
        <tr>
          <th class="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Policy Name</th>
          <th class="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Settings</th>
          <th class="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Assignments</th>
          <th class="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100">
  `;

  for (const p of data) {
    const sc = (p.definitionValues || []).length;
    const ac = (p.assignments || []).length;
    html += `
      <tr class="table-row">
        <td class="px-6 py-4 font-medium">${escapeHtml(p.displayName)}</td>
        <td class="px-6 py-4"><span class="px-2.5 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-700">${sc}</span></td>
        <td class="px-6 py-4"><span class="px-2.5 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-700">${ac}</span></td>
        <td class="px-6 py-4"><span class="px-2.5 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700">Exported</span></td>
      </tr>
    `;
  }

  html += '</tbody></table>';
  container.innerHTML = html;
}
