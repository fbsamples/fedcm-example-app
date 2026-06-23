// Copyright (c) Meta Platforms, Inc. and affiliates.
// All rights reserved.
//
// This source code is licensed under the license found in the
// LICENSE file in the root directory of this source tree.

// Mock google-auth-library before requiring the auth module so the
// `OAuth2Client` instance constructed at module load is the mock. The
// `_verifyIdToken` sidechannel lets each test configure the mock's return
// value without reaching into the auth module's private state.
jest.mock("google-auth-library", () => {
  const verifyIdToken = jest.fn();
  return {
    OAuth2Client: jest.fn(() => ({ verifyIdToken })),
    _verifyIdToken: verifyIdToken,
  };
});

const { _verifyIdToken: mockVerifyIdToken } = require("google-auth-library");
const {
  verifyToken,
  FACEBOOK_CONFIG_URL,
  GOOGLE_CONFIG_URL,
} = require("../auth");

beforeEach(() => {
  mockVerifyIdToken.mockReset();
  global.fetch = jest.fn();
});

afterEach(() => {
  delete global.fetch;
});

describe("verifyToken — Google", () => {
  test("returns a normalized profile when nonce and signature both verify", async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: "g-1",
        email: "alice@example.com",
        name: "Alice",
        picture: "https://example.com/p.jpg",
        nonce: "shared-nonce",
      }),
    });

    const profile = await verifyToken(GOOGLE_CONFIG_URL, "jwt", "shared-nonce");

    expect(profile).toEqual({
      provider: "google",
      providerId: "g-1",
      email: "alice@example.com",
      name: "Alice",
      picture: "https://example.com/p.jpg",
    });
  });

  test("rejects when the JWT nonce does not match the session nonce", async () => {
    // The whole point of the server-side nonce check — a forged or replayed
    // token whose `nonce` claim doesn't match the session is rejected even
    // though the JWT signature itself is valid.
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ sub: "g-1", nonce: "wrong" }),
    });

    await expect(
      verifyToken(GOOGLE_CONFIG_URL, "jwt", "expected"),
    ).rejects.toThrow(/nonce/i);
  });

  test("rejects when no expected nonce was supplied", async () => {
    // Defensive: an empty/undefined `expectedNonce` must not match a token
    // whose `nonce` claim is also empty. The guard prevents a session with
    // no nonce from accidentally accepting any token.
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ sub: "g-1", nonce: "" }),
    });

    await expect(
      verifyToken(GOOGLE_CONFIG_URL, "jwt", ""),
    ).rejects.toThrow(/nonce/i);
  });

  test("unwraps an OIDC envelope before calling verifyIdToken", async () => {
    // When the FedCM provider config requests `response_type: id_token` plus
    // OIDC scopes, Google returns `{ iss, id_token, ... }` instead of a bare
    // JWT. The verifier needs the inner `id_token`; this is the production
    // path for the Google flow.
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ sub: "g-1", nonce: "n" }),
    });

    const envelope = JSON.stringify({
      iss: "https://accounts.google.com",
      id_token: "real-jwt",
    });
    await verifyToken(GOOGLE_CONFIG_URL, envelope, "n");

    expect(mockVerifyIdToken).toHaveBeenCalledWith(
      expect.objectContaining({ idToken: "real-jwt" }),
    );
  });
});

describe("verifyToken — Facebook", () => {
  test("returns a normalized profile when Graph API responds 200", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "fb-1",
        name: "Alice",
        email: "alice@example.com",
        picture: { data: { url: "https://example.com/p.jpg" } },
      }),
    });

    const profile = await verifyToken(
      FACEBOOK_CONFIG_URL,
      "fb-token",
      "ignored",
    );

    expect(profile).toEqual({
      provider: "facebook",
      providerId: "fb-1",
      email: "alice@example.com",
      name: "Alice",
      picture: "https://example.com/p.jpg",
    });
  });

  test("surfaces the Graph API error message on non-200 responses", async () => {
    // FB returns structured errors in the body; `verifyFacebookToken`
    // forwards the message rather than swallowing it, which makes
    // misconfigurations debuggable from server logs.
    global.fetch.mockResolvedValue({
      ok: false,
      statusText: "Bad Request",
      json: async () => ({
        error: { message: "Invalid OAuth access token" },
      }),
    });

    await expect(
      verifyToken(FACEBOOK_CONFIG_URL, "bad-token", "ignored"),
    ).rejects.toThrow(/Invalid OAuth access token/);
  });
});

describe("verifyToken — routing", () => {
  test("rejects an unknown configURL", async () => {
    await expect(
      verifyToken("https://evil.example/config.json", "x", "n"),
    ).rejects.toThrow(/Unknown identity provider/);
  });
});
