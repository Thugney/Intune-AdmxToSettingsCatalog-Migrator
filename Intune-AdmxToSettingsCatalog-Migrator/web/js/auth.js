// auth.js - MSAL.js authentication wrapper
// Uses popup-based interactive login with multi-tenant /organizations/ endpoint.
// Client ID and scopes come from config.js (loaded before this module).

let msalInstance = null;
let currentAccount = null;

export function initMsal() {
  const config = {
    auth: {
      clientId: APP_CONFIG.clientId,
      authority: 'https://login.microsoftonline.com/organizations',
      redirectUri: APP_CONFIG.redirectUri,
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
    scopes: APP_CONFIG.scopes,
    prompt: 'select_account'
  };

  try {
    const response = await msalInstance.loginPopup(loginRequest);
    currentAccount = response.account;
    return currentAccount;
  } catch (error) {
    if (error.errorCode === 'user_cancelled') {
      throw new Error('Sign-in was cancelled. Please try again.');
    }
    // If consent is needed, retry with consent prompt
    if (error.errorCode === 'interaction_required' || error.errorCode === 'consent_required') {
      const consentRequest = { scopes: APP_CONFIG.scopes, prompt: 'consent' };
      const response = await msalInstance.loginPopup(consentRequest);
      currentAccount = response.account;
      return currentAccount;
    }
    throw error;
  }
}

export async function getToken() {
  if (!msalInstance || !currentAccount) throw new Error('Not authenticated.');

  const tokenRequest = {
    scopes: APP_CONFIG.scopes,
    account: currentAccount
  };

  try {
    const response = await msalInstance.acquireTokenSilent(tokenRequest);
    return response.accessToken;
  } catch (error) {
    // If silent fails (token expired or consent needed), fall back to popup
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
