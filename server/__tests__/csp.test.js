// Copyright (c) Meta Platforms, Inc. and affiliates.
// All rights reserved.
//
// This source code is licensed under the license found in the
// LICENSE file in the root directory of this source tree.

const express = require("express");
const request = require("supertest");
const { csp, buildPolicy, DEFAULT_DIRECTIVES } = require("../csp");

function makeApp(middleware) {
  const app = express();
  app.use(middleware);
  app.get("/", (_, res) => res.send("ok"));
  return app;
}

describe("buildPolicy", () => {
  test("renders a directive with no sources as just the name", () => {
    // `upgrade-insecure-requests` is the canonical no-sources directive — it
    // takes no value and gets serialized bare. Important to support so that
    // callers can extend the default list with directives like this.
    expect(buildPolicy({ "upgrade-insecure-requests": [] }))
      .toBe("upgrade-insecure-requests");
  });

  test("serializes the full default policy without errors", () => {
    // A regression smoke test for the actual policy this app ships with —
    // every directive should produce a valid `name source...` segment.
    const policy = buildPolicy(DEFAULT_DIRECTIVES);
    for (const name of Object.keys(DEFAULT_DIRECTIVES)) {
      expect(policy).toContain(name);
    }
  });
});

describe("csp middleware", () => {
  test("sets Content-Security-Policy with the default directives", async () => {
    const res = await request(makeApp(csp())).get("/");
    expect(res.headers["content-security-policy"]).toMatch(/default-src 'self'/);
    expect(res.headers["content-security-policy-report-only"]).toBeUndefined();
  });

  test("uses the Report-Only header when reportOnly=true", async () => {
    const res = await request(makeApp(csp({ reportOnly: true }))).get("/");
    expect(res.headers["content-security-policy"]).toBeUndefined();
    expect(res.headers["content-security-policy-report-only"])
      .toMatch(/default-src 'self'/);
  });

  test("respects caller-supplied directives", async () => {
    const res = await request(
      makeApp(csp({ directives: { "default-src": ["'none'"] } })),
    ).get("/");
    expect(res.headers["content-security-policy"]).toBe("default-src 'none'");
  });
});

describe("DEFAULT_DIRECTIVES", () => {
  // These are not implementation-detail assertions — they're the security
  // contract this sample ships with. If any of these origins disappears
  // from the policy, the FedCM flow breaks at runtime, and we want a test
  // failure before deploy rather than a console error after.
  test("connect-src allows the Facebook and Google IdP origins", () => {
    expect(DEFAULT_DIRECTIVES["connect-src"])
      .toEqual(expect.arrayContaining([
        "https://www.facebook.com",
        "https://accounts.google.com",
      ]));
  });

  test("script-src allows the CDNs the entry pages load from", () => {
    expect(DEFAULT_DIRECTIVES["script-src"])
      .toEqual(expect.arrayContaining([
        "https://unpkg.com",
        "https://cdn.jsdelivr.net",
        "https://connect.facebook.net",
      ]));
  });

  test("locks framing and plugin loading", () => {
    // `frame-ancestors 'none'` blocks clickjacking; `object-src 'none'`
    // blocks legacy plugin-based XSS vectors. Both are part of the
    // baseline this sample is meant to demonstrate.
    expect(DEFAULT_DIRECTIVES["frame-ancestors"]).toEqual(["'none'"]);
    expect(DEFAULT_DIRECTIVES["object-src"]).toEqual(["'none'"]);
  });
});
