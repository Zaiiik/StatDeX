import Stripe from "npm:stripe@18.0.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecret) throw new Error("STRIPE_SECRET_KEY manquante");

    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) throw new Error("UNAUTHENTICATED");

    const body = await req.json().catch(() => ({}));
    const action = body?.action === "cancel" ? "cancel" : "manage";

    const { data: sub, error: subError } = await supabase
      .from("user_subscriptions")
      .select("provider_customer_id, provider_subscription_id, plan_code, status, created_at")
      .eq("user_id", user.id)
      .eq("provider", "stripe")
      .not("provider_customer_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subError) throw subError;
    if (!sub?.provider_customer_id) throw new Error("Aucun abonnement Stripe à gérer sur ce compte.");
    if (sub.plan_code === "lifetime") throw new Error("L’accès Lifetime n’a pas de renouvellement à résilier.");

    const stripe = new Stripe(stripeSecret, { apiVersion: "2025-08-27.basil" });
    const params: Stripe.BillingPortal.SessionCreateParams = {
      customer: sub.provider_customer_id,
      return_url: "https://zaiiik.github.io/StatDeX/",
    };

    if (action === "cancel") {
      if (!sub.provider_subscription_id) {
        throw new Error("Aucun abonnement Stripe actif à résilier sur ce compte.");
      }
      params.flow_data = {
        type: "subscription_cancel",
        subscription_cancel: {
          subscription: sub.provider_subscription_id,
        },
      };
    }

    const session = await stripe.billingPortal.sessions.create(params);

    return new Response(JSON.stringify({ url: session.url, action }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});