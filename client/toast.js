// Copyright (c) Meta Platforms, Inc. and affiliates.
// All rights reserved.
//
// This source code is licensed under the license found in the
// LICENSE file in the root directory of this source tree.

(function () {
  const DEFAULT_DURATION = 4000;
  const LEAVE_MS = 200;
  let container = null;

  function ensureContainer() {
    if (container) return container;
    container = document.createElement("div");
    container.className = "toast-container";
    container.setAttribute("role", "region");
    container.setAttribute("aria-label", "Notifications");
    document.body.appendChild(container);
    return container;
  }

  function show(message, { type = "info", duration = DEFAULT_DURATION } = {}) {
    const parent = ensureContainer();

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.setAttribute("role", type === "error" ? "alert" : "status");
    toast.setAttribute("aria-live", type === "error" ? "assertive" : "polite");

    const text = document.createElement("span");
    text.className = "toast-message";
    text.textContent = message;

    const close = document.createElement("button");
    close.type = "button";
    close.className = "toast-close";
    close.setAttribute("aria-label", "Dismiss notification");
    close.textContent = "\u00d7";

    toast.appendChild(text);
    toast.appendChild(close);
    parent.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add("toast-visible"));

    let timeoutId = null;
    const dismiss = () => {
      if (!toast.isConnected) return;
      if (timeoutId) clearTimeout(timeoutId);
      toast.classList.remove("toast-visible");
      toast.classList.add("toast-leaving");
      setTimeout(() => toast.remove(), LEAVE_MS);
    };

    close.addEventListener("click", dismiss);
    if (duration > 0) timeoutId = setTimeout(dismiss, duration);

    return { dismiss };
  }

  window.toast = {
    show,
    success: (msg, opts) => show(msg, { ...opts, type: "success" }),
    error: (msg, opts) => show(msg, { ...opts, type: "error" }),
    info: (msg, opts) => show(msg, { ...opts, type: "info" }),
    warning: (msg, opts) => show(msg, { ...opts, type: "warning" }),
  };
})();
