// Application configuration
// The Client ID can be set here OR entered via the web UI on first use.
// When entered via the UI, it is saved in localStorage and used automatically.
//
// Your app registration needs:
//   - Supported account types: Accounts in any organizational directory (multi-tenant)
//   - Platform: Single-page application (SPA)
//   - Redirect URI: Your hosting URL (e.g. https://admintemplate.intunestuff.com)
//   - Delegated permissions:
//       DeviceManagementConfiguration.ReadWrite.All
//       Group.Read.All
//       DeviceManagementRBAC.ReadWrite.All

const APP_CONFIG = {
  // Check localStorage first, then fall back to hardcoded value
  clientId: localStorage.getItem('mk-client-id') || 'YOUR_CLIENT_ID_HERE',
  redirectUri: window.location.origin + window.location.pathname,
  scopes: [
    'DeviceManagementConfiguration.ReadWrite.All',
    'Group.Read.All',
    'DeviceManagementRBAC.ReadWrite.All'
  ]
};

// Helper to check if Client ID is configured
APP_CONFIG.isConfigured = function() {
  return this.clientId && this.clientId !== 'YOUR_CLIENT_ID_HERE' && this.clientId.length > 10;
};

// Helper to save Client ID
APP_CONFIG.setClientId = function(id) {
  this.clientId = id;
  localStorage.setItem('mk-client-id', id);
};
