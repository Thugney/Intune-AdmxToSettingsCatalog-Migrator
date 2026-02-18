// Application configuration
// Run Register-App.ps1 once to create the Entra ID app, then paste the
// Client ID into the web app on first use. It is saved in localStorage.

const APP_CONFIG = {
  clientId: localStorage.getItem('mk-client-id') || '',
  redirectUri: window.location.origin + window.location.pathname,
  scopes: [
    'DeviceManagementConfiguration.ReadWrite.All',
    'Group.Read.All',
    'DeviceManagementRBAC.ReadWrite.All'
  ]
};

APP_CONFIG.isConfigured = function () {
  return this.clientId && this.clientId.length > 10;
};

APP_CONFIG.setClientId = function (id) {
  this.clientId = id;
  localStorage.setItem('mk-client-id', id);
};
