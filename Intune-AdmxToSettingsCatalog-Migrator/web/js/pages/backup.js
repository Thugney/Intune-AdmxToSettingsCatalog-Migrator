// backup.js - Backup and restore page
import { state, showToast, escapeHtml, downloadJson, saveBackups } from '../app.js';
import { getAdmxPolicies, getSettingsCatalogPolicies } from '../graph.js';

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-create-backup').addEventListener('click', createBackup);

  window.addEventListener('page-loaded', (e) => {
    if (e.detail.page === 'backup') renderBackupList();
  });
});

async function createBackup() {
  const btn = document.getElementById('btn-create-backup');
  btn.disabled = true;
  btn.innerHTML = '<svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Creating backup...';

  try {
    showToast('Creating backup snapshot...', 'info');

    // Fetch current state from Intune
    const [admxPolicies, scPolicies] = await Promise.all([
      getAdmxPolicies(),
      getSettingsCatalogPolicies()
    ]);

    const timestamp = new Date().toISOString();
    const backup = {
      id: 'bk-' + Date.now(),
      timestamp,
      displayTimestamp: new Date().toLocaleString(),
      admxPolicies: admxPolicies.map(p => ({
        id: p.id,
        displayName: p.displayName,
        description: p.description,
        lastModifiedDateTime: p.lastModifiedDateTime
      })),
      scPolicies: scPolicies.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description
      })),
      localState: {
        exportData: state.exportData ? true : false,
        mappingSuggestions: state.mappingSuggestions ? true : false,
        manifest: state.manifest ? true : false
      },
      stats: {
        admxCount: admxPolicies.length,
        scCount: scPolicies.length
      }
    };

    // Save full backup data as downloadable JSON (for large data)
    backup.fullExport = {
      admxPolicies,
      scPolicies
    };

    state.backups.unshift(backup);

    // Keep only last 10 backups in localStorage (without fullExport to save space)
    const storageBackups = state.backups.map(b => {
      const copy = { ...b };
      delete copy.fullExport;
      return copy;
    }).slice(0, 10);
    state.backups = state.backups.slice(0, 10);

    try {
      localStorage.setItem('mk-backups', JSON.stringify(storageBackups));
    } catch {}

    renderBackupList();
    showToast(`Backup created: ${admxPolicies.length} ADMX, ${scPolicies.length} SC policies`, 'success');
  } catch (error) {
    showToast('Backup failed: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/></svg> Create Backup Now';
  }
}

function renderBackupList() {
  const container = document.getElementById('backup-list');

  if (!state.backups || state.backups.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center text-gray-400">
        <svg class="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/></svg>
        <p>No backups yet. Create one before making changes.</p>
      </div>
    `;
    return;
  }

  let html = '';
  for (const backup of state.backups) {
    html += `
      <div class="px-6 py-4 flex items-center justify-between border-b border-gray-100 last:border-0 table-row">
        <div class="flex items-center gap-4">
          <div class="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
            <svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/></svg>
          </div>
          <div>
            <p class="font-medium text-gray-900">${escapeHtml(backup.displayTimestamp || new Date(backup.timestamp).toLocaleString())}</p>
            <div class="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
              <span>ADMX: ${backup.stats ? backup.stats.admxCount : '?'} policies</span>
              <span>SC: ${backup.stats ? backup.stats.scCount : '?'} policies</span>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="window._downloadBackup('${backup.id}')" class="px-3 py-1.5 text-xs border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition">
            Download
          </button>
          <button onclick="window._deleteBackup('${backup.id}')" class="px-3 py-1.5 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition">
            Delete
          </button>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

// Global handlers for inline onclick (needed since modules don't expose to global scope)
window._downloadBackup = function(id) {
  const backup = state.backups.find(b => b.id === id);
  if (backup) {
    downloadJson(backup, `backup-${backup.id}.json`);
    showToast('Backup downloaded', 'success');
  }
};

window._deleteBackup = function(id) {
  state.backups = state.backups.filter(b => b.id !== id);
  try {
    const storageBackups = state.backups.map(b => {
      const copy = { ...b };
      delete copy.fullExport;
      return copy;
    });
    localStorage.setItem('mk-backups', JSON.stringify(storageBackups));
  } catch {}
  renderBackupList();
  showToast('Backup deleted', 'info');
};
