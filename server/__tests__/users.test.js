// Copyright (c) Meta Platforms, Inc. and affiliates.
// All rights reserved.
//
// This source code is licensed under the license found in the
// LICENSE file in the root directory of this source tree.

const { findOrCreateUser, findUserById, _reset } = require("../users");

beforeEach(() => _reset());

const facebookProfile = {
  provider: "facebook",
  providerId: "fb-123",
  email: "alice@example.com",
  name: "Alice",
  picture: "https://example.com/alice.jpg",
};

const googleProfile = {
  provider: "google",
  providerId: "goog-456",
  email: "alice@example.com",
  name: "Alice G",
  picture: "https://example.com/alice-g.jpg",
};

describe("findOrCreateUser", () => {
  test("creates a new user with provider info", () => {
    const user = findOrCreateUser(facebookProfile);
    expect(user.id).toBe(1);
    expect(user.name).toBe("Alice");
    expect(user.email).toBe("alice@example.com");
    expect(user.providers.facebook).toEqual({
      id: "fb-123",
      email: "alice@example.com",
    });
  });

  test("returns existing user on same provider re-login", () => {
    const first = findOrCreateUser(facebookProfile);
    const second = findOrCreateUser(facebookProfile);
    expect(second.id).toBe(first.id);
  });

  test("updates name and picture on re-login", () => {
    findOrCreateUser(facebookProfile);
    const updated = findOrCreateUser({
      ...facebookProfile,
      name: "Alice Updated",
      picture: "https://example.com/new.jpg",
    });
    expect(updated.name).toBe("Alice Updated");
    expect(updated.picture).toBe("https://example.com/new.jpg");
  });

  test("links accounts with same email but different provider", () => {
    const fbUser = findOrCreateUser(facebookProfile);
    const gUser = findOrCreateUser(googleProfile);
    expect(gUser.id).toBe(fbUser.id);
    expect(gUser.providers.facebook).toBeDefined();
    expect(gUser.providers.google).toBeDefined();
  });

  test("creates separate users for different emails", () => {
    const user1 = findOrCreateUser(facebookProfile);
    const user2 = findOrCreateUser({
      ...googleProfile,
      email: "bob@example.com",
    });
    expect(user2.id).not.toBe(user1.id);
  });
});

describe("findUserById", () => {
  test("returns the user by ID", () => {
    const created = findOrCreateUser(facebookProfile);
    const found = findUserById(created.id);
    expect(found.id).toBe(created.id);
    expect(found.name).toBe("Alice");
  });

  test("returns undefined for unknown ID", () => {
    expect(findUserById(999)).toBeUndefined();
  });
});
