// migration.js - Migration execution and rollback page
import { state, showToast, escapeHtml, downloadJson, saveState, logLine, confirm } from '../app.js';
import {
  getSettingsCatalogPolicies,
  createSettingsCatalogPolicy,
  addSettingsToCatalogPolicy,
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
});

function getMappingIndex() {
  if (!state.mappingEntries || state.mappingEntries.length === 0) {
    // Try to build from suggestions
    if (state.mappingSuggestions) {
      return state.mappingSuggestions
        .filter(s => s.recommended)
        .reduce((acc, s) => {
          acc[`${s.sourcePolicyId}|${s.sourceDefinitionValueId}`] = {
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
          };
          return acc;
        }, {});
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
    // Check existing SC policies for idempotency
    logLine('migration-log', 'Checking existing Settings Catalog policies...');
    const existingPolicies = whatIf ? [] : await getSettingsCatalogPolicies();

    const markerKey = 'MK_ADMX_SOURCE_ID';

    for (let i = 0; i < state.exportData.length; i++) {
      const policy = state.exportData[i];
      const pct = Math.round(((i + 1) / state.exportData.length) * 100);
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
        if (mapIndex[key]) {
          settingsToAdd.push(mapIndex[key].settingPayload);
        } else {
          unmappedCount++;
          manifest.skipped.push({
            sourcePolicyId: policy.id,
            sourceDefinitionValueId: dv.id,
            reason: 'unmapped'
          });
        }
      }

      if (whatIf) {
        logLine('migration-log', `WOULD CREATE: "${targetName}" with ${settingsToAdd.length} settings (${unmappedCount} unmapped)`);
        manifest.createdPolicies.push({ sourcePolicyId: policy.id, targetName, settingsCount: settingsToAdd.length, whatIf: true });
      } else {
        logLine('migration-log', `CREATING: "${targetName}"...`);
        const desc = `${policy.description || ''}\n${marker}`.trim();

        const newPolicy = await createSettingsCatalogPolicy(targetName, desc);
        logLine('migration-log', `Created policy: ${newPolicy.id}`);

        if (settingsToAdd.length > 0) {
          logLine('migration-log', `Adding ${settingsToAdd.length} settings...`);
          await addSettingsToCatalogPolicy(newPolicy.id, settingsToAdd);
        }

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
    logLine('migration-log', `Created: ${manifest.createdPolicies.length} policies, Skipped: ${manifest.skipped.length} settings`);

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
  const ok = await confirm(
    'Execute Migration',
    'This will create Settings Catalog policies in your Intune tenant. A backup will be created first. Continue?'
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
