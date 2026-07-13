// Copyright (c) Meta Platforms, Inc. and affiliates.
// All rights reserved.
//
// This source code is licensed under the license found in the
// LICENSE file in the root directory of this source tree.
// Requires: React (global), colors.js (contrastColor)

const { useState, useEffect, useRef, useCallback } = React;

function Nav({
  user,
  activePage,
  onLogin,
  onLogout,
  showFallback,
  onFallbackClose,
  onProviderSuccess,
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const links = [
    { id: "generator", label: "Generator", href: "/" },
    { id: "my-palettes", label: "My Palettes", href: "/my-palettes.html" },
    { id: "explore", label: "Explore", href: "/explore.html" },
  ];

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e) => {
      if (e.target.closest(".nav-menu-toggle") || e.target.closest(".nav-links")) return;
      setMenuOpen(false);
    };
    const handleKey = (e) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  // Close the sign-in fallback dropdown on outside click / Escape. `doLogin`
  // sets showFallback asynchronously (after awaiting FedCM), so the click that
  // opened it has already finished propagating by the time this listener binds.
  useEffect(() => {
    if (!showFallback) return;
    const handleClick = (e) => {
      if (e.target.closest(".nav-signin")) return;
      onFallbackClose && onFallbackClose();
    };
    const handleKey = (e) => {
      if (e.key === "Escape") onFallbackClose && onFallbackClose();
    };
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [showFallback, onFallbackClose]);

  return (
    <nav id="nav"><div className="nav-inner">
      <a href="/" className="nav-logo" aria-label="Palette Collector">
        <img src="/favicon.svg" alt="" className="nav-logo-icon" aria-hidden="true" />
        <span className="nav-logo-text">Palette Collector</span>
      </a>
      <div id="nav-menu" className={`nav-links${menuOpen ? " open" : ""}`}>
        {links.map((l) => (
          <a
            key={l.id}
            href={l.href}
            className={`nav-link ${l.id === activePage ? "active" : ""}`}
          >
            {l.label}
          </a>
        ))}
      </div>
      <div className="nav-auth">
        {user ? (
          <div className="nav-user">
            {user.picture ? (
              <img src={user.picture} alt="" className="nav-avatar" referrerPolicy="no-referrer" />
            ) : (
              <span className="nav-avatar-placeholder" />
            )}
            <span className="nav-name">{user.name}</span>
            <button className="btn-small btn-outline" onClick={onLogout}>Sign Out</button>
          </div>
        ) : (
          <div className="nav-signin">
            <button
              className="btn-small btn-primary"
              onClick={onLogin}
              aria-haspopup="menu"
              aria-expanded={!!showFallback}
            >
              Sign In
            </button>
            {showFallback && (
              <div className="nav-signin-dropdown" role="menu">
                <AuthFallback
                  onSuccess={onProviderSuccess}
                  onClose={onFallbackClose}
                />
              </div>
            )}
          </div>
        )}
      </div>
      <button
        type="button"
        className="nav-menu-toggle"
        aria-label="Menu"
        aria-expanded={menuOpen}
        aria-controls="nav-menu"
        onClick={() => setMenuOpen((o) => !o)}
      >
        <span className="bar" />
        <span className="bar" />
        <span className="bar" />
      </button>
    </div></nav>
  );
}

// Shown when the unified FedCM chooser can't be used — the user isn't signed
// into any IdP (cold/incognito) or the browser lacks FedCM. Each button walks
// the fallback ladder: single-provider active-mode FedCM first (opens the IdP
// sign-in when logged out), then a guaranteed redirect / SDK path.
function AuthFallback({ onSuccess, onClose }) {
  const returnTo = () =>
    typeof window !== "undefined"
      ? window.location.pathname + window.location.search
      : "/";

  const handleGoogle = async () => {
    // Try active-mode FedCM; on anything but success/dismissal, fall through to
    // the guaranteed full-page redirect.
    try {
      const result = await loginWithProviderFedCM("google");
      if (result.status === "success") {
        onSuccess(result.user);
        return;
      }
      if (result.status === "dismissed") return;
    } catch (err) {
      // Ignore and fall through to redirect.
    }
    startGoogleRedirect(returnTo()).catch((err) =>
      toast.error("Sign in failed: " + err.message),
    );
  };

  const handleFacebook = async () => {
    try {
      // Try active-mode FedCM first; on anything but success/dismissal, fall
      // through to the SDK's own popup login.
      let result;
      try {
        result = await loginWithProviderFedCM("facebook");
      } catch (err) {
        result = { status: "unavailable" };
      }
      if (result.status !== "success" && result.status !== "dismissed") {
        result = await loginWithFacebookSDK();
      }
      if (result.status === "success") {
        onSuccess(result.user);
      } else if (result.status !== "dismissed") {
        toast.error("Facebook sign-in is unavailable. Please try again.");
      }
    } catch (err) {
      toast.error("Sign in failed: " + err.message);
    }
  };

  return (
    <div className="auth-fallback" role="group" aria-label="Sign in options">
      {!isFedCMSupported() && (
        <p className="auth-fallback-note">
          This browser doesn't support FedCM — sign in with a provider directly.
        </p>
      )}
      <p className="auth-fallback-text">
        Choose a provider to continue. You'll be prompted to sign in if you
        aren't already.
      </p>
      <div className="auth-fallback-actions">
        <button className="btn btn-primary" onClick={handleGoogle}>
          Continue with Google
        </button>
        <button className="btn btn-primary" onClick={handleFacebook}>
          Continue with Facebook
        </button>
      </div>
      {onClose && (
        <button className="btn-small btn-outline" onClick={onClose}>
          Cancel
        </button>
      )}
    </div>
  );
}

function CardSwatch({ color, onClick }) {
  const [copied, setCopied] = useState(false);

  const handleClick = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(color).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 800);
  };

  return (
    <div
      className="card-swatch"
      style={{ background: color, color: contrastColor(color) }}
      onClick={handleClick}
    >
      {copied ? "Copied!" : color}
    </div>
  );
}

function PaletteCard({ palette, showAuthor, showDelete, showLike, showLikeCount, onClick, onDelete, onLike }) {
  const handleCardClick = (e) => {
    if (!onClick) return;
    if (e.target.closest(".btn-icon") || e.target.closest(".card-like-btn")) return;
    onClick(palette);
  };

  return (
    <div
      className="palette-card"
      style={onClick ? { cursor: "pointer" } : undefined}
      onClick={handleCardClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleCardClick(e); } } : undefined}
    >
      <div className="card-swatches">
        {palette.colors.map((color, i) => (
          <CardSwatch key={i} color={color} />
        ))}
      </div>
      <div className="card-footer">
        <div className="card-info">
          <span className="card-name">{palette.name}</span>
          {showAuthor && (
            <div className="card-author">
              {palette.userPicture && (
                <img src={palette.userPicture} alt="" className="card-author-avatar" referrerPolicy="no-referrer" />
              )}
              <span>{palette.userName}</span>
            </div>
          )}
        </div>
        <div className="card-actions">
          {showLike && (
            <LikeButton
              likes={palette.likes || 0}
              liked={palette.likedByMe || false}
              onLike={() => onLike(palette.id)}
            />
          )}
          {!showLike && showLikeCount && palette.likes > 0 && (
            <span className="card-like-count">&hearts; {palette.likes}</span>
          )}
          {showDelete && (
            <button className="btn-icon" title="Delete palette" onClick={() => onDelete(palette.id)}>
              &times;
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function LikeButton({ likes, liked, onLike }) {
  return (
    <button
      className={`card-like-btn${liked ? " liked" : ""}`}
      title="Like"
      onClick={onLike}
    >
      {liked ? "\u2665" : "\u2661"}
      <span className="like-count">{likes}</span>
    </button>
  );
}

function PaletteGrid({ palettes, renderCard }) {
  return (
    <div className="palette-grid">
      {palettes.map((p) => (
        <React.Fragment key={p.id}>
          {renderCard(p)}
        </React.Fragment>
      ))}
    </div>
  );
}

function EmptyState({ message, actionLabel, actionHref, onAction }) {
  return (
    <div className="empty-state" style={{ display: "flex" }}>
      <p>{message}</p>
      {actionHref && (
        <a href={actionHref} className="btn btn-primary">{actionLabel}</a>
      )}
      {onAction && (
        <button className="btn btn-primary" onClick={onAction}>{actionLabel}</button>
      )}
    </div>
  );
}
