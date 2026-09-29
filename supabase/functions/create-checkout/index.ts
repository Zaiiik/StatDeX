import Stripe from "npm:stripe@18.0.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PRICES: Record<string, { price: string; mode: "subscription" | "payment" }> = {
  month: { price: "price_1UF12lDO49vOXwp4DNPED95l", mode: "subscription" },
  "1y": { price: "price_1UF13lDO49vOXwp4ytYt6cks", mode: "subscription" },
  lifetime: { price: "price_1UF14iDO49vOXwp4cz5M4FHW", mode: "payment" },
};

const GITHUB_APP_URL = "https://zaiiik.github.io/StatDeX/";
const SUCCESS_URL = `${GITHUB_APP_URL}?payment=success&session_id={CHECKOUT_SESSION_ID}`;
const CANCEL_URL = `${GITHUB_APP_URL}?payment=cancel`;
const MONARQUE_COUPON_ID = "LEVELING_MONARQUE_30_ONCE";

async function getMonarqueCoupon(stripe: Stripe): Promise<string> {
  try {
    const existing = await stripe.coupons.retrieve(MONARQUE_COUPON_ID);
    if (!("deleted" in existing && existing.deleted)) return existing.id;
  } catch (e: any) {
    const code = String(e?.code || "");
    if (code && code !== "resource_missing") throw e;
  }

  try {
    const created = await stripe.coupons.create({
      id: MONARQUE_COUPON_ID,
      percent_off: 30,
      duration: "once",
      name: "MONARQUE -30% premier paiement",
      metadata: {
        source: "LEVELING-APP",
        purpose: "MONARQUE_FIRST_PAYMENT_30_PERCENT",
      },
    });
    return created.id;
  } catch (e: any) {
    const existing = await stripe.coupons.retrieve(MONARQUE_COUPON_ID);
    if ("deleted" in existing && existing.deleted) throw e;
    return existing.id;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecret) throw new Error("STRIPE_SECRET_KEY manquante");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "UNAUTHENTICATED" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const plan = String(body?.plan || "");
    const promoCode = String(body?.promo_code || "").trim().toUpperCase();
    const selected = PRICES[plan];
    if (!selected) throw new Error("Plan invalide");

    const { data: accessData, error: accessError } = await supabase.rpc("get_my_access_v2141");
    if (accessError) throw accessError;
    const access = Array.isArray(accessData) ? accessData[0] : accessData;
    const accessState = String(access?.access_state || "none").toLowerCase();
    if (accessState === "subscribed") {
      if (access?.lifetime === true || String(access?.plan_code || "") === "lifetime") {
        throw new Error("ACCÈS_LIFETIME_DÉJÀ_ACTIF");
      }
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      const { data: rows, error: rowsError } = await admin
        .from("user_subscriptions")
        .select("provider,plan_code,status,current_period_end")
        .eq("user_id", user.id)
        .in("provider", ["stripe", "google_play"]);
      if (rowsError) throw rowsError;
      const hasCommercial = (rows || []).some((row: any) => {
        const status = String(row?.status || "").toLowerCase();
        if (String(row?.plan_code || "").toLowerCase() === "lifetime") return status === "active";
        const end = Date.parse(String(row?.current_period_end || ""));
        return ["active", "trialing"].includes(status) && (!Number.isFinite(end) || end > Date.now());
      });
      /* Une clé/admin temporaire reste active pendant le Checkout Lifetime.
         Seul le webhook Stripe validé attribuera ensuite l'accès permanent. */
      if (plan !== "lifetime" || hasCommercial) throw new Error("ABONNEMENT_DÉJÀ_ACTIF");
    }

    const stripe = new Stripe(stripeSecret, { apiVersion: "2025-08-27.basil" });
    const monarque = promoCode === "MONARQUE";
    const couponId = monarque ? await getMonarqueCoupon(stripe) : null;

    const metadata: Record<string, string> = { user_id: user.id, plan_code: plan };
    if (monarque) metadata.promo_code = "MONARQUE";

    const baseParams: Stripe.Checkout.SessionCreateParams = {
      mode: selected.mode,
      line_items: [{ price: selected.price, quantity: 1 }],
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      client_reference_id: user.id,
      customer_email: user.email || undefined,
      allow_promotion_codes: monarque ? undefined : true,
      discounts: couponId ? [{ coupon: couponId }] : undefined,
      metadata,
    };

    if (selected.mode === "subscription") {
      baseParams.subscription_data = { metadata };
    } else {
      baseParams.payment_intent_data = { metadata };
    }

    const session = await stripe.checkout.sessions.create(baseParams);
    return new Response(JSON.stringify({
      url: session.url,
      promo_applied: monarque,
      promo_code: monarque ? "MONARQUE" : null,
    }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
