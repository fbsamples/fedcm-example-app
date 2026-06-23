// Copyright (c) Meta Platforms, Inc. and affiliates.
// All rights reserved.
//
// This source code is licensed under the license found in the
// LICENSE file in the root directory of this source tree.

// Build a Content-Security-Policy header value from a directives object.
// Each value is an array of source expressions; an empty array emits the
// directive with no sources (useful for `upgrade-insecure-requests`).
function buildPolicy(directives) {
  return Object.entries(directives)
    .map(([name, sources]) =>
      sources.length === 0 ? name : `${name} ${sources.join(" ")}`,
    )
    .join("; ");
}

// Sources reflect what the client actually loads:
// - React + Babel standalone from unpkg
// - Pickr (color picker) JS + CSS from jsdelivr
// - Facebook JS SDK from connect.facebook.net (XHR to graph.facebook.com,
//   iframes from www.facebook.com / staticxx.facebook.com)
// - Profile pictures from Facebook and Google CDNs (allow any https origin)
// - 'unsafe-eval' + 'unsafe-inline' on script-src are required by
//   @babel/standalone: it Function()-compiles `<script type="text/babel">`
//   blocks and injects the result as inline <script> elements. Hashing isn't
//   viable since the compiled output changes with every edit.
// - 'unsafe-inline' on style-src covers React's `style={{...}}` prop and
//   Pickr's injected styles
// - connect-src includes the script CDNs so DevTools can fetch source maps
const DEFAULT_DIRECTIVES = {
  "default-src": ["'self'"],
  "script-src": [
    "'self'",
    "'unsafe-eval'",
    "'unsafe-inline'",
    "https://unpkg.com",
    "https://cdn.jsdelivr.net",
    "https://connect.facebook.net",
  ],
  "style-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
  "img-src": ["'self'", "data:", "https:"],
  "font-src": ["'self'", "data:"],
  "connect-src": [
    "'self'",
    "https://graph.facebook.com",
    "https://www.facebook.com",
    "https://accounts.google.com",
    "https://unpkg.com",
    "https://cdn.jsdelivr.net",
  ],
  "frame-src": [
    "https://www.facebook.com",
    "https://staticxx.facebook.com",
    "https://accounts.google.com",
  ],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
};

function csp({ directives = DEFAULT_DIRECTIVES, reportOnly = false } = {}) {
  const headerName = reportOnly
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy";
  const value = buildPolicy(directives);
  return (req, res, next) => {
    res.setHeader(headerName, value);
    next();
  };
}

module.exports = { csp, buildPolicy, DEFAULT_DIRECTIVES };
