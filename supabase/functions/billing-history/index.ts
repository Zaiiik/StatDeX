import Stripe from "npm:stripe@18.0.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const planLabel = (code?: string | null) => code === "month" ? "1 mois" : code === "1y" ? "1 an" : code === "lifetime" ? "Lifetime" : (code || "LEVELING-APP");

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

    const { data: sub, error: subError } = await supabase
      .from("user_subscriptions")
      .select("provider_customer_id, provider_subscription_id, plan_code, status, started_at, current_period_end, canceled_at, created_at, updated_at")
      .eq("user_id", user.id)
      .eq("provider", "stripe")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (subError) throw subError;

    if (!sub?.provider_customer_id) {
      return new Response(JSON.stringify({ subscription: sub || null, payments: [] }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    const stripe = new Stripe(stripeSecret, { apiVersion: "2025-08-27.basil" });
    let stripeSub: any = null;
    if (sub.provider_subscription_id) {
      try { stripeSub = await stripe.subscriptions.retrieve(sub.provider_subscription_id); } catch (_) {}
    }

    const [invoiceList, checkoutList] = await Promise.all([
      stripe.invoices.list({ customer: sub.provider_customer_id, limit: 24 }),
      stripe.checkout.sessions.list({ customer: sub.provider_customer_id, limit: 24 }),
    ]);

    const invoiceIds = new Set(invoiceList.data.map((x:any)=>x.id));
    const payments:any[] = [];
    for (const inv of invoiceList.data as any[]) {
      if (!inv.amount_paid || !["paid","open","void","uncollectible"].includes(String(inv.status))) continue;
      payments.push({
        id: inv.id,
        source: "invoice",
        date: new Date((inv.status_transitions?.paid_at || inv.created) * 1000).toISOString(),
        status: inv.status,
        amount: inv.amount_paid,
        currency: String(inv.currency || "eur").toUpperCase(),
        plan_code: sub.plan_code || null,
        plan_label: planLabel(sub.plan_code),
        invoice_url: inv.hosted_invoice_url || null,
        receipt_url: null,
      });
    }
    for (const s of checkoutList.data as any[]) {
      const invId = typeof s.invoice === "string" ? s.invoice : s.invoice?.id;
      if (invId && invoiceIds.has(invId)) continue;
      if (String(s.payment_status) !== "paid" || !s.amount_total) continue;
      const code = s.metadata?.plan_code || sub.plan_code || null;
      payments.push({
        id: s.id,
        source: "checkout",
        date: new Date(s.created * 1000).toISOString(),
        status: s.payment_status,
        amount: s.amount_total,
        currency: String(s.currency || "eur").toUpperCase(),
        plan_code: code,
        plan_label: planLabel(code),
        invoice_url: null,
        receipt_url: null,
      });
    }
    payments.sort((a,b)=>new Date(b.date).getTime()-new Date(a.date).getTime());

    const subscription = {
      ...sub,
      stripe_status: stripeSub?.status || sub.status || null,
      cancel_at_period_end: !!stripeSub?.cancel_at_period_end,
      cancel_at: stripeSub?.cancel_at ? new Date(stripeSub.cancel_at * 1000).toISOString() : null,
      stripe_current_period_end: stripeSub?.current_period_end ? new Date(stripeSub.current_period_end * 1000).toISOString() : null,
      plan_label: planLabel(sub.plan_code),
    };

    return new Response(JSON.stringify({ subscription, payments: payments.slice(0,20) }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as any)?.message || e) }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});