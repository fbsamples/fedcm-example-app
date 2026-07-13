// Copyright (c) Meta Platforms, Inc. and affiliates.
// All rights reserved.
//
// This source code is licensed under the license found in the
// LICENSE file in the root directory of this source tree.

// The FB SDK loads asynchronously and calls `window.fbAsyncInit` once it's
// ready for `FB.init`. We expose that as a Promise so callers can await it
// before touching `FB.*`. Guarded so this file can also be `require()`d in
// Node (jest) to unit-test the pure helpers below.
if (typeof window !== "undefined") {
  window.fbSdkReady = new Promise((resolve) => {
    window.fbAsyncInit = function () {
      FB.init({ appId: window.__CONFIG__.FB_APP_ID, version: "v22.0" });
      resolve();
    };
  });
}

// Where Google's redirect fallback sends the browser back to. The id_token
// arrives in this page's URL fragment; see client/oauth-callback.html.
const GOOGLE_REDIRECT_PATH = "/oauth-callback.html";

/**
 * Check whether the browser supports the FedCM API.
 *
 * @returns {boolean} True if FedCM is available.
 */
function isFedCMSupported() {
  return (
    typeof window !== "undefined" &&
    "IdentityCredential" in window &&
    typeof navigator.credentials?.get === "function"
  );
}

/**
 * Fetch a server-bound nonce. The server stashes this in the session and
 * requires the IdP-returned token to carry the same value, which is what gives
 * the nonce its replay-protection meaning. Shared by the FedCM and redirect
 * paths.
 *
 * @returns {Promise<string>} The nonce.
 */
async function fetchNonce() {
  const res = await fetch("/auth/nonce");
  if (!res.ok) throw new Error("Failed to fetch nonce");
  const { nonce } = await res.json();
  return nonce;
}

/**
 * POST a provider credential to the server for verification.
 *
 * @param {string} configURL - The provider's FedCM configURL.
 * @param {string} token - The token/credential to verify.
 * @returns {Promise<Object>} The authenticated user.
 * @throws {Error} If verification fails.
 */
async function verifyWithServer(configURL, token) {
  const response = await fetch("/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ configURL, token }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Login failed");
  }
  const { user } = await response.json();
  return user;
}

/**
 * Classify a rejection from `navigator.credentials.get()` into a login result.
 *
 * FedCM deliberately does not tell the RP *why* it failed, for privacy: an
 * `AbortError` means a programmatic abort, but a `NotAllowedError` covers both
 * a user-gesture dismissal AND "no eligible accounts / not signed in to any
 * IdP". Because we cannot tell those apart, we treat `AbortError` as a silent
 * dismissal and everything else as `unavailable` so the caller can offer the
 * provider fallback instead of dead-ending.
 *
 * @param {Error} err
 * @returns {{status: string, error?: Error}}
 */
function classifyFedcmError(err) {
  if (err.name === "AbortError") return { status: "dismissed" };
  return { status: "unavailable", error: err };
}

/**
 * Build a FedCM provider config entry.
 *
 * @param {"google"|"facebook"} provider
 * @param {string} nonce
 * @returns {Object} A provider entry for `identity.providers`.
 */
function buildProviderConfig(provider, nonce) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CONFIG_URL } = window.__CONFIG__;
  if (provider === "google") {
    return {
      configURL: GOOGLE_CONFIG_URL,
      clientId: GOOGLE_CLIENT_ID,
      nonce,
      params: {
        nonce,
        response_type: "id_token",
        scope: "openid email profile",
      },
    };
  }
  // Facebook's provider entry comes from the FB SDK.
  return FB.FedCM.getProviderConfig({ scope: "public_profile,email", nonce });
}

/**
 * Take the credential the browser returned from FedCM, finish any
 * provider-specific handoff, and verify it server-side.
 *
 * @param {IdentityCredential} credential
 * @returns {Promise<{status: "success", user: Object}>}
 */
async function finishCredential(credential) {
  const { FACEBOOK_CONFIG_URL } = window.__CONFIG__;

  let configURL;
  let token;
  if (credential.configURL === FACEBOOK_CONFIG_URL) {
    // Hand the credential back to the SDK so it can finish the login flow and
    // give us a Graph-API access token.
    const result = FB.FedCM.processCredential(credential);
    if (result.status !== "success") {
      throw new Error(result.errorMessage || "Facebook login failed");
    }
    configURL = FACEBOOK_CONFIG_URL;
    token = result.authResponse.accessToken;
  } else {
    configURL = credential.configURL;
    token = credential.token; // Google: a JWT (or a JSON envelope wrapping one)
  }

  const user = await verifyWithServer(configURL, token);
  return { status: "success", user };
}

/**
 * Primary sign-in: a single, passive FedCM call listing BOTH providers so the
 * browser shows one unified account chooser. This is the sample's headline
 * flow and only surfaces accounts the user is already signed into at an IdP.
 *
 * @returns {Promise<{status: string, user?: Object}>} `status` is one of:
 *   "success" (with `user`), "dismissed" (user closed the dialog),
 *   "unavailable" (no eligible accounts / FedCM error), or "unsupported".
 */
async function loginWithFedCM() {
  if (!isFedCMSupported()) return { status: "unsupported" };

  // Wait until the FB SDK has loaded and `FB.init` has run before using any
  // `FB.*` APIs.
  await window.fbSdkReady;

  const nonce = await fetchNonce();
  const providers = [
    buildProviderConfig("google", nonce),
    buildProviderConfig("facebook", nonce),
  ];

  let credential;
  try {
    credential = await navigator.credentials.get({ identity: { providers } });
  } catch (err) {
    return classifyFedcmError(err);
  }

  if (!credential) return { status: "unavailable" };
  return finishCredential(credential);
}

/**
 * Fallback rung 1: a single-provider FedCM call in ACTIVE mode. Active mode is
 * gesture-triggered and, crucially, opens the IdP's own sign-in dialog when the
 * user is logged out — the behavior passive mode cannot provide. It is
 * single-provider oriented, which is why it lives in the per-provider fallback
 * rather than the unified primary call above.
 *
 * @param {"google"|"facebook"} provider
 * @returns {Promise<{status: string, user?: Object}>} Same shape as loginWithFedCM.
 */
async function loginWithProviderFedCM(provider) {
  if (!isFedCMSupported()) return { status: "unsupported" };

  await window.fbSdkReady;
  const nonce = await fetchNonce();

  let credential;
  try {
    credential = await navigator.credentials.get({
      identity: { providers: [buildProviderConfig(provider, nonce)] },
      mode: "active",
    });
  } catch (err) {
    return classifyFedcmError(err);
  }

  if (!credential) return { status: "unavailable" };
  return finishCredential(credential);
}

/**
 * Build the Google OAuth 2.0 implicit `id_token` authorization URL. Pure and
 * side-effect free so it can be unit-tested without a browser.
 *
 * @param {Object} params
 * @param {string} params.clientId
 * @param {string} params.redirectUri
 * @param {string} params.nonce
 * @param {string} params.state
 * @returns {string} The full authorization URL.
 */
function buildGoogleAuthUrl({ clientId, redirectUri, nonce, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "id_token",
    scope: "openid email profile",
    nonce,
    state,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Generate a random opaque value for OAuth `state` (CSRF protection). Uses the
 * Web Crypto API, available in the secure context FedCM already requires.
 *
 * @returns {string} A 32-char hex string.
 */
function randomState() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Fallback rung 2 (Google): a full-page OAuth 2.0 implicit redirect. Works even
 * without FedCM (any browser). The id_token comes back in the URL fragment at
 * GOOGLE_REDIRECT_PATH, where oauth-callback.html verifies it via /auth/verify.
 *
 * @param {string} [returnTo] - Path to return to after sign-in (default "/").
 * @returns {Promise<void>} Resolves as the navigation begins (rarely observed).
 */
async function startGoogleRedirect(returnTo) {
  const { GOOGLE_CLIENT_ID } = window.__CONFIG__;
  const nonce = await fetchNonce();
  const state = randomState();

  // `state` is validated on return; the server-bound `nonce` lives in the
  // session and is re-checked by /auth/verify.
  sessionStorage.setItem("googleOAuthState", state);
  if (returnTo) sessionStorage.setItem("googleOAuthReturnTo", returnTo);

  const redirectUri = window.location.origin + GOOGLE_REDIRECT_PATH;
  window.location.assign(
    buildGoogleAuthUrl({ clientId: GOOGLE_CLIENT_ID, redirectUri, nonce, state }),
  );
}

/**
 * Fallback rung 2 (Facebook): the SDK's own popup login, which prompts the user
 * to sign in to Facebook when they aren't already. Reuses the server's
 * Graph-API verify path.
 *
 * @returns {Promise<{status: string, user?: Object}>} Same shape as loginWithFedCM.
 */
async function loginWithFacebookSDK() {
  const { FACEBOOK_CONFIG_URL } = window.__CONFIG__;
  await window.fbSdkReady;

  const authResponse = await new Promise((resolve) => {
    FB.login(
      (response) =>
        resolve(response.status === "connected" ? response.authResponse : null),
      { scope: "public_profile,email" },
    );
  });

  if (!authResponse) return { status: "dismissed" };
  const user = await verifyWithServer(FACEBOOK_CONFIG_URL, authResponse.accessToken);
  return { status: "success", user };
}

/**
 * Check if there is an active session.
 *
 * @returns {Promise<Object|null>} The current user, or null if not logged in.
 */
async function getCurrentUser() {
  const response = await fetch("/auth/me");
  if (!response.ok) return null;
  const { user } = await response.json();
  return user;
}

/**
 * Log out the current user.
 *
 * @returns {Promise<void>}
 */
async function logout() {
  await fetch("/auth/logout", { method: "POST" });
}

// Exported for unit tests (see client/__tests__/auth.test.js). No-op in the
// browser, where these functions are used as globals.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildGoogleAuthUrl };
}
