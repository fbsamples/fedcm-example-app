# FedCM Example: Facebook + Google Login

A working example of [Facebook Login](https://developers.facebook.com/docs/facebook-login/) and [Google Login](https://developers.google.com/identity) coexisting in a single app via the browser's [Federated Credential Management (FedCM)](https://developer.mozilla.org/en-US/docs/Web/API/FedCM_API) API.

The example is wrapped in a small "Palette Collector" demo app — a color-palette generator with save / like / explore features — so the login flow has somewhere meaningful to land.

## What This Demonstrates

- **Multi-provider FedCM** — a single `navigator.credentials.get()` call that lists both Facebook and Google in `identity.providers`, so the browser shows one unified account chooser.
- **Mixing the FB JS SDK with native FedCM** — the Facebook provider entry comes from `FB.FedCM.getProviderConfig()`; the Google provider is configured directly in the call. The post-credential handoff differs per provider, and the sample shows both paths.
- **Server-side token verification** — Google's JWT ID token is verified with `google-auth-library`; Facebook's access token is exchanged at the Graph API. Both produce the same normalized profile shape.
- **Email-based account linking** — when the same email appears under a different provider, the new provider is linked onto the existing user record. (Demo behavior — see [Notes & Limitations](#notes--limitations).)
- **Session management** — once a token is verified, the server issues a standard `express-session` cookie. No more FedCM round-trips per request.

## Prerequisites

- **Chrome 136+** or **Edge 136+** (multi-provider FedCM shipped April 2025). Firefox and Safari do not support FedCM.
- A [Facebook App](https://developers.facebook.com/apps/) with Facebook Login configured and a [Google Cloud project](https://console.cloud.google.com/apis/credentials) with an OAuth 2.0 Client ID. Add `https://localhost:3000` as an allowed origin on both.
- [Node.js](https://nodejs.org/) 18+.
- [mkcert](https://github.com/FiloSottile/mkcert) for local HTTPS — FedCM only runs in a secure context.

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/fbsamples/fedcm-example-app.git
cd fedcm-example-app
npm install
```

### 2. Set up local HTTPS

```bash
# macOS: brew install mkcert
# Linux: see https://github.com/FiloSottile/mkcert#installation

mkcert -install
mkdir -p certs
mkcert -key-file certs/localhost-key.pem -cert-file certs/localhost.pem localhost
```

### 3. Configure your app IDs

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | Required | Purpose |
| --- | --- | --- |
| `FB_APP_ID` | yes | Your Facebook App ID. |
| `GOOGLE_CLIENT_ID` | yes | Your Google OAuth 2.0 Client ID. |
| `SESSION_SECRET` | yes | Any random string used to sign the session cookie. |
| `PORT` | no | Defaults to `3000`. |
| `DEV_LOGIN` | no | Set to `true` to expose `POST /auth/dev-login`, a no-auth bypass that mints a fake session. Useful for poking at the palette features without a real IdP login. **Never set in production.** |

### 4. Run

```bash
npm run start:https
```

Open <https://localhost:3000> in Chrome 136+ and click **Sign In**.

To run tests:

```bash
npm test
```

## How It Works

### Client side (`client/auth.js`)

The Facebook SDK loads asynchronously and the sample exposes its readiness as a Promise (`window.fbSdkReady`). Once both the SDK and FedCM are ready, the login function asks the FB SDK for its provider config, lists Google's provider directly, and fires a single `navigator.credentials.get()`:

```js
await window.fbSdkReady;

const { nonce } = await fetch("/auth/nonce").then((r) => r.json());

const fbProvider = FB.FedCM.getProviderConfig({
  scope: "public_profile,email",
  nonce,
});

const googleProvider = {
  configURL: GOOGLE_CONFIG_URL,
  clientId: GOOGLE_CLIENT_ID,
  nonce,
  params: {
    nonce,
    response_type: "id_token",
    scope: "openid email profile",
  },
};

const credential = await navigator.credentials.get({
  identity: {
    providers: [googleProvider, fbProvider],
  },
});
```

The browser shows a unified account chooser. The returned `credential.configURL` identifies which provider the user picked.

For Facebook, the credential is handed back to the SDK so it can finish the flow and yield a Graph API access token:

```js
if (credential.configURL === FACEBOOK_CONFIG_URL) {
  const result = FB.FedCM.processCredential(credential);
  token = result.authResponse.accessToken;
} else {
  token = credential.token; // Google: a JWT (or a JSON envelope wrapping one)
}
```

The token is then `POST`ed to `/auth/verify` along with the `configURL`.

### Server side (`server/auth.js`)

The server routes the token to the right verifier based on the `configURL`:

- **Facebook** — `GET https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=...`. A 200 with an `id` field counts as a verified token.
- **Google** — `OAuth2Client.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })` from `google-auth-library`, which checks the JWT signature against Google's published JWKS, validates `iss`, and binds the audience to your Client ID. Google's FedCM response can be either a bare JWT or a `{ iss, id_token, ... }` envelope, so the sample unwraps the envelope before verifying.

Both verifiers run after a session-bound nonce check: the client calls `GET /auth/nonce` before each FedCM attempt, the server stashes the value in the session, and `POST /auth/verify` requires the IdP-returned token to carry that exact nonce. The session nonce is one-shot — consumed on every `/auth/verify` call so a captured token can't be replayed. Google's nonce is in the JWT `nonce` claim; Facebook's exchange returns an OAuth access token instead, so its replay protection comes from the Graph API audience binding rather than the nonce itself.

Both paths return a normalized profile:

```js
{ provider, providerId, email, name, picture }
```

### Account linking (`server/users.js`)

`findOrCreateUser(profile)` walks three cases in order:

1. A user already exists with this exact `(provider, providerId)` — return it (and refresh `name` / `picture`).
2. A user already exists with this `email` — link the new provider onto that account.
3. No match — create a new user.

The result is an in-memory record like:

```js
{
  id: 1,
  email: "alice@example.com",
  name: "Alice",
  picture: "...",
  providers: {
    facebook: { id: "fb-123", email: "alice@example.com" },
    google:   { id: "goog-456", email: "alice@example.com" },
  },
}
```

### Session, then a normal app

Once `findOrCreateUser` returns, the server stashes the user's internal id in the session cookie (`req.session.userId = user.id`). Every subsequent request — palette CRUD, `GET /auth/me`, etc. — is a plain authenticated request gated on `req.session.userId`. FedCM is only involved at sign-in.

## Project Structure

```
├── client/
│   ├── index.html         Palette generator (login entry point)
│   ├── my-palettes.html   Signed-in user's saved palettes
│   ├── explore.html       Public feed of saved palettes
│   ├── oauth-callback.html Google redirect-fallback landing page
│   ├── auth.js            FedCM client logic + FB SDK glue + fallback ladder
│   ├── api.js             fetch() wrappers for /api/palettes
│   ├── components.js      Shared React components (Nav, PaletteCard, ...)
│   ├── colors.js          Hex/HSL math, contrast, random color
│   ├── toast.js           Toast notifications
│   ├── styles.css
│   └── favicon.svg
├── server/
│   ├── index.js           Express app, routes, HTTPS bootstrap
│   ├── auth.js            Token verification (Facebook + Google)
│   ├── users.js           In-memory user store + account linking
│   └── palettes.js        In-memory palette store
├── certs/                 mkcert-generated local TLS certs (gitignored)
├── .env.example
├── package.json
├── LICENSE
├── CONTRIBUTING.md
└── CODE_OF_CONDUCT.md
```

The client uses React (loaded from a CDN) and `@simonwep/pickr` for the color picker. JSX is compiled in the browser via `@babel/standalone` to keep the demo build-step-free; a real production app should replace this with a bundler (Vite, esbuild, etc.).

## Browser Compatibility

| Browser | FedCM | Multi-provider |
| --- | --- | --- |
| Chrome 136+ | Yes | Yes |
| Edge 136+ | Yes | Yes |
| Firefox | No | No |
| Safari | No | No |

On unsupported browsers, the sign-in surface shows a "FedCM not supported" notice. A production app should fall back to redirect-based OAuth — see [Fallback Strategies](#fallback-strategies).

## Troubleshooting

### The FedCM prompt never appears

- **HTTPS required** — FedCM is only enabled in secure contexts. Make sure you're running `npm run start:https`, not `npm start`.
- **Browser version** — multi-provider needs Chrome 136+ / Edge 136+. Check `chrome://version`.
- **Provider login state** — the browser silently skips providers where you aren't signed in. Make sure you're logged into both `facebook.com` and `accounts.google.com` in the same browser profile.
- **DevTools console** — FedCM surfaces detailed error messages in the Console tab.

### `Token verification failed`

- **Mismatched client IDs** — the App ID and Client ID in `.env` must match the Facebook App Dashboard and Google Cloud Console respectively.
- **Facebook App in development mode** — your Facebook account must be listed as a developer, tester, or admin of the app, or the Graph API call will reject the token.
- **Wrong audience** — Google verification uses `audience: process.env.GOOGLE_CLIENT_ID`. If you regenerated the Client ID, update `.env`.

### Account linking didn't fire

The linking lookup is by exact email match. If your Facebook and Google accounts are registered under different emails, they'll be treated as two separate users.

## Cold start (no cookies / incognito)

FedCM's account list comes from the IdP's **own first-party cookies** on `accounts.google.com` / `facebook.com` — not third-party cookies. In a fresh incognito window (or after clearing cookies), the user isn't signed into either IdP, so the browser's **passive** account chooser shows nothing and `navigator.credentials.get()` rejects generically. Passive mode alone cannot sign a logged-out user in.

This sample handles that with an **escalation ladder** (`client/auth.js`, `AuthFallback` in `client/components.js`):

1. **Primary** — passive, multi-provider FedCM: the unified chooser, shown when the user is already signed into an IdP.
2. **Fallback** — surfaced when the primary yields nothing or FedCM is unsupported. Per-provider buttons that first try single-provider **active-mode** FedCM (`mode: "active"`, which opens the IdP's sign-in dialog for logged-out users), then fall back to:
   - **Google** — a full-page OAuth 2.0 implicit redirect (`response_type=id_token`). The `id_token` returns in the URL fragment and is verified by `client/oauth-callback.html` via the existing `POST /auth/verify`.
   - **Facebook** — the SDK's own `FB.login()` popup, which prompts for Facebook sign-in and yields a Graph-API access token.

All paths reuse the same `/auth/nonce` + `/auth/verify` backend and account-linking logic — only client-side token acquisition differs. No client secrets are required.

> **Google Cloud Console setup:** the redirect fallback needs `https://localhost:3000/oauth-callback.html` added as an **Authorized redirect URI** on your OAuth 2.0 Client ID (the FedCM-only flow needed just the origin). Adjust the host/port if you don't run on the default `3000`.

## Fallback Strategies

The escalation ladder above is implemented in this sample, but the building blocks generalize:

1. **Feature-detect FedCM** — check for `window.IdentityCredential` (`isFedCMSupported()` in `client/auth.js`).
2. **Fall back to redirect-based OAuth** — this sample uses Google's implicit `id_token` redirect and Facebook's SDK login. A production app may prefer the authorization-code flow (which requires server-side client secrets).
3. **Reuse the same backend** — `POST /auth/verify` works for any token shape the providers return; only the client-side acquisition differs.

## Notes & Limitations

This is a sample. To keep the surface area small a few production concerns are deliberately out of scope:

- **In-memory storage** — `users` and `palettes` are arrays in process memory. Restarting the server wipes everything.
- **Email-based account linking** — linking by email assumes the email has been verified by the provider. For real systems, check `email_verified` on Google's payload, treat Facebook email as untrusted-by-default, or replace the auto-link with an explicit "Link account" flow initiated by the already-signed-in user.
- **Session store** — `express-session`'s default in-memory store is single-process and leaks; production apps should use Redis, Postgres, or another shared store.
- **`/auth/dev-login`** — gated only on `DEV_LOGIN === "true"`. Treat that env var like a master key.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to send pull requests, file issues,
and complete the CLA. Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

This project is licensed under the license found in the [LICENSE](LICENSE) file
in the root directory of this source tree.
