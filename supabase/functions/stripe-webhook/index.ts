import Stripe from "npm:stripe@18.0.0";
import { createClient } from "npm:@supabase/supabase-js@2";

function mapSubscriptionStatus(status: Stripe.Subscription.Status): string {
  if (status === "active") return "active";
  if (status === "trialing") return "trialing";
  if (status === "past_due" || status === "unpaid" || status === "incomplete" || status === "paused") return "past_due";
  if (status === "incomplete_expired") return "expired";
  return "canceled";
}

function subscriptionPeriodEnd(sub: Stripe.Subscription): string | null {
  const ends = (sub.items?.data || [])
    .map((item: any) => Number(item?.current_period_end || 0))
    .filter((v: number) => Number.isFinite(v) && v > 0);
  if (!ends.length) return null;
  return new Date(Math.max(...ends) * 1000).toISOString();
}

Deno.serve(async (req) => {
  try {
    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    if (!stripeSecret || !webhookSecret) throw new Error("Secrets Stripe manquants");

    const signature = req.headers.get("stripe-signature");
    if (!signature) return new Response("Missing signature", { status: 400 });

    const body = await req.text();
    const stripe = new Stripe(stripeSecret, { apiVersion: "2025-08-27.basil" });
    const event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const eventId = event.id;
    const { data: existing } = await admin
      .from("payment_events")
      .select("id")
      .eq("provider_event_id", eventId)
      .maybeSingle();
    if (existing) return new Response("ok", { status: 200 });

    let userId: string | null = null;
    let planCode: string | null = null;

    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      userId = session.client_reference_id || session.metadata?.user_id || null;
      planCode = session.metadata?.plan_code || null;

      const paymentSettled = session.payment_status === "paid" || session.payment_status === "no_payment_required";

      if (userId && planCode && paymentSettled) {
        const isLifetime = planCode === "lifetime";

        if (isLifetime) {
          const { error } = await admin.from("user_subscriptions").insert({
            user_id: userId,
            plan_code: planCode,
            status: "lifetime",
            provider: "stripe",
            provider_customer_id: session.customer ? String(session.customer) : null,
            provider_subscription_id: null,
            started_at: new Date().toISOString(),
            current_period_end: null,
            metadata: { checkout_session_id: session.id },
          });
          if (error) throw error;
        } else if (session.subscription) {
          const providerSubscriptionId = String(session.subscription);
          const sub = await stripe.subscriptions.retrieve(providerSubscriptionId);
          const mappedStatus = mapSubscriptionStatus(sub.status);
          const periodEnd = subscriptionPeriodEnd(sub);

          const { error } = await admin.from("user_subscriptions").insert({
            user_id: userId,
            plan_code: planCode,
            status: mappedStatus,
            provider: "stripe",
            provider_customer_id: session.customer ? String(session.customer) : null,
            provider_subscription_id: providerSubscriptionId,
            started_at: new Date().toISOString(),
            current_period_end: periodEnd,
            metadata: { checkout_session_id: session.id },
          });
          if (error) throw error;
        }
      }
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      userId = sub.metadata?.user_id || null;
      planCode = sub.metadata?.plan_code || null;
      const mapped = event.type === "customer.subscription.deleted" ? "canceled" : mapSubscriptionStatus(sub.status);
      const periodEnd = subscriptionPeriodEnd(sub);

      const { error } = await admin.from("user_subscriptions").update({
        status: mapped,
        current_period_end: periodEnd,
        canceled_at: (mapped === "canceled" || mapped === "expired") ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq("provider", "stripe").eq("provider_subscription_id", sub.id);
      if (error) throw error;
    }

    const { error: eventError } = await admin.from("payment_events").insert({
      provider: "stripe",
      provider_event_id: eventId,
      event_type: event.type,
      user_id: userId,
      payload: { plan_code: planCode },
    });
    if (eventError) throw eventError;

    return new Response("ok", { status: 200 });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 });
  }
});