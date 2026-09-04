(function () {
  const LABELS = {
    gate_entry: "Record gate entry fees",
    kitchen_pos: "Use Kitchen POS",
    ticket_pos: "Use Ticket POS",

    view_ticket_reports: "View ticket sales reports",
    view_kitchen_reports: "View kitchen sales reports",
    view_gate_reports: "View gate fee reports",

    manage_ticket_inventory: "Manage ticket quantities",
    manage_kitchen_inventory: "Manage kitchen inventory",

    manage_users: "Create users and assign access",
    view_audit_logs: "View inventory audit logs",

    reconcile_finance: "Perform daily, weekly and custom reconciliation",

    view_profit_reports: "View gross profit and net profit reports",

    manage_expenses: "Record and manage operating expenses",

    edit_sales: "Edit sales records",

    admin_dashboard: "Open admin dashboard",

    reduce_stock: "Reduce inventory stock",

    view_stock_history: "View inventory stock history",
  };

  const ALL = Object.keys(LABELS);

  function db() {
    if (!window.supabase || typeof window.supabase.from !== "function") {
      throw new Error("Supabase client is not available.");
    }

    return window.supabase;
  }

  async function currentUser() {
    const { data, error } = await db().auth.getUser();

    if (error || !data.user) {
      return null;
    }

    return data.user;
  }

  async function getProfile() {
    const user = await currentUser();

    if (!user) {
      return null;
    }

    const { data, error } = await db()
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (error) {
      console.warn("Profile load failed", error.message);

      return null;
    }

    localStorage.setItem("userRole", data.role);

    localStorage.setItem("userName", data.full_name || data.email);

    return data;
  }

  async function getPermissions(force = false) {
    const profile = await getProfile();

    const role = (
      profile?.role ||
      localStorage.getItem("userRole") ||
      ""
    ).toLowerCase();

    /*
      SUPER ADMIN BYPASS

      Super Admin always gets every permission.
    */

    if (role === "super_admin") {
      localStorage.setItem("userPermissions", JSON.stringify(ALL));

      return ALL;
    }

    if (!force) {
      try {
        const cached = JSON.parse(
          localStorage.getItem("userPermissions") || "[]",
        );

        if (Array.isArray(cached) && cached.length) {
          return cached;
        }
      } catch (e) {}
    }

    const user = await currentUser();

    if (!user) {
      return [];
    }

    try {
      const { data, error } = await db().rpc("get_my_permissions");

      if (error) {
        throw error;
      }

      const permissions = (data || [])
        .map((r) => (typeof r === "string" ? r : r.permission_key))
        .filter(Boolean);

      localStorage.setItem("userPermissions", JSON.stringify(permissions));

      return permissions;
    } catch (err) {
      console.warn("Permission RPC failed", err.message);

      /*
        ADMIN FALLBACK

        Admin can operate but
        cannot view profit.
      */

      if (role === "admin") {
        const adminPermissions = ALL.filter(
          (p) => p !== "view_profit_reports" && p !== "reduce_stock",
        );

        localStorage.setItem(
          "userPermissions",
          JSON.stringify(adminPermissions),
        );

        return adminPermissions;
      }

      if (role === "sale_associate") {
        const salesPermissions = ["gate_entry", "kitchen_pos", "ticket_pos"];

        localStorage.setItem(
          "userPermissions",
          JSON.stringify(salesPermissions),
        );

        return salesPermissions;
      }

      return [];
    }
  }

  async function ensureAuth(required) {
    const user = await currentUser();

    if (!user) {
      location.href = "login.html";

      return null;
    }

    const permissions = await getPermissions(true);

    const profile = await getProfile();

    const role = (profile?.role || "").toLowerCase();

    const allowed = role === "super_admin" || permissions.includes(required);

    if (required && !allowed) {
      document.body.innerHTML = `

      <div style="
      font-family:Inter,sans-serif;
      max-width:620px;
      margin:80px auto;
      padding:28px">

      <h2>
      Access denied
      </h2>

      <p>
      You do not have permission
      to open this section.
      </p>

      <a href="app.html">
      Return to dashboard
      </a>

      </div>

      `;

      return null;
    }

    hydrateUser(user, permissions, role);

    return {
      user,
      permissions,
      role,
    };
  }

  async function ensureAny(required = []) {
    const ctx = await ensureAuth();

    if (!ctx) {
      return null;
    }

    if (
      required.length &&
      !required.some((p) => ctx.permissions.includes(p)) &&
      ctx.role !== "super_admin"
    ) {
      document.body.innerHTML = `

      <div style="
      font-family:Inter,sans-serif;
      max-width:620px;
      margin:80px auto;
      padding:28px">

      <h2>
      Access denied
      </h2>

      </div>

      `;

      return null;
    }

    return ctx;
  }

  function hydrateUser(user, permissions, role) {
    document
      .querySelectorAll("[data-user-name]")
      .forEach(
        (el) =>
          (el.textContent =
            localStorage.getItem("userName") || user.email || "User"),
      );

    document.querySelectorAll("[data-permission-link]").forEach((el) => {
      const permission = el.dataset.permissionLink;

      if (role === "super_admin" || permissions.includes(permission)) {
        el.classList.remove("hidden");
      } else {
        el.classList.add("hidden");
      }
    });
  }

  async function logout() {
    await db().auth.signOut();

    localStorage.clear();

    location.href = "login.html";
  }

  function money(n) {
    return (
      "₦" +
      Number(n || 0).toLocaleString("en-NG", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }

  function esc(v) {
    return String(v ?? "").replace(
      /[&<>'"]/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;",
        })[c],
    );
  }

  function alertBox(el, msg, type = "success") {
    if (!el) return;

    el.className =
      "alert " +
      (type === "error"
        ? "alert-error"
        : type === "info"
          ? "alert-info"
          : "alert-success");

    el.textContent = msg;

    el.classList.remove("hidden");
  }

  function clearAlert(el) {
    if (el) el.classList.add("hidden");
  }

  window.SELAccess = {
    db,
    currentUser,
    getProfile,
    getPermissions,
    ensureAuth,
    ensureAny,
    logout,
    money,
    esc,
    alertBox,
    clearAlert,
    labels: LABELS,
    allPermissions: ALL,
  };
})();
