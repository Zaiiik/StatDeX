import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json" },
});

const activeCommercial = (row: any) => {
  const provider = String(row?.provider || "").toLowerCase();
  const status = String(row?.status || "").toLowerCase();
  if (!["stripe", "google_play"].includes(provider)) return false;
  if (String(row?.plan_code || "").toLowerCase() === "lifetime") return status === "active";
  const end = Date.parse(String(row?.current_period_end || ""));
  return ["active", "trialing"].includes(status) && (!Number.isFinite(end) || end > Date.now());
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authorization = req.headers.get("Authorization") || "";
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "UNAUTHENTICATED" }, 401);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: accessRows, error: accessError } = await userClient.rpc("get_my_access_v2141");
    if (accessError) throw accessError;
    const access = Array.isArray(accessRows) ? accessRows[0] : accessRows;
    const state = String(access?.access_state || "FREE").toUpperCase();
    const planCode = String(access?.plan_code || "").toLowerCase() || null;

    const { data: subscriptions, error: subscriptionError } = await admin
      .from("user_subscriptions")
      .select("provider,plan_code,status,current_period_end,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (subscriptionError) throw subscriptionError;
    const commercial = (subscriptions || []).find(activeCommercial) || null;

    let source = state === "TRIAL" ? "trial" : state === "PASS" ? "pass" : state === "SUBSCRIBED" ? "admin" : "free";
    let provider: string | null = null;
    if (commercial) {
      provider = String(commercial.provider || "").toLowerCase() || null;
      source = provider || "commercial";
    } else if (state === "SUBSCRIBED") {
      const [adminLookup, licenseLookup] = await Promise.all([
        admin.from("admin_users").select("user_id").eq("user_id", user.id).limit(1),
        admin.from("licenses").select("user_id").eq("user_id", user.id).limit(1),
      ]);
      if (adminLookup.error) throw adminLookup.error;
      if (licenseLookup.error) throw licenseLookup.error;
      source = adminLookup.data?.length ? "admin" : licenseLookup.data?.length ? "access_key" : "special_access";
    }

    return json({
      access_source: source,
      access_provider: provider,
      commercial_subscription: !!commercial,
      can_manage_stripe: provider === "stripe",
      can_manage_google_play: provider === "google_play",
      can_purchase_lifetime: state !== "SUBSCRIBED" || (!commercial && planCode !== "lifetime"),
    });
  } catch (error: any) {
    return json({ error: String(error?.message || error) }, 400);
  }
});
