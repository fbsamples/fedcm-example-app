// Copyright (c) Meta Platforms, Inc. and affiliates.
// All rights reserved.
//
// This source code is licensed under the license found in the
// LICENSE file in the root directory of this source tree.

require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const fs = require("fs");
const https = require("https");
const path = require("path");
const { verifyToken, FACEBOOK_CONFIG_URL, GOOGLE_CONFIG_URL } = require("./auth");
const { csp } = require("./csp");
const { findOrCreateUser, findUserById } = require("./users");
const {
  createPalette,
  serializePalette,
  getAllPalettes,
  getUserPalettes,
  deletePalette,
  toggleLike,
} = require("./palettes");

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === "production";

// `/auth/dev-login` is a no-auth bypass; it must never be reachable in
// production, regardless of how DEV_LOGIN got set. Both env vars are
// re-read on every request so the gate cannot be subverted by mutating
// `process.env` after boot.
const devLoginEnabled = () =>
  process.env.DEV_LOGIN === "true" && process.env.NODE_ENV !== "production";

if (devLoginEnabled()) {
  console.warn(
    "WARNING: /auth/dev-login is enabled. Never set DEV_LOGIN=true in production.",
  );
}

// SESSION_SECRET is required in production. In dev, fall back to a
// per-process random value so nobody ships the documented default.
const sessionSecret = (() => {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (isProduction) {
    throw new Error("SESSION_SECRET is required in production");
  }
  console.warn(
    "WARNING: SESSION_SECRET is not set. Using an ephemeral random value for this process.",
  );
  return crypto.randomBytes(32).toString("hex");
})();

// Honor X-Forwarded-Proto from a single upstream proxy so req.secure is true
// when TLS is terminated upstream.
app.set("trust proxy", 1);

app.use(express.json());

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// Force HTTPS for any host. Any non-secure request is 301-redirected to the
// same URL on https://. Once a client has loaded the app over HTTPS, the HSTS
// header tells the browser to refuse plain HTTP for a year. Active in
// production (e.g. Heroku, where the platform terminates TLS and forwards
// X-Forwarded-Proto) and in local HTTPS dev. Skipped for plain-HTTP dev and
// tests so they don't redirect-loop.
const enforceHttps = process.env.HTTPS === "true" || isProduction;
if (enforceHttps) {
  app.use((req, res, next) => {
    if (!req.secure) {
      return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    }
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
    next();
  });
}
app.use(csp());

app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction || process.env.HTTPS === "true",
      sameSite: "lax",
      httpOnly: true,
    },
  }),
);

// Inject env vars into client pages so the HTML can reference app IDs
// without hardcoding them.
app.get("/config.js", (req, res) => {
  res.type("application/javascript");
  res.send(
    `window.__CONFIG__ = ${JSON.stringify({
      FB_APP_ID: process.env.FB_APP_ID,
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      DEV_LOGIN: process.env.DEV_LOGIN === "true",
      FACEBOOK_CONFIG_URL,
      GOOGLE_CONFIG_URL,
    })};`,
  );
});

// Serve static client files
app.use(express.static(path.join(__dirname, "..", "client")));

// --- Auth routes ---

/**
 * POST /auth/dev-login
 * Dev-only route that creates a mock session without real authentication.
 * Gated on DEV_LOGIN=true AND NODE_ENV !== "production". The double gate
 * ensures the bypass cannot be enabled in a production deploy even if the
 * env var leaks in.
 */
app.post("/auth/dev-login", (req, res) => {
  if (!devLoginEnabled()) {
    return res.status(404).json({ error: "Not found" });
  }

  const profile = {
    provider: "dev",
    providerId: "dev-1",
    email: "dev@localhost",
    name: "Dev User",
    picture: null,
  };

  const user = findOrCreateUser(profile);
  req.session.userId = user.id;
  return res.json({ user });
});

/**
 * GET /auth/nonce
 * Mint a fresh nonce for an upcoming FedCM call and bind it to the session.
 * The client passes this same value to every IdP in the FedCM request, and
 * `/auth/verify` requires it to match the `nonce` claim in the returned JWT.
 * This is the standard OIDC nonce flow — without server-side binding, a
 * client-generated nonce provides no replay protection.
 */
app.get("/auth/nonce", (req, res) => {
  const nonce = crypto.randomBytes(16).toString("hex");
  req.session.fedcmNonce = nonce;
  return res.json({ nonce });
});

/**
 * POST /auth/verify
 * Accepts a FedCM credential (configURL + token), verifies it server-side,
 * and creates or links a user account.
 */
app.post("/auth/verify", async (req, res) => {
  const { configURL, token } = req.body;

  if (!configURL || !token) {
    return res.status(400).json({ error: "Missing configURL or token" });
  }

  // One-shot: clear the session nonce before verifying. Even if verification
  // fails, the nonce is consumed so a captured token can't be replayed.
  const expectedNonce = req.session.fedcmNonce;
  delete req.session.fedcmNonce;

  if (!expectedNonce) {
    return res.status(400).json({ error: "Missing nonce — call /auth/nonce first" });
  }

  try {
    const profile = await verifyToken(configURL, token, expectedNonce);
    const user = findOrCreateUser(profile);
    req.session.userId = user.id;
    return res.json({ user });
  } catch (error) {
    console.error("Token verification failed:", error.message);
    return res.status(401).json({ error: "Token verification failed" });
  }
});

/**
 * GET /auth/me
 * Returns the current logged-in user, or 401 if not authenticated.
 */
app.get("/auth/me", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const user = findUserById(req.session.userId);
  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }

  return res.json({ user });
});

/**
 * POST /auth/logout
 * Destroys the session.
 */
app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// --- Palette routes ---

/**
 * GET /api/palettes
 * Returns all palettes. Supports ?sort=newest|oldest|most-liked.
 */
app.get("/api/palettes", (req, res) => {
  const sort = req.query.sort || "newest";
  return res.json({ palettes: getAllPalettes(sort, req.session.userId || null) });
});

/**
 * GET /api/palettes/mine
 * Returns palettes belonging to the current user.
 */
app.get("/api/palettes/mine", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  return res.json({ palettes: getUserPalettes(req.session.userId) });
});

/**
 * POST /api/palettes
 * Save a new palette. Body: { name: string, colors: string[2-6] }
 */
app.post("/api/palettes", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { name, colors } = req.body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return res.status(400).json({ error: "Name is required" });
  }

  if (!Array.isArray(colors) || colors.length < 2 || colors.length > 6) {
    return res.status(400).json({ error: "Between 2 and 6 colors required" });
  }

  const hexPattern = /^#[0-9a-fA-F]{6}$/;
  if (!colors.every((c) => hexPattern.test(c))) {
    return res.status(400).json({ error: "Colors must be valid hex (#RRGGBB)" });
  }

  const user = findUserById(req.session.userId);
  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }

  const palette = createPalette({
    name: name.trim().slice(0, 50),
    colors,
    userId: user.id,
    userName: user.name,
    userPicture: user.picture,
  });

  return res.status(201).json({ palette: serializePalette(palette, user.id) });
});

/**
 * POST /api/palettes/:id/like
 * Toggle like on a palette. Requires authentication.
 */
app.post("/api/palettes/:id/like", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid palette ID" });
  }

  const palette = toggleLike(id, req.session.userId);
  if (!palette) {
    return res.status(404).json({ error: "Palette not found" });
  }

  return res.json({ palette });
});

/**
 * DELETE /api/palettes/:id
 * Delete a palette (must be owner).
 */
app.delete("/api/palettes/:id", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid palette ID" });
  }

  const deleted = deletePalette(id, req.session.userId);
  if (!deleted) {
    return res.status(404).json({ error: "Palette not found" });
  }

  return res.json({ ok: true });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.originalUrl}:`, err.stack);
  res.status(500).json({ error: "Internal server error" });
});

// --- Start server ---

if (require.main === module) {
  if (process.env.HTTPS === "true") {
    const certPath = path.join(__dirname, "..", "certs");
    const key = fs.readFileSync(path.join(certPath, "localhost-key.pem"));
    const cert = fs.readFileSync(path.join(certPath, "localhost.pem"));
    https.createServer({ key, cert }, app).listen(PORT, () => {
      console.log(`HTTPS server running at https://localhost:${PORT}`);
    });
  } else {
    app.listen(PORT, () => {
      console.log(`HTTP server running at http://localhost:${PORT}`);
      console.log(
        "Note: FedCM requires HTTPS. Run `npm run start:https` for local HTTPS.",
      );
    });
  }
}

module.exports = app;
