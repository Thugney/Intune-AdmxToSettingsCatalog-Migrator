// Application configuration
// Set your multi-tenant Entra app registration Client ID here once.
// End users do NOT need to create their own app registration.
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
  clientId: 'YOUR_CLIENT_ID_HERE',
  redirectUri: window.location.origin + window.location.pathname,
  scopes: [
    'DeviceManagementConfiguration.ReadWrite.All',
    'Group.Read.All',
    'DeviceManagementRBAC.ReadWrite.All'
  ]
};
