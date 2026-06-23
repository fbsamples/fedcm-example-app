// Copyright (c) Meta Platforms, Inc. and affiliates.
// All rights reserved.
//
// This source code is licensed under the license found in the
// LICENSE file in the root directory of this source tree.

const {
  createPalette,
  serializePalette,
  getAllPalettes,
  getUserPalettes,
  deletePalette,
  toggleLike,
  _reset,
} = require("../palettes");

beforeEach(() => _reset());

function makePalette(overrides = {}) {
  return createPalette({
    name: "Test Palette",
    colors: ["#ff0000", "#00ff00", "#0000ff"],
    userId: 1,
    userName: "Tester",
    userPicture: null,
    ...overrides,
  });
}

describe("createPalette", () => {
  test("returns palette with expected fields", () => {
    const p = makePalette();
    expect(p).toMatchObject({
      id: expect.any(Number),
      name: "Test Palette",
      colors: ["#ff0000", "#00ff00", "#0000ff"],
      userId: 1,
      createdAt: expect.any(Number),
    });
  });

  test("assigns incrementing IDs", () => {
    const p1 = makePalette();
    const p2 = makePalette({ name: "Second" });
    expect(p2.id).toBe(p1.id + 1);
  });
});

describe("serializePalette", () => {
  test("converts likedBy Set to likes count", () => {
    const p = makePalette();
    p.likedBy.add(10);
    p.likedBy.add(20);
    const serialized = serializePalette(p, 1);
    expect(serialized.likes).toBe(2);
    expect(serialized.likedBy).toBeUndefined();
  });

  test("sets likedByMe=true when current user has liked", () => {
    const p = makePalette();
    p.likedBy.add(1);
    expect(serializePalette(p, 1).likedByMe).toBe(true);
  });

  test("sets likedByMe=false when current user has not liked", () => {
    const p = makePalette();
    p.likedBy.add(99);
    expect(serializePalette(p, 1).likedByMe).toBe(false);
  });

  test("sets likedByMe=false for anonymous user (null)", () => {
    const p = makePalette();
    p.likedBy.add(1);
    expect(serializePalette(p, null).likedByMe).toBe(false);
  });
});

describe("getAllPalettes", () => {
  test("returns newest first by default", () => {
    const p1 = makePalette({ name: "First" });
    // Ensure different createdAt timestamps
    p1.createdAt = Date.now() - 1000;
    const p2 = makePalette({ name: "Second" });
    const result = getAllPalettes();
    expect(result[0].name).toBe("Second");
    expect(result[1].name).toBe("First");
  });

  test("sorts oldest first", () => {
    const p1 = makePalette({ name: "First" });
    p1.createdAt = Date.now() - 1000;
    makePalette({ name: "Second" });
    const result = getAllPalettes("oldest");
    expect(result[0].name).toBe("First");
    expect(result[1].name).toBe("Second");
  });

  test("sorts by most liked, then newest for ties", () => {
    const p1 = makePalette({ name: "No likes" });
    const p2 = makePalette({ name: "Two likes" });
    const p3 = makePalette({ name: "One like" });
    toggleLike(p2.id, 10);
    toggleLike(p2.id, 20);
    toggleLike(p3.id, 10);
    const result = getAllPalettes("most-liked");
    expect(result[0].name).toBe("Two likes");
    expect(result[1].name).toBe("One like");
    expect(result[2].name).toBe("No likes");
  });
});

describe("getUserPalettes", () => {
  test("returns only palettes for the given user", () => {
    makePalette({ name: "User1", userId: 1 });
    makePalette({ name: "User2", userId: 2 });
    makePalette({ name: "User1b", userId: 1 });
    const result = getUserPalettes(1);
    expect(result).toHaveLength(2);
    expect(result.every((p) => p.userId === 1)).toBe(true);
  });

  test("returns empty array for user with no palettes", () => {
    makePalette({ userId: 1 });
    expect(getUserPalettes(999)).toEqual([]);
  });
});

describe("toggleLike", () => {
  test("adds a like", () => {
    const p = makePalette();
    const result = toggleLike(p.id, 10);
    expect(result.likes).toBe(1);
    expect(result.likedByMe).toBe(true);
  });

  test("removes like on second call (toggle)", () => {
    const p = makePalette();
    toggleLike(p.id, 10);
    const result = toggleLike(p.id, 10);
    expect(result.likes).toBe(0);
    expect(result.likedByMe).toBe(false);
  });

  test("returns null for nonexistent palette", () => {
    expect(toggleLike(999, 1)).toBeNull();
  });
});

describe("deletePalette", () => {
  test("deletes palette when owner matches", () => {
    const p = makePalette({ userId: 1 });
    expect(deletePalette(p.id, 1)).toBe(true);
    expect(getAllPalettes()).toHaveLength(0);
  });

  test("returns false when user does not own palette", () => {
    const p = makePalette({ userId: 1 });
    expect(deletePalette(p.id, 2)).toBe(false);
    expect(getAllPalettes()).toHaveLength(1);
  });

  test("returns false for nonexistent palette", () => {
    expect(deletePalette(999, 1)).toBe(false);
  });
});
