// app.js - Main application controller, navigation, state, and UI utilities
import { initMsal, login, logout, getAccount, isAuthenticated } from './auth.js';
import { setApiVersion } from './graph.js';

// ==================== APP STATE ====================
export const state = {
  exportData: null,      // Array of exported ADMX policies
  duplicateReport: null,  // Duplicate analysis results
  mappingSuggestions: null, // Mapping suggestion data
  mappingEntries: null,   // Curated mapping entries
  manifest: null,         // Migration manifest
  backups: [],            // Backup snapshots (stored in localStorage)
  currentPage: 'dashboard'
};

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
  // Restore state from sessionStorage
  try {
    const saved = sessionStorage.getItem('mk-app-state');
    if (saved) {
      const parsed = JSON.parse(saved);
      Object.assign(state, parsed);
    }
  } catch {}

  // Restore backups from localStorage
  try {
    const backups = localStorage.getItem('mk-backups');
    if (backups) state.backups = JSON.parse(backups);
  } catch {}

  // Login button
  document.getElementById('btn-login').addEventListener('click', handleLogin);
  document.getElementById('btn-logout').addEventListener('click', handleLogout);

  // Navigation
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });

  // Landing page setup
  initLandingPage();
});

async function handleLogin() {
  const tenantId = document.getElementById('login-tenant').value.trim();
  const clientId = document.getElementById('login-client').value.trim();

  if (!tenantId || !clientId) {
    showToast('Please enter both Tenant ID and Client ID', 'error');
    return;
  }

  // Validate GUID format
  const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!guidRegex.test(tenantId)) {
    showToast('Tenant ID must be a valid GUID', 'error');
    return;
  }
  if (!guidRegex.test(clientId)) {
    showToast('Client ID must be a valid GUID', 'error');
    return;
  }

  const btn = document.getElementById('btn-login');
  btn.disabled = true;
  btn.innerHTML = '<svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Signing in...';

  try {
    // Save credentials for session
    sessionStorage.setItem('mk-tenant', tenantId);
    sessionStorage.setItem('mk-client', clientId);

    initMsal(tenantId, clientId);
    await login();

    const account = getAccount();
    showApp(account, tenantId);
    showToast('Signed in successfully', 'success');
  } catch (error) {
    showToast('Sign-in failed: ' + error.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"/></svg> Sign in with Microsoft';
  }
}

function handleLogout() {
  logout();
  sessionStorage.clear();
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('login-screen').classList.add('hidden');
  const landing = document.getElementById('landing-page');
  if (landing) {
    landing.classList.remove('hidden');
    window.scrollTo(0, 0);
  } else {
    document.getElementById('login-screen').classList.remove('hidden');
  }
}

function showApp(account, tenantId) {
  document.getElementById('landing-page')?.classList.add('hidden');
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');

  // Set user info in sidebar
  const name = account.name || account.username || 'User';
  document.getElementById('user-name').textContent = name;
  document.getElementById('user-email').textContent = account.username || '';
  document.getElementById('user-avatar').textContent = name.charAt(0).toUpperCase();
  document.getElementById('sidebar-tenant').textContent = tenantId.substring(0, 8) + '...';

  setApiVersion('beta');
  document.getElementById('api-badge').textContent = 'API: beta';

  navigateTo('dashboard');
}

// ==================== NAVIGATION ====================
export function navigateTo(page) {
  state.currentPage = page;

  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  // Show target page
  const target = document.getElementById(`page-${page}`);
  if (target) target.classList.remove('hidden');

  // Update nav active state
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  // Update header
  const titles = {
    dashboard: ['Dashboard', 'Overview of your Intune ADMX policies'],
    export: ['Export Policies', 'Export ADMX policies from your Intune tenant'],
    duplicates: ['Duplicate Detector', 'Find duplicate and conflicting settings across policies'],
    mapping: ['Settings Mapping', 'Map ADMX settings to Settings Catalog equivalents'],
    migration: ['Migrate', 'Create Settings Catalog policies from your mapping'],
    backup: ['Backup & Restore', 'Manage policy snapshots']
  };

  const [title, subtitle] = titles[page] || ['Page', ''];
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-subtitle').textContent = subtitle;

  // Dispatch page-loaded event for modules to react
  window.dispatchEvent(new CustomEvent('page-loaded', { detail: { page } }));
}

// ==================== UI UTILITIES ====================
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const colors = {
    success: 'bg-green-600',
    error: 'bg-red-600',
    warning: 'bg-amber-500',
    info: 'bg-brand-600'
  };
  const icons = {
    success: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>',
    error: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>',
    warning: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>',
    info: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>'
  };

  const toast = document.createElement('div');
  toast.className = `toast ${colors[type]} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3`;
  toast.innerHTML = `
    <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">${icons[type]}</svg>
    <span class="text-sm">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

export function confirm(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    modal.classList.remove('hidden');

    const ok = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel');

    function cleanup() {
      modal.classList.add('hidden');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
    }

    function onOk() { cleanup(); resolve(true); }
    function onCancel() { cleanup(); resolve(false); }

    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
  });
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function saveState() {
  try {
    sessionStorage.setItem('mk-app-state', JSON.stringify(state));
  } catch {}
}

export function saveBackups() {
  try {
    localStorage.setItem('mk-backups', JSON.stringify(state.backups));
  } catch {}
}

export function logLine(containerId, message, level = 'info') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const ts = new Date().toISOString().replace('T', ' ').substring(0, 23) + 'Z';
  const colors = { info: 'text-green-400', warn: 'text-yellow-400', error: 'text-red-400' };
  const line = document.createElement('div');
  line.className = colors[level] || 'text-green-400';
  line.textContent = `${ts} [${level.toUpperCase()}] ${message}`;
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
}

// ==================== LANDING PAGE ====================
function initLandingPage() {
  const landing = document.getElementById('landing-page');
  if (!landing) return;

  // "Get Started" buttons -> show login screen
  document.querySelectorAll('.landing-cta, #nav-get-started, #hero-get-started, #cta-get-started').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      showLoginScreen();
    });
  });

  // "Back to home" button on login screen
  const backBtn = document.getElementById('back-to-landing');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      document.getElementById('login-screen').classList.add('hidden');
      landing.classList.remove('hidden');
      landing.classList.add('screen-fade-in');
    });
  }

  // Mobile menu toggle
  const mobileBtn = document.getElementById('mobile-menu-btn');
  const mobileMenu = document.getElementById('mobile-menu');
  if (mobileBtn && mobileMenu) {
    mobileBtn.addEventListener('click', () => {
      mobileMenu.classList.toggle('hidden');
    });
  }

  // Nav background on scroll
  const nav = document.getElementById('landing-nav');
  if (nav) {
    window.addEventListener('scroll', () => {
      nav.classList.toggle('scrolled', window.scrollY > 40);
    });
  }

  // Feature cards intersection observer (staggered reveal)
  const featureCards = document.querySelectorAll('.feature-card');
  if (featureCards.length > 0 && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          // Stagger the animation
          const idx = Array.from(featureCards).indexOf(entry.target);
          setTimeout(() => {
            entry.target.classList.add('visible');
          }, idx * 100);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });

    featureCards.forEach(card => observer.observe(card));
  }

  // Smooth scroll for anchor links
  landing.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const target = document.querySelector(link.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Close mobile menu if open
        if (mobileMenu) mobileMenu.classList.add('hidden');
      }
    });
  });
}

function showLoginScreen() {
  const landing = document.getElementById('landing-page');
  const login = document.getElementById('login-screen');

  landing.classList.add('screen-fade-out');
  setTimeout(() => {
    landing.classList.add('hidden');
    landing.classList.remove('screen-fade-out');
    login.classList.remove('hidden');
    login.classList.add('screen-fade-in');
    setTimeout(() => login.classList.remove('screen-fade-in'), 300);
  }, 300);
}
