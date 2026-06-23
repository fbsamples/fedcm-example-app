// Copyright (c) Meta Platforms, Inc. and affiliates.
// All rights reserved.
//
// This source code is licensed under the license found in the
// LICENSE file in the root directory of this source tree.

const users = [];
let nextId = 1;

/**
 * Find or create a user from a verified provider profile.
 * Handles account linking: if a user already exists with the same email
 * but a different provider, the new provider is linked to the existing account.
 *
 * @param {Object} profile - Normalized profile from token verification.
 * @param {string} profile.provider - "facebook" or "google".
 * @param {string} profile.providerId - Provider-specific user ID.
 * @param {string} profile.email - User's email address.
 * @param {string} profile.name - Display name.
 * @param {string} profile.picture - Profile picture URL.
 * @returns {Object} The unified user object.
 */
function findOrCreateUser(profile) {
  const providerKey = `${profile.provider}:${profile.providerId}`;

  // Check if this exact provider account is already linked
  let user = users.find(
    (u) => u.providers[profile.provider]?.id === profile.providerId,
  );

  if (user) {
    // Update profile info from the latest login
    user.name = profile.name;
    user.picture = profile.picture;
    user.providers[profile.provider] = {
      id: profile.providerId,
      email: profile.email,
    };
    return sanitize(user);
  }

  // Check if a user with this email exists (account linking)
  user = users.find((u) => u.email === profile.email);

  if (user) {
    // Link new provider to existing account
    user.providers[profile.provider] = {
      id: profile.providerId,
      email: profile.email,
    };
    return sanitize(user);
  }

  // Create new user
  user = {
    id: nextId++,
    email: profile.email,
    name: profile.name,
    picture: profile.picture,
    providers: {
      [profile.provider]: {
        id: profile.providerId,
        email: profile.email,
      },
    },
  };
  users.push(user);
  return sanitize(user);
}

/**
 * Find a user by their internal ID.
 *
 * @param {number} id - Internal user ID.
 * @returns {Object|undefined} The user object, or undefined if not found.
 */
function findUserById(id) {
  const user = users.find((u) => u.id === id);
  return user ? sanitize(user) : undefined;
}

/**
 * Return a safe copy of the user object (no internal mutation).
 */
function sanitize(user) {
  return { ...user, providers: { ...user.providers } };
}

function _reset() {
  users.length = 0;
  nextId = 1;
}

module.exports = { findOrCreateUser, findUserById, _reset };
