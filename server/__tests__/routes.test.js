// Copyright (c) Meta Platforms, Inc. and affiliates.
// All rights reserved.
//
// This source code is licensed under the license found in the
// LICENSE file in the root directory of this source tree.

// Mock google-auth-library before requiring the app so the auth module's
// `OAuth2Client` instance is the mock. The `_verifyIdToken` sidechannel
// gives the verify-flow integration tests a way to configure return values.
jest.mock("google-auth-library", () => {
  const verifyIdToken = jest.fn();
  return {
    OAuth2Client: jest.fn(() => ({ verifyIdToken })),
    _verifyIdToken: verifyIdToken,
  };
});

const request = require("supertest");
const { _verifyIdToken: mockVerifyIdToken } = require("google-auth-library");
const { _reset: resetPalettes } = require("../palettes");
const { _reset: resetUsers } = require("../users");

// Set DEV_LOGIN before loading the app so the route is available
process.env.DEV_LOGIN = "true";
const app = require("../index");

const GOOGLE_CONFIG_URL = "https://accounts.google.com/gsi/fedcm.json";

beforeEach(() => {
  resetPalettes();
  resetUsers();
  mockVerifyIdToken.mockReset();
});

// Helper: create an authenticated agent with a session
async function loginAgent() {
  const agent = request.agent(app);
  await agent.post("/auth/dev-login");
  return agent;
}

// --- Auth routes ---

describe("POST /auth/dev-login", () => {
  test("creates a session and returns user", async () => {
    const res = await request(app).post("/auth/dev-login");
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: expect.any(Number),
      name: "Dev User",
    });
  });

  test("returns 404 when DEV_LOGIN is not set", async () => {
    const original = process.env.DEV_LOGIN;
    process.env.DEV_LOGIN = "false";
    const res = await request(app).post("/auth/dev-login");
    expect(res.status).toBe(404);
    process.env.DEV_LOGIN = original;
  });

  test("returns 404 in production even when DEV_LOGIN=true", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const res = await request(app).post("/auth/dev-login");
    expect(res.status).toBe(404);
    process.env.NODE_ENV = originalEnv;
  });
});

describe("GET /auth/nonce", () => {
  test("returns a hex nonce string", async () => {
    const res = await request(app).get("/auth/nonce");
    expect(res.status).toBe(200);
    expect(res.body.nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  test("returns a different nonce on each call", async () => {
    const a = await request(app).get("/auth/nonce");
    const b = await request(app).get("/auth/nonce");
    expect(a.body.nonce).not.toBe(b.body.nonce);
  });
});

describe("POST /auth/verify", () => {
  test("returns 400 when no nonce has been issued for the session", async () => {
    const res = await request(app)
      .post("/auth/verify")
      .send({ configURL: GOOGLE_CONFIG_URL, token: "x" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nonce/i);
  });

  test("consumes the session nonce on a failed verification", async () => {
    const agent = request.agent(app);
    await agent.get("/auth/nonce");
    // First attempt: nonce is present, verification fails on the bad token.
    const first = await agent
      .post("/auth/verify")
      .send({ configURL: GOOGLE_CONFIG_URL, token: "x" });
    expect(first.status).toBe(401);
    // Second attempt without a fresh nonce: rejected for missing nonce.
    const second = await agent
      .post("/auth/verify")
      .send({ configURL: GOOGLE_CONFIG_URL, token: "x" });
    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/nonce/i);
  });

  test("creates a session and returns the user on a successful Google verify", async () => {
    // Full happy path: client fetches a nonce, the IdP returns a token whose
    // `nonce` claim matches, and the server creates an authenticated session.
    // Subsequent /auth/me sees the user without re-verifying.
    const agent = request.agent(app);
    const { body: { nonce } } = await agent.get("/auth/nonce");

    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: "g-1",
        email: "alice@example.com",
        name: "Alice",
        picture: "https://example.com/p.jpg",
        nonce,
      }),
    });

    const verify = await agent
      .post("/auth/verify")
      .send({ configURL: GOOGLE_CONFIG_URL, token: "any-jwt" });

    expect(verify.status).toBe(200);
    expect(verify.body.user).toMatchObject({
      email: "alice@example.com",
      name: "Alice",
    });

    const me = await agent.get("/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("alice@example.com");
  });

  test("rejects an unknown configURL with 401", async () => {
    const agent = request.agent(app);
    await agent.get("/auth/nonce");

    const res = await agent
      .post("/auth/verify")
      .send({ configURL: "https://evil.example/config.json", token: "x" });

    expect(res.status).toBe(401);
  });
});

describe("GET /auth/me", () => {
  test("returns 401 when not authenticated", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });

  test("returns user when authenticated", async () => {
    const agent = await loginAgent();
    const res = await agent.get("/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe("Dev User");
  });
});

describe("POST /auth/logout", () => {
  test("destroys session", async () => {
    const agent = await loginAgent();
    await agent.post("/auth/logout");
    const res = await agent.get("/auth/me");
    expect(res.status).toBe(401);
  });
});

// --- Palette CRUD ---

describe("POST /api/palettes", () => {
  test("returns 401 when not authenticated", async () => {
    const res = await request(app)
      .post("/api/palettes")
      .send({ name: "Test", colors: ["#ff0000", "#00ff00"] });
    expect(res.status).toBe(401);
  });

  test("creates palette when authenticated", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/palettes")
      .send({ name: "My Palette", colors: ["#ff0000", "#00ff00", "#0000ff"] });
    expect(res.status).toBe(201);
    expect(res.body.palette).toMatchObject({
      name: "My Palette",
      colors: ["#ff0000", "#00ff00", "#0000ff"],
      likes: 0,
      likedByMe: false,
    });
  });

  test("rejects missing name", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/palettes")
      .send({ name: "", colors: ["#ff0000", "#00ff00"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  test("rejects too few colors", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/palettes")
      .send({ name: "Test", colors: ["#ff0000"] });
    expect(res.status).toBe(400);
  });

  test("rejects too many colors", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/palettes")
      .send({ name: "Test", colors: Array(7).fill("#ff0000") });
    expect(res.status).toBe(400);
  });

  test("rejects invalid hex colors", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/palettes")
      .send({ name: "Test", colors: ["not-a-color", "#00ff00"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/hex/i);
  });

  test("accepts uppercase hex colors", async () => {
    // The `#RRGGBB` regex is case-insensitive; both `#FF0000` and `#ff0000`
    // are valid CSS. A reader copying this sample should not have to learn
    // that the hard way.
    const agent = await loginAgent();
    const res = await agent
      .post("/api/palettes")
      .send({ name: "Caps", colors: ["#FF0000", "#00FF00"] });
    expect(res.status).toBe(201);
    expect(res.body.palette.colors).toEqual(["#FF0000", "#00FF00"]);
  });

  test("rejects 3-digit hex shorthand", async () => {
    // CSS allows `#fff` as shorthand for `#ffffff`, but the server only
    // accepts the 6-digit form so the stored value is always the same shape.
    const agent = await loginAgent();
    const res = await agent
      .post("/api/palettes")
      .send({ name: "Short", colors: ["#fff", "#000"] });
    expect(res.status).toBe(400);
  });

  test("trims whitespace and truncates names at 50 characters", async () => {
    // Two guarantees the server makes about palette names: leading/trailing
    // whitespace is stripped, and overlong names are silently truncated
    // rather than rejected. Both matter because the UI surfaces the stored
    // value back to the user.
    const agent = await loginAgent();
    const res = await agent
      .post("/api/palettes")
      .send({
        name: "  " + "x".repeat(100) + "  ",
        colors: ["#ff0000", "#00ff00"],
      });
    expect(res.status).toBe(201);
    expect(res.body.palette.name).toBe("x".repeat(50));
  });
});

describe("GET /api/palettes", () => {
  test("returns all palettes (public, no auth needed)", async () => {
    const agent = await loginAgent();
    await agent.post("/api/palettes").send({ name: "P1", colors: ["#ff0000", "#00ff00"] });
    await agent.post("/api/palettes").send({ name: "P2", colors: ["#0000ff", "#ffff00"] });

    const res = await request(app).get("/api/palettes");
    expect(res.status).toBe(200);
    expect(res.body.palettes).toHaveLength(2);
  });

  test("respects sort=oldest parameter", async () => {
    const agent = await loginAgent();
    const r1 = await agent.post("/api/palettes").send({ name: "First", colors: ["#ff0000", "#00ff00"] });
    const r2 = await agent.post("/api/palettes").send({ name: "Second", colors: ["#0000ff", "#ffff00"] });

    const res = await request(app).get("/api/palettes?sort=oldest");
    expect(res.body.palettes[0].name).toBe("First");
    expect(res.body.palettes[1].name).toBe("Second");
  });
});

describe("GET /api/palettes/mine", () => {
  test("returns 401 when not authenticated", async () => {
    const res = await request(app).get("/api/palettes/mine");
    expect(res.status).toBe(401);
  });

  test("returns only current user's palettes", async () => {
    const agent = await loginAgent();
    await agent.post("/api/palettes").send({ name: "Mine", colors: ["#ff0000", "#00ff00"] });

    const res = await agent.get("/api/palettes/mine");
    expect(res.status).toBe(200);
    expect(res.body.palettes).toHaveLength(1);
    expect(res.body.palettes[0].name).toBe("Mine");
  });
});

describe("DELETE /api/palettes/:id", () => {
  test("deletes own palette", async () => {
    const agent = await loginAgent();
    const created = await agent
      .post("/api/palettes")
      .send({ name: "ToDelete", colors: ["#ff0000", "#00ff00"] });
    const id = created.body.palette.id;

    const res = await agent.delete(`/api/palettes/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const after = await agent.get("/api/palettes/mine");
    expect(after.body.palettes).toHaveLength(0);
  });

  test("returns 401 when not authenticated", async () => {
    const res = await request(app).delete("/api/palettes/1");
    expect(res.status).toBe(401);
  });

  test("returns 404 for nonexistent palette", async () => {
    const agent = await loginAgent();
    const res = await agent.delete("/api/palettes/999");
    expect(res.status).toBe(404);
  });
});

// --- Likes ---

describe("POST /api/palettes/:id/like", () => {
  test("returns 401 when not authenticated", async () => {
    const res = await request(app).post("/api/palettes/1/like");
    expect(res.status).toBe(401);
  });

  test("toggles like on a palette", async () => {
    const agent = await loginAgent();
    const created = await agent
      .post("/api/palettes")
      .send({ name: "Likeable", colors: ["#ff0000", "#00ff00"] });
    const id = created.body.palette.id;

    // Like
    const like = await agent.post(`/api/palettes/${id}/like`);
    expect(like.status).toBe(200);
    expect(like.body.palette.likes).toBe(1);
    expect(like.body.palette.likedByMe).toBe(true);

    // Unlike
    const unlike = await agent.post(`/api/palettes/${id}/like`);
    expect(unlike.body.palette.likes).toBe(0);
    expect(unlike.body.palette.likedByMe).toBe(false);
  });

  test("returns 404 for nonexistent palette", async () => {
    const agent = await loginAgent();
    const res = await agent.post("/api/palettes/999/like");
    expect(res.status).toBe(404);
  });
});
