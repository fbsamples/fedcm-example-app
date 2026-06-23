// Copyright (c) Meta Platforms, Inc. and affiliates.
// All rights reserved.
//
// This source code is licensed under the license found in the
// LICENSE file in the root directory of this source tree.

async function fetchPalettes(sort = "newest") {
  const res = await fetch(`/api/palettes?sort=${sort}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.palettes;
}

async function fetchMyPalettes() {
  const res = await fetch("/api/palettes/mine");
  if (!res.ok) return null;
  const data = await res.json();
  return data.palettes;
}

async function savePalette(name, colors) {
  const res = await fetch("/api/palettes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, colors }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Failed to save");
  }
  return data.palette;
}

async function deletePaletteById(id) {
  const res = await fetch(`/api/palettes/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error("Failed to delete palette");
  }
  return true;
}

async function toggleLikePalette(id) {
  const res = await fetch(`/api/palettes/${id}/like`, { method: "POST" });
  if (!res.ok) return null;
  const data = await res.json();
  return data.palette;
}
