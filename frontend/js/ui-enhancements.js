(function () {
  "use strict";

  const path = (window.location.pathname.split("/").pop() || "login.html").toLowerCase();
  const pageMap = {
    "login.html": "login",
    "pos.html": "pos",
    "manager.html": "manager",
    "admin.html": "admin",
    "ticket-admin.html": "ticket-admin",
  };

  function getPage() {
    return pageMap[path] || path.replace(/\.html$/, "") || "app";
  }

  function revealElement(el, index) {
    if (!el || el.dataset.uiRevealed === "true") return;
    el.dataset.uiRevealed = "true";
    el.classList.add("ui-reveal");
    el.style.setProperty("--ui-delay", `${Math.min(index * 45, 360)}ms`);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.classList.add("ui-revealed"));
    });
  }

  function revealExisting() {
    const selectors = [
      ".form-container",
      ".hero-content",
      ".card",
      ".form-panel",
      ".table-panel",
      ".panel",
      ".selected-box",
      ".product-card",
      ".cart-item",
      ".package-card",
      ".sales-summary-card",
    ];
    document.querySelectorAll(selectors.join(",")).forEach(revealElement);
  }

  function setupMutationMotion() {
    const observedSelectors = [
      ".product-card",
      ".cart-item",
      ".package-card",
      ".sales-summary-card",
      ".alert",
      ".alert-msg",
    ];

    const observer = new MutationObserver((mutations) => {
      let index = 0;
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches(observedSelectors.join(","))) {
            revealElement(node, index++);
          }
          node.querySelectorAll?.(observedSelectors.join(",")).forEach((child) => {
            revealElement(child, index++);
          });
        });
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function setupPasswordToggle() {
    const input = document.getElementById("password");
    if (!input || input.parentElement?.querySelector(".ui-password-toggle")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "ui-password-toggle";
    button.setAttribute("aria-label", "Show password");
    button.setAttribute("title", "Show password");
    button.innerHTML = '<i class="fas fa-eye"></i>';

    button.addEventListener("click", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      button.innerHTML = show
        ? '<i class="fas fa-eye-slash"></i>'
        : '<i class="fas fa-eye"></i>';
      button.setAttribute("aria-label", show ? "Hide password" : "Show password");
      button.setAttribute("title", show ? "Hide password" : "Show password");
      input.focus({ preventScroll: true });
    });

    input.parentElement.appendChild(button);
  }

  function setupConnectionStatus(page) {
    if (page === "login") return;

    const target =
      document.querySelector(".pos-header-right") ||
      document.querySelector(".header-actions") ||
      document.querySelector(".header-right");

    if (!target || target.querySelector(".ui-status-pill")) return;

    const pill = document.createElement("div");
    pill.className = "ui-status-pill";
    pill.setAttribute("role", "status");
    pill.innerHTML = '<span class="ui-status-dot"></span><span class="ui-status-text">Online</span>';

    function update() {
      const online = navigator.onLine;
      pill.classList.toggle("is-offline", !online);
      pill.querySelector(".ui-status-text").textContent = online ? "Online" : "Offline";
    }

    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();

    target.prepend(pill);
  }

  function setupButtonFeedback() {
    document.addEventListener("pointerdown", (event) => {
      const target = event.target.closest("button, .product-card, .package-card");
      if (!target) return;
      const rect = target.getBoundingClientRect();
      target.style.setProperty("--ui-x", `${event.clientX - rect.left}px`);
      target.style.setProperty("--ui-y", `${event.clientY - rect.top}px`);
    });
  }

  function markLoaded() {
    requestAnimationFrame(() => document.body.classList.add("ui-ready"));
  }

  function init() {
    const page = getPage();
    document.body.dataset.uiPage = page;
    revealExisting();
    setupMutationMotion();
    setupPasswordToggle();
    setupConnectionStatus(page);
    setupButtonFeedback();
    markLoaded();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
