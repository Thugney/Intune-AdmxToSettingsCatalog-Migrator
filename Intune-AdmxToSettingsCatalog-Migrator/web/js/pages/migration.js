// migration.js - Migration execution and rollback page
import { state, showToast, escapeHtml, downloadJson, saveState, logLine, confirm } from '../app.js';
import {
  getSettingsCatalogPolicies,
  createSettingsCatalogPolicy,
  assignSettingsCatalogPolicy,
  deleteSettingsCatalogPolicy
} from '../graph.js';

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-migrate-preview').addEventListener('click', () => runMigration(true));
  document.getElementById('btn-migrate-execute').addEventListener('click', executeMigration);
  document.getElementById('btn-rollback').addEventListener('click', executeRollback);
  document.getElementById('btn-download-manifest').addEventListener('click', () => {
    if (state.manifest) downloadJson(state.manifest, 'migration.manifest.json');
  });
  document.getElementById('btn-select-all').addEventListener('click', () => toggleAllPolicies(true));
  document.getElementById('btn-deselect-all').addEventListener('click', () => toggleAllPolicies(false));

  // Refresh policy list when page becomes visible
  const observer = new MutationObserver(() => {
    const page = document.getElementById('page-migration');
    if (page && !page.classList.contains('hidden')) {
      renderPolicySelector();
    }
  });
  const page = document.getElementById('page-migration');
  if (page) observer.observe(page, { attributes: true, attributeFilter: ['class'] });
});

function renderPolicySelector() {
  const container = document.getElementById('migration-policy-list');
  const selector = document.getElementById('migration-policy-selector');

  if (!state.exportData || state.exportData.length === 0) {
    selector.classList.add('hidden');
    return;
  }

  const mapIndex = getMappingIndex();
  selector.classList.remove('hidden');

  let html = '';
  for (const policy of state.exportData) {
    // Count mapped settings for this policy
    let mappedCount = 0;
    let totalCount = (policy.definitionValues || []).length;
    if (mapIndex) {
      for (const dv of (policy.definitionValues || [])) {
        if (mapIndex[`${policy.id}|${dv.id}`]) mappedCount++;
      }
    }
    const allAssignments = policy.assignments || [];
    const assignCount = allAssignments.length;

    // Build assignment target labels
    const assignLabels = allAssignments.map(a => {
      if (!a) return null;
      const t = a.target || a;
      const odata = t['@odata.type'] || '';
      if (odata.includes('allDevices')) return 'All Devices';
      if (odata.includes('allLicensedUsers')) return 'All Users';
      if (t.groupId) return t.groupId.substring(0, 8) + '...';
      if (a.id) return 'Group';
      return null;
    }).filter(Boolean);

    const assignBadge = assignCount > 0
      ? `<span class="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">${assignCount} assignment${assignCount !== 1 ? 's' : ''}</span>`
      : `<span class="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-500">No assignments</span>`;

    html += `
      <label class="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer">
        <input type="checkbox" class="migration-policy-cb rounded border-gray-300 text-brand-600 focus:ring-brand-500" data-policy-id="${escapeHtml(policy.id)}" checked>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium text-gray-900 truncate">${escapeHtml(policy.displayName)}</span>
            ${assignBadge}
          </div>
          <div class="text-xs text-gray-500 mt-0.5">${mappedCount}/${totalCount} settings mapped${assignLabels.length > 0 ? ' &middot; Assigned to: ' + assignLabels.join(', ') : ''}</div>
        </div>
      </label>`;
  }

  container.innerHTML = html;
  updateSelectionCount();

  // Listen for checkbox changes
  container.querySelectorAll('.migration-policy-cb').forEach(cb => {
    cb.addEventListener('change', updateSelectionCount);
  });
}

function toggleAllPolicies(checked) {
  document.querySelectorAll('.migration-policy-cb').forEach(cb => { cb.checked = checked; });
  updateSelectionCount();
}

function updateSelectionCount() {
  const all = document.querySelectorAll('.migration-policy-cb');
  const selected = document.querySelectorAll('.migration-policy-cb:checked');
  const countEl = document.getElementById('migration-selection-count');
  if (countEl) countEl.textContent = `${selected.length} of ${all.length} policies selected`;
}

function getSelectedPolicyIds() {
  const checked = document.querySelectorAll('.migration-policy-cb:checked');
  return new Set(Array.from(checked).map(cb => cb.dataset.policyId));
}

function buildPayloadFromSuggestion(s) {
  const defId = s.recommended.settingDefinitionId;
  const odataType = s.recommended.odataType || s.recommended['@odata.type'] || '';
  const sourceValues = s.sourceValues || { enabled: true };

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

  // Choice setting (default for ADMX-backed)
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

function getMappingIndex() {
  if (!state.mappingEntries || state.mappingEntries.length === 0) {
    // Try to build from suggestions
    if (state.mappingSuggestions) {
      const idx = state.mappingSuggestions
        .filter(s => s.recommended)
        .reduce((acc, s) => {
          acc[`${s.sourcePolicyId}|${s.sourceDefinitionValueId}`] = {
            sourcePolicyId: s.sourcePolicyId,
            sourceDefinitionValueId: s.sourceDefinitionValueId,
            targetSettingDefinitionId: s.recommended.settingDefinitionId,
            settingPayload: buildPayloadFromSuggestion(s)
          };
          return acc;
        }, {});
      return Object.keys(idx).length > 0 ? idx : null;
    }
    return null;
  }

  return state.mappingEntries.reduce((acc, e) => {
    acc[`${e.sourcePolicyId}|${e.sourceDefinitionValueId}`] = e;
    return acc;
  }, {});
}

async function runMigration(whatIf = false) {
  if (!state.exportData) {
    showToast('No export data. Run Export first.', 'warning');
    return;
  }

  const mapIndex = getMappingIndex();
  if (!mapIndex) {
    showToast('No mapping data. Run Mapping first.', 'warning');
    return;
  }

  document.getElementById('migration-log-container').classList.remove('hidden');
  document.getElementById('migration-log').innerHTML = '';
  const statusEl = document.getElementById('migration-status');
  const progressBar = document.getElementById('migration-progress-bar');

  const mode = whatIf ? 'PREVIEW' : 'EXECUTE';
  statusEl.textContent = whatIf ? 'Preview Mode' : 'Running...';
  statusEl.className = `px-3 py-1 text-xs font-medium rounded-full ${whatIf ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'}`;

  logLine('migration-log', `=== Migration ${mode} Started ===`);

  const manifest = {
    generatedAt: new Date().toISOString(),
    mode,
    createdPolicies: [],
    skipped: []
  };

  try {
    // Filter to only selected policies
    const selectedIds = getSelectedPolicyIds();
    const policiesToMigrate = state.exportData.filter(p => selectedIds.has(p.id));

    if (policiesToMigrate.length === 0) {
      showToast('No policies selected. Check the boxes next to the policies you want to migrate.', 'warning');
      return;
    }

    logLine('migration-log', `Migrating ${policiesToMigrate.length} of ${state.exportData.length} policies`);

    // Check existing SC policies for idempotency
    logLine('migration-log', 'Checking existing Settings Catalog policies...');
    const existingPolicies = whatIf ? [] : await getSettingsCatalogPolicies();

    const markerKey = 'MK_ADMX_SOURCE_ID';

    for (let i = 0; i < policiesToMigrate.length; i++) {
      const policy = policiesToMigrate[i];
      const pct = Math.round(((i + 1) / policiesToMigrate.length) * 100);
      progressBar.style.width = pct + '%';

      const targetName = `SC - ${policy.displayName}`;
      const marker = `${markerKey}=${policy.id}`;

      // Idempotency check
      const existing = existingPolicies.find(p => p.description && p.description.includes(marker));
      if (existing) {
        logLine('migration-log', `SKIP: ${policy.displayName} - already migrated (${existing.id})`);
        continue;
      }

      // Gather mapped settings
      const settingsToAdd = [];
      let unmappedCount = 0;

      for (const dv of (policy.definitionValues || [])) {
        const key = `${policy.id}|${dv.id}`;
        const mapping = mapIndex[key];
        if (mapping && mapping.settingPayload) {
          settingsToAdd.push(mapping.settingPayload);
        } else {
          unmappedCount++;
          manifest.skipped.push({
            sourcePolicyId: policy.id,
            sourceDefinitionValueId: dv.id,
            reason: mapping ? 'no-payload' : 'unmapped'
          });
        }
      }

      // Graph API requires at least 1 setting - skip policies with none
      if (settingsToAdd.length === 0) {
        const dvCount = (policy.definitionValues || []).length;
        logLine('migration-log', `SKIP: "${policy.displayName}" - 0 of ${dvCount} settings mapped (${unmappedCount} unmapped)`, 'warning');
        manifest.skipped.push({
          sourcePolicyId: policy.id,
          reason: 'no-mapped-settings'
        });
        continue;
      }

      if (whatIf) {
        logLine('migration-log', `WOULD CREATE: "${targetName}" with ${settingsToAdd.length} settings (${unmappedCount} unmapped)`);
        manifest.createdPolicies.push({ sourcePolicyId: policy.id, targetName, settingsCount: settingsToAdd.length, whatIf: true });
      } else {
        logLine('migration-log', `CREATING: "${targetName}" with ${settingsToAdd.length} settings...`);
        const desc = `${policy.description || ''}\n${marker}`.trim();

        const newPolicy = await createSettingsCatalogPolicy(targetName, desc, settingsToAdd);
        logLine('migration-log', `Created policy: ${newPolicy.id}`);

        // Apply assignments
        const assignments = (policy.assignments || [])
          .filter(a => a && a.target)
          .map(a => ({ target: a.target }));

        if (assignments.length > 0) {
          logLine('migration-log', `Assigning to ${assignments.length} targets...`);
          await assignSettingsCatalogPolicy(newPolicy.id, assignments);
        }

        manifest.createdPolicies.push({
          sourcePolicyId: policy.id,
          targetPolicyId: newPolicy.id,
          targetName: newPolicy.name || targetName,
          settingsCount: settingsToAdd.length,
          assignmentCount: assignments.length
        });

        logLine('migration-log', `Completed: ${targetName}`);
      }
    }

    state.manifest = manifest;
    saveState();

    logLine('migration-log', `=== Migration ${mode} Complete ===`);
    const noMappedCount = manifest.skipped.filter(s => s.reason === 'no-mapped-settings').length;
    const unmappedSettings = manifest.skipped.filter(s => s.reason === 'unmapped' || s.reason === 'no-payload').length;
    logLine('migration-log', `Created: ${manifest.createdPolicies.length} policies | Skipped: ${noMappedCount} policies (no mapped settings) | ${unmappedSettings} individual settings unmapped`);

    statusEl.textContent = 'Complete';
    statusEl.className = 'px-3 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700';

    // Show manifest
    renderManifest(manifest);
    document.getElementById('migration-manifest').classList.remove('hidden');

    showToast(`Migration ${mode.toLowerCase()} complete: ${manifest.createdPolicies.length} policies`, 'success');
  } catch (error) {
    logLine('migration-log', `ERROR: ${error.message}`, 'error');
    statusEl.textContent = 'Failed';
    statusEl.className = 'px-3 py-1 text-xs font-medium rounded-full bg-red-100 text-red-700';
    showToast('Migration failed: ' + error.message, 'error');
  }
}

async function executeMigration() {
  const selectedIds = getSelectedPolicyIds();
  const selectedPolicies = (state.exportData || []).filter(p => selectedIds.has(p.id));
  const totalAssignments = selectedPolicies.reduce((sum, p) =>
    sum + (p.assignments || []).filter(a => a && a.target).length, 0);
  const assignMsg = totalAssignments > 0
    ? ` Assignments (${totalAssignments} total) will be copied to the new policies.`
    : ' No assignments will be applied (source policies have none).';

  const ok = await confirm(
    'Execute Migration',
    `This will create ${selectedPolicies.length} Settings Catalog policies in your Intune tenant.${assignMsg} A backup will be created first. Continue?`
  );
  if (!ok) return;
  await runMigration(false);
}

async function executeRollback() {
  if (!state.manifest || !state.manifest.createdPolicies || state.manifest.createdPolicies.length === 0) {
    showToast('No migration manifest found. Run a migration first.', 'warning');
    return;
  }

  const policiesToDelete = state.manifest.createdPolicies.filter(p => p.targetPolicyId);
  if (policiesToDelete.length === 0) {
    showToast('No policies to rollback (manifest only contains preview entries).', 'warning');
    return;
  }

  const ok = await confirm(
    'Rollback Migration',
    `This will DELETE ${policiesToDelete.length} Settings Catalog policies that were created by this tool. This cannot be undone. Continue?`
  );
  if (!ok) return;

  document.getElementById('migration-log-container').classList.remove('hidden');
  document.getElementById('migration-log').innerHTML = '';
  const statusEl = document.getElementById('migration-status');
  statusEl.textContent = 'Rolling back...';
  statusEl.className = 'px-3 py-1 text-xs font-medium rounded-full bg-red-100 text-red-700';

  logLine('migration-log', '=== Rollback Started ===');

  let deleted = 0;
  let failed = 0;

  for (const cp of policiesToDelete) {
    try {
      logLine('migration-log', `Deleting: ${cp.targetName} (${cp.targetPolicyId})`);
      await deleteSettingsCatalogPolicy(cp.targetPolicyId);
      deleted++;
      logLine('migration-log', `Deleted: ${cp.targetName}`);
    } catch (error) {
      failed++;
      logLine('migration-log', `FAILED to delete ${cp.targetName}: ${error.message}`, 'error');
    }
  }

  logLine('migration-log', `=== Rollback Complete: ${deleted} deleted, ${failed} failed ===`);

  statusEl.textContent = failed > 0 ? 'Partial Rollback' : 'Rolled Back';
  statusEl.className = `px-3 py-1 text-xs font-medium rounded-full ${failed > 0 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`;

  showToast(`Rollback complete: ${deleted} deleted, ${failed} failed`, failed > 0 ? 'warning' : 'success');
}

function renderManifest(manifest) {
  const container = document.getElementById('manifest-table');

  if (!manifest.createdPolicies || manifest.createdPolicies.length === 0) {
    container.innerHTML = '<div class="p-8 text-center text-gray-400">No policies in manifest.</div>';
    return;
  }

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

  for (const p of manifest.createdPolicies) {
    const isPreview = p.whatIf;
    html += `
      <tr class="table-row">
        <td class="px-6 py-4 font-medium">${escapeHtml(p.targetName)}</td>
        <td class="px-6 py-4"><span class="px-2.5 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-700">${p.settingsCount || 0}</span></td>
        <td class="px-6 py-4"><span class="px-2.5 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-700">${p.assignmentCount || 0}</span></td>
        <td class="px-6 py-4">
          <span class="px-2.5 py-1 text-xs font-medium rounded-full ${isPreview ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}">
            ${isPreview ? 'Preview' : 'Created'}
          </span>
        </td>
      </tr>
    `;
  }

  html += '</tbody></table>';

  if (manifest.skipped.length > 0) {
    html += `<div class="px-6 py-3 bg-amber-50 text-sm text-amber-700 border-t">
      <strong>${manifest.skipped.length}</strong> settings were skipped (unmapped)
    </div>`;
  }

  container.innerHTML = html;
}
