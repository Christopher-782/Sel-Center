import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";

    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: allowed, error: permissionError } = await caller.rpc("user_has_permission", { p_permission: "manage_users" });
    if (permissionError || allowed !== true) {
      return new Response(JSON.stringify({ error: "You do not have permission to create users." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const fullName = String(body.full_name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const role = String(body.role || "sale_associate");
    const permissions = Array.isArray(body.permissions) ? body.permissions.map(String) : [];
    if (!fullName || !email || password.length < 8) throw new Error("Full name, valid email and a password of at least 8 characters are required.");
    if (!["sale_associate", "manager", "admin"].includes(role)) throw new Error("Invalid role.");

    const admin = createClient(url, serviceKey);
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: fullName },
    });
    if (createError) throw createError;
    const user = created.user;

    const { error: profileError } = await admin.from("profiles").upsert({ id: user.id, full_name: fullName, email, role });
    if (profileError) throw profileError;

    const { data: permissionRows, error: listError } = await admin.from("permissions").select("permission_key");
    if (listError) throw listError;
    const desired = new Set(permissions);
    const overrides = (permissionRows || [])
      .filter((p) => p.permission_key !== "admin_dashboard")
      .map((p) => ({ user_id: user.id, permission_key: p.permission_key, granted: desired.has(p.permission_key) }));
    if (overrides.length) {
      const { error: overrideError } = await admin.from("user_permissions").upsert(overrides, { onConflict: "user_id,permission_key" });
      if (overrideError) throw overrideError;
    }

    return new Response(JSON.stringify({ ok: true, user: { id: user.id, email, full_name: fullName, role } }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
