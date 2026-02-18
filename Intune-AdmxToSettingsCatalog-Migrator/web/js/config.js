// Application configuration
// Uses the well-known Microsoft Graph PowerShell client ID so users
// can sign in without registering their own Azure app.

const APP_CONFIG = {
  clientId: '14d82eec-204b-4c2f-b7e8-296a70dab67e',
  redirectUri: window.location.origin + window.location.pathname,
  scopes: [
    'DeviceManagementConfiguration.ReadWrite.All',
    'Group.Read.All',
    'DeviceManagementRBAC.ReadWrite.All'
  ]
};
