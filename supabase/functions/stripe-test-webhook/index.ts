import { createClient } from "npm:@supabase/supabase-js@2";

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function periodEndFromSubscription(sub: any): string | null {
  try {
    const items = Array.isArray(sub?.items?.data) ? sub.items.data : [];
    const ends = items.map((x:any)=>Number(x?.current_period_end||0)).filter((x:number)=>Number.isFinite(x)&&x>0);
    if (!ends.length) return null;
    return new Date(Math.max(...ends)*1000).toISOString();
  } catch { return null; }
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

    const event = await req.json();
    if (event?.livemode !== false) return new Response("test events only", { status: 403 });

    const eventId = String(event?.id || "");
    const eventType = String(event?.type || "");
    const obj = event?.data?.object || {};
    if (!eventId.startsWith("evt_") || !eventType) return new Response("bad event", { status: 400 });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: seen } = await admin
      .from("test_payment_events")
      .select("id")
      .eq("provider_event_id", eventId)
      .maybeSingle();
    if (seen) return new Response("ok", { status: 200 });

    let userId: string | null = null;
    let planCode: string | null = null;

    if (eventType === "checkout.session.completed") {
      if (String(obj?.metadata?.leveling_environment || "") !== "test") {
        return new Response("ignored", { status: 200 });
      }

      userId = String(obj?.client_reference_id || "");
      planCode = String(obj?.metadata?.plan_code || "");
      if (!uuidRe.test(userId)) throw new Error("INVALID_CLIENT_REFERENCE_ID");
      if (!["month","1y","lifetime"].includes(planCode)) throw new Error("INVALID_PLAN_CODE");

      const isLifetime = planCode === "lifetime";
      const subscriptionId = isLifetime ? null : (obj?.subscription ? String(obj.subscription) : null);
      const checkoutId = String(obj?.id || "");

      let existing:any = null;
      if (subscriptionId) {
        const q = await admin.from("test_user_subscriptions").select("id").eq("provider_subscription_id", subscriptionId).maybeSingle();
        existing = q.data;
      }
      if (!existing && checkoutId) {
        const q = await admin.from("test_user_subscriptions").select("id").eq("checkout_session_id", checkoutId).maybeSingle();
        existing = q.data;
      }

      const row:any = {
        user_id: userId,
        plan_code: planCode,
        status: isLifetime ? "lifetime" : "active",
        provider: "stripe_test",
        provider_customer_id: obj?.customer ? String(obj.customer) : null,
        provider_subscription_id: subscriptionId,
        checkout_session_id: checkoutId,
        updated_at: new Date().toISOString(),
      };

      if (existing?.id) {
        const { error } = await admin.from("test_user_subscriptions").update(row).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await admin.from("test_user_subscriptions").insert({ ...row, current_period_end: null });
        if (error) throw error;
      }
    }

    if (["customer.subscription.created","customer.subscription.updated","customer.subscription.deleted"].includes(eventType)) {
      if (String(obj?.metadata?.leveling_environment || "") !== "test") {
        return new Response("ignored", { status: 200 });
      }

      const subId = String(obj?.id || "");
      planCode = String(obj?.metadata?.plan_code || "") || null;
      const stripeStatus = String(obj?.status || "");
      const mapped = eventType === "customer.subscription.deleted"
        ? "canceled"
        : (["active","trialing"].includes(stripeStatus) ? "active" : (stripeStatus === "past_due" ? "past_due" : "canceled"));

      const { error } = await admin.from("test_user_subscriptions").update({
        status: mapped,
        current_period_end: periodEndFromSubscription(obj),
        updated_at: new Date().toISOString(),
      }).eq("provider_subscription_id", subId);
      if (error) throw error;
    }

    const { error: eventError } = await admin.from("test_payment_events").insert({
      provider_event_id: eventId,
      event_type: eventType,
      user_id: uuidRe.test(userId || "") ? userId : null,
      payload: { plan_code: planCode, object_id: obj?.id || null },
    });
    if (eventError) throw eventError;

    return new Response("ok", { status: 200 });
  } catch (e:any) {
    console.error("stripe-test-webhook", e?.message || e);
    return new Response(String(e?.message || e), { status: 400 });
  }
});