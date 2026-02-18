// auth.js - MSAL.js authentication wrapper
// Uses popup-based interactive login for browser SPA

const AUTH_SCOPES = [
  'DeviceManagementConfiguration.Read.All',
  'DeviceManagementConfiguration.ReadWrite.All'
];

let msalInstance = null;
let currentAccount = null;

export function initMsal(tenantId, clientId) {
  const config = {
    auth: {
      clientId: clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri: window.location.origin + window.location.pathname,
    },
    cache: {
      cacheLocation: 'sessionStorage',
      storeAuthStateInCookie: false
    }
  };

  msalInstance = new msal.PublicClientApplication(config);

  // Check if user is already signed in
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length > 0) {
    currentAccount = accounts[0];
  }

  return { msalInstance, currentAccount };
}

export async function login() {
  if (!msalInstance) throw new Error('MSAL not initialized. Call initMsal first.');

  const loginRequest = {
    scopes: AUTH_SCOPES
  };

  try {
    const response = await msalInstance.loginPopup(loginRequest);
    currentAccount = response.account;
    return currentAccount;
  } catch (error) {
    if (error.errorCode === 'user_cancelled') {
      throw new Error('Sign-in was cancelled. Please try again.');
    }
    throw error;
  }
}

export async function getToken() {
  if (!msalInstance || !currentAccount) throw new Error('Not authenticated.');

  const tokenRequest = {
    scopes: AUTH_SCOPES,
    account: currentAccount
  };

  try {
    // Try silent token acquisition first
    const response = await msalInstance.acquireTokenSilent(tokenRequest);
    return response.accessToken;
  } catch (error) {
    // If silent fails (token expired), fall back to popup
    try {
      const response = await msalInstance.acquireTokenPopup(tokenRequest);
      return response.accessToken;
    } catch (popupError) {
      throw new Error('Failed to acquire token: ' + popupError.message);
    }
  }
}

export function logout() {
  if (msalInstance) {
    msalInstance.logoutPopup();
  }
  currentAccount = null;
}

export function getAccount() {
  return currentAccount;
}

export function isAuthenticated() {
  return currentAccount !== null;
}
