import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json, safeErrorCode } from "../_shared/http.ts";
import { revokePurchase, sha256Hex, verifyAndApplyPurchase } from "../_shared/google-play.ts";
import { adminClient } from "../_shared/supabase.ts";

async function verifyPushIdentity(req: Request): Promise<void> {
  const bearer = req.headers.get("authorization") ?? "";
  if (!bearer.toLowerCase().startsWith("bearer ")) throw new Error("RTDN_NOT_AUTHENTICATED");
  const audience = Deno.env.get("GOOGLE_PLAY_RTDN_AUDIENCE");
  const expectedEmail = Deno.env.get("GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL");
  if (!audience || !expectedEmail) throw new Error("RTDN_IDENTITY_NOT_CONFIGURED");
  const token = bearer.slice(7).trim();
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
  const identity = await response.json();
  if (!response.ok) throw new Error("RTDN_INVALID_ID_TOKEN");
  if (String(identity.aud ?? "") !== audience) throw new Error("RTDN_INVALID_AUDIENCE");
  if (String(identity.email ?? "").toLowerCase() !== expectedEmail.toLowerCase()) throw new Error("RTDN_INVALID_EMAIL");
  if (String(identity.email_verified ?? "").toLowerCase() !== "true") throw new Error("RTDN_EMAIL_NOT_VERIFIED");
}

function decodeMessage(value: string): Record<string, any> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(req, { error: "METHOD_NOT_ALLOWED" }, 405);
  let messageId = "";
  try {
    await verifyPushIdentity(req);
    const envelope = await req.json();
    messageId = String(envelope?.message?.messageId ?? envelope?.message?.message_id ?? "").trim();
    const encoded = String(envelope?.message?.data ?? "").trim();
    if (!messageId || !encoded) throw new Error("RTDN_INVALID_MESSAGE");
    const notification = decodeMessage(encoded);
    if (String(notification.packageName ?? "") !== (Deno.env.get("GOOGLE_PLAY_PACKAGE_NAME") ?? "com.nextlvldigital.levelingapp")) {
      throw new Error("RTDN_PACKAGE_MISMATCH");
    }

    const subscription = notification.subscriptionNotification;
    const oneTime = notification.oneTimeProductNotification;
    const voided = notification.voidedPurchaseNotification;
    const purchaseToken = String(subscription?.purchaseToken ?? oneTime?.purchaseToken ?? voided?.purchaseToken ?? "");
    const productId = String(subscription?.subscriptionId ?? oneTime?.sku ?? "") || null;
    if (!purchaseToken) throw new Error("RTDN_PURCHASE_TOKEN_MISSING");
    const tokenHash = await sha256Hex(purchaseToken);
    const notificationType = voided
      ? `voided:${String(voided.notificationType ?? voided.refundType ?? "unknown")}`
      : subscription
      ? `subscription:${String(subscription.notificationType ?? "unknown")}`
      : oneTime
      ? `one_time:${String(oneTime.notificationType ?? "unknown")}`
      : "unknown";

    const admin = adminClient();
    const { error: eventError } = await admin.from("google_play_rtdn_events").insert({
      message_id: messageId,
      notification_type: notificationType,
      product_id: productId,
      purchase_token_hash: tokenHash,
      status: "received",
    });
    if (eventError) {
      if (eventError.code === "23505") {
        const { data: existing, error: existingError } = await admin
          .from("google_play_rtdn_events")
          .select("status")
          .eq("message_id", messageId)
          .maybeSingle();
        if (existingError) throw new Error("RTDN_EVENT_LOOKUP_FAILED");
        if (["processed", "ignored"].includes(String(existing?.status ?? ""))) {
          return json(req, { ok: true, duplicate: true });
        }
        const { error: retryError } = await admin.from("google_play_rtdn_events").update({
          status: "received",
          error_code: null,
          processed_at: null,
        }).eq("message_id", messageId);
        if (retryError) throw new Error("RTDN_EVENT_RETRY_FAILED");
      } else {
        throw new Error("RTDN_EVENT_WRITE_FAILED");
      }
    }

    let result: Record<string, unknown>;
    if (voided) {
      result = await revokePurchase(admin, purchaseToken, voided.orderId ? String(voided.orderId) : null);
    } else {
      const { data: receipts, error: receiptError } = await admin
        .from("google_play_purchase_receipts")
        .select("user_id,product_id,purchase_type")
        .eq("purchase_token_hash", tokenHash)
        .limit(1);
      if (receiptError) throw new Error("RTDN_RECEIPT_LOOKUP_FAILED");
      const receipt = receipts?.[0];
      if (!receipt?.user_id) {
        result = { ok: true, ignored: true, reason: "unlinked_purchase" };
      } else {
        result = await verifyAndApplyPurchase(admin, {
          userId: receipt.user_id,
          productId: productId ?? receipt.product_id,
          purchaseToken,
          purchaseType: receipt.purchase_type,
        });
      }
    }

    await admin.from("google_play_rtdn_events").update({
      status: result.ignored ? "ignored" : "processed",
      processed_at: new Date().toISOString(),
    }).eq("message_id", messageId);
    return json(req, { ok: true });
  } catch (error) {
    const code = safeErrorCode(error);
    console.warn("[PLAY BILLING] RTDN refused", code);
    if (messageId) {
      try {
        await adminClient().from("google_play_rtdn_events").update({
          status: "failed",
          error_code: code,
          processed_at: new Date().toISOString(),
        }).eq("message_id", messageId);
      } catch {
        // Preserve the original failure and never log the notification payload.
      }
    }
    return json(req, { error: code }, code.startsWith("RTDN_NOT_") || code.startsWith("RTDN_INVALID_") ? 401 : 500);
  }
});
