// Copyright (c) Meta Platforms, Inc. and affiliates.
// All rights reserved.
//
// This source code is licensed under the license found in the
// LICENSE file in the root directory of this source tree.

// The FB SDK loads asynchronously and calls `window.fbAsyncInit` once it's
// ready for `FB.init`. We expose that as a Promise so callers can await it
// before touching `FB.*`.
window.fbSdkReady = new Promise((resolve) => {
  window.fbAsyncInit = function () {
    FB.init({ appId: window.__CONFIG__.FB_APP_ID, version: "v22.0" });
    resolve();
  };
});

/**
 * Check whether the browser supports the FedCM API.
 *
 * @returns {boolean} True if FedCM is available.
 */
function isFedCMSupported() {
  return (
    "IdentityCredential" in window &&
    typeof navigator.credentials?.get === "function"
  );
}

/**
 * Initiate a FedCM login flow with both Facebook and Google as providers.
 * The browser displays a unified account chooser showing accounts from
 * both providers. The user picks one, and we send the resulting token
 * to our server for verification.
 *
 * @returns {Promise<Object|null>} The authenticated user object, or `null`
 *   if the user dismissed the FedCM dialog.
 * @throws {Error} If the browser rejects for a non-cancellation reason or
 *   server-side verification fails.
 */
async function loginWithFedCM() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CONFIG_URL, FACEBOOK_CONFIG_URL } = window.__CONFIG__;

  // Wait until the FB SDK has loaded and `FB.init` has run before using any
  // `FB.*` APIs.
  await window.fbSdkReady;

  // Fetch a server-bound nonce. The server stashes this in the session and
  // requires the IdP-returned token to carry the same value, which is what
  // gives the nonce its replay-protection meaning.
  const nonceRes = await fetch("/auth/nonce");
  if (!nonceRes.ok) throw new Error("Failed to fetch nonce");
  const { nonce } = await nonceRes.json();

  const fbProvider = FB.FedCM.getProviderConfig({
    scope: "public_profile,email",
    nonce,
  });

  const googleProvider = {
    configURL: GOOGLE_CONFIG_URL,
    clientId: GOOGLE_CLIENT_ID,
    nonce,
    params: {
      nonce,
      response_type: "id_token",
      scope: "openid email profile",
    },
  };

  // Browsers signal user cancellation as NotAllowedError; AbortError covers
  // programmatic abort. Both should be silent — the user already knows they
  // dismissed the dialog.
  let credential;
  try {
    credential = await navigator.credentials.get({
      identity: {
        providers: [googleProvider, fbProvider],
      },
    });
  } catch (err) {
    if (err.name === "NotAllowedError" || err.name === "AbortError") {
      return null;
    }
    throw err;
  }

  // Route the response based on which IdP the user selected. For Facebook,
  // hand the credential back to the SDK so it can finish the login flow and
  // give us a Graph-API access token.
  let configURL;
  let token;
  if (credential.configURL === FACEBOOK_CONFIG_URL) {
    const result = FB.FedCM.processCredential(credential);
    if (result.status !== "success") {
      throw new Error(result.errorMessage || "Facebook login failed");
    }
    configURL = FACEBOOK_CONFIG_URL;
    token = result.authResponse.accessToken;
  } else {
    configURL = credential.configURL;
    token = credential.token;
  }

  const response = await fetch("/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ configURL, token }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Login failed");
  }

  const { user } = await response.json();
  return user;
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
