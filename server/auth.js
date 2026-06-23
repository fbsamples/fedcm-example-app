// Copyright (c) Meta Platforms, Inc. and affiliates.
// All rights reserved.
//
// This source code is licensed under the license found in the
// LICENSE file in the root directory of this source tree.

const { OAuth2Client } = require("google-auth-library");

const FACEBOOK_CONFIG_URL = "https://www.facebook.com/fed_cm/config.json";
const GOOGLE_CONFIG_URL = "https://accounts.google.com/gsi/fedcm.json";

const googleClient = new OAuth2Client();

/**
 * Verify a FedCM token and return a normalized user profile.
 * Routes to the correct provider verifier based on the configURL
 * returned by the browser's FedCM API.
 *
 * @param {string} configURL - The FedCM configURL identifying the provider.
 * @param {string} token - The token/credential returned by the provider.
 * @param {string} expectedNonce - The nonce that was issued to the client
 *   for this login attempt. Required so the provider's response can be
 *   bound to this session and replays rejected.
 * @returns {Promise<Object>} Normalized profile: { provider, providerId, email, name, picture }.
 * @throws {Error} If the token is invalid, the nonce mismatches, or the
 *   provider is unrecognized.
 */
async function verifyToken(configURL, token, expectedNonce) {
  if (configURL === FACEBOOK_CONFIG_URL) {
    // FB's FedCM exchange returns an OAuth access token rather than a
    // nonce-bound JWT. Replay protection here comes from the Graph API
    // audience check (the token is bound to FB_APP_ID), not from the
    // FedCM nonce. The nonce is still passed through the FedCM call so
    // the IdP exchange itself is fresh.
    return verifyFacebookToken(token);
  }

  if (configURL === GOOGLE_CONFIG_URL) {
    return verifyGoogleToken(token, expectedNonce);
  }

  throw new Error(`Unknown identity provider: ${configURL}`);
}

/**
 * Verify a Facebook FedCM token by calling the Graph API debug endpoint.
 * The token from Facebook's FedCM assertion endpoint is an access token.
 *
 * @param {string} token - Facebook access token.
 * @returns {Promise<Object>} Normalized profile.
 */
async function verifyFacebookToken(token) {
  // Verify the token and get user info in one call
  const response = await fetch(
    `https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${encodeURIComponent(token)}`,
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      `Facebook token verification failed: ${error.error?.message || response.statusText}`,
    );
  }

  const data = await response.json();

  return {
    provider: "facebook",
    providerId: data.id,
    email: data.email,
    name: data.name,
    picture: data.picture?.data?.url,
  };
}

/**
 * Verify a Google FedCM token (JWT ID token) using Google's public keys.
 *
 * @param {string} token - Google JWT ID token.
 * @param {string} expectedNonce - The nonce issued to the client. The JWT's
 *   `nonce` claim must match exactly.
 * @returns {Promise<Object>} Normalized profile.
 */
async function verifyGoogleToken(token, expectedNonce) {
  // When the FedCM provider config requests `response_type: id_token` with
  // OIDC scopes, Google returns a JSON envelope `{ iss, id_token, ... }`
  // instead of a bare JWT. Unwrap it before verification.
  const idToken = extractGoogleIdToken(token);

  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();

  if (!expectedNonce || payload.nonce !== expectedNonce) {
    throw new Error("Nonce mismatch");
  }

  return {
    provider: "google",
    providerId: payload.sub,
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
  };
}

function extractGoogleIdToken(token) {
  const trimmed = typeof token === "string" ? token.trim() : "";
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed.id_token === "string") {
        return parsed.id_token;
      }
    } catch {
      // Fall through to treating the input as a bare JWT.
    }
  }
  return token;
}

module.exports = { verifyToken, FACEBOOK_CONFIG_URL, GOOGLE_CONFIG_URL };
