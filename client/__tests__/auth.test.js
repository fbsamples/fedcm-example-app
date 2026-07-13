// Copyright (c) Meta Platforms, Inc. and affiliates.
// All rights reserved.
//
// This source code is licensed under the license found in the
// LICENSE file in the root directory of this source tree.

const { buildGoogleAuthUrl } = require("../auth");

describe("buildGoogleAuthUrl", () => {
  const base = {
    clientId: "client-123.apps.googleusercontent.com",
    redirectUri: "https://localhost:3000/oauth-callback.html",
    nonce: "nonce-abc",
    state: "state-xyz",
  };

  function paramsOf(url) {
    return new URL(url).searchParams;
  }

  test("targets Google's OAuth 2.0 authorization endpoint", () => {
    const url = new URL(buildGoogleAuthUrl(base));
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
  });

  test("requests an id_token with OIDC scopes", () => {
    const params = paramsOf(buildGoogleAuthUrl(base));
    expect(params.get("response_type")).toBe("id_token");
    expect(params.get("scope")).toBe("openid email profile");
    expect(params.get("prompt")).toBe("select_account");
  });

  test("passes client id and redirect uri through", () => {
    const params = paramsOf(buildGoogleAuthUrl(base));
    expect(params.get("client_id")).toBe(base.clientId);
    expect(params.get("redirect_uri")).toBe(base.redirectUri);
  });

  test("binds nonce and state (URL-encoded)", () => {
    const params = paramsOf(
      buildGoogleAuthUrl({ ...base, nonce: "a b/c", state: "x&y" }),
    );
    // URLSearchParams round-trips the raw values; encoding is handled for us.
    expect(params.get("nonce")).toBe("a b/c");
    expect(params.get("state")).toBe("x&y");
    // And the serialized string must be properly escaped.
    const raw = buildGoogleAuthUrl({ ...base, state: "x&y" });
    expect(raw).toContain("state=x%26y");
  });
});
