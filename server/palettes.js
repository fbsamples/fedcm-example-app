// Copyright (c) Meta Platforms, Inc. and affiliates.
// All rights reserved.
//
// This source code is licensed under the license found in the
// LICENSE file in the root directory of this source tree.

const palettes = [];
let nextId = 1;

/**
 * Create a new palette.
 *
 * @param {Object} params
 * @param {string} params.name - Palette name.
 * @param {string[]} params.colors - Array of 2-6 hex color strings.
 * @param {number} params.userId - Owner's user ID.
 * @param {string} params.userName - Owner's display name.
 * @param {string} params.userPicture - Owner's avatar URL.
 * @returns {Object} The created palette.
 */
function createPalette({ name, colors, userId, userName, userPicture }) {
  const palette = {
    id: nextId++,
    name,
    colors,
    userId,
    userName,
    userPicture,
    createdAt: Date.now(),
    likedBy: new Set(),
  };
  palettes.push(palette);
  return palette;
}

/**
 * Serialize a palette for API responses.
 */
function serializePalette(palette, currentUserId) {
  return {
    id: palette.id,
    name: palette.name,
    colors: palette.colors,
    userId: palette.userId,
    userName: palette.userName,
    userPicture: palette.userPicture,
    createdAt: palette.createdAt,
    likes: palette.likedBy.size,
    likedByMe: currentUserId ? palette.likedBy.has(currentUserId) : false,
  };
}

/**
 * Get all palettes with optional sorting.
 *
 * @param {string} sort - Sort order: "newest", "oldest", or "most-liked".
 * @param {number|null} currentUserId - Current user ID for likedByMe flag.
 * @returns {Object[]} Sorted palettes.
 */
function getAllPalettes(sort = "newest", currentUserId = null) {
  const sorted = [...palettes];
  if (sort === "oldest") {
    sorted.sort((a, b) => a.createdAt - b.createdAt);
  } else if (sort === "most-liked") {
    sorted.sort((a, b) => b.likedBy.size - a.likedBy.size || b.createdAt - a.createdAt);
  } else {
    sorted.sort((a, b) => b.createdAt - a.createdAt);
  }
  return sorted.map((p) => serializePalette(p, currentUserId));
}

/**
 * Get all palettes belonging to a specific user, newest first.
 *
 * @param {number} userId - The user's ID.
 * @returns {Object[]} The user's palettes sorted by creation date descending.
 */
function getUserPalettes(userId) {
  return palettes
    .filter((p) => p.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((p) => serializePalette(p, userId));
}

/**
 * Toggle a like on a palette. Returns the updated palette or null if not found.
 */
function toggleLike(paletteId, userId) {
  const palette = palettes.find((p) => p.id === paletteId);
  if (!palette) return null;
  if (palette.likedBy.has(userId)) {
    palette.likedBy.delete(userId);
  } else {
    palette.likedBy.add(userId);
  }
  return serializePalette(palette, userId);
}

/**
 * Delete a palette by ID, only if it belongs to the given user.
 *
 * @param {number} id - Palette ID.
 * @param {number} userId - The requesting user's ID.
 * @returns {boolean} True if deleted, false if not found or not owned.
 */
function deletePalette(id, userId) {
  const index = palettes.findIndex(
    (p) => p.id === id && p.userId === userId,
  );
  if (index === -1) return false;
  palettes.splice(index, 1);
  return true;
}

function _reset() {
  palettes.length = 0;
  nextId = 1;
}

module.exports = { createPalette, serializePalette, getAllPalettes, getUserPalettes, deletePalette, toggleLike, _reset };
