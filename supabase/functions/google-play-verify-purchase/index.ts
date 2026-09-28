import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json, preflight, safeErrorCode } from "../_shared/http.ts";
import { verifyAndApplyPurchase } from "../_shared/google-play.ts";
import { adminClient, authenticatedUser } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== "POST") return json(req, { error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const user = await authenticatedUser(req);
    const body = await req.json();
    const productId = String(body?.product_id ?? "").trim();
    const purchaseToken = String(body?.purchase_token ?? "").trim();
    const purchaseType = String(body?.purchase_type ?? "").trim();
    if (!productId || productId.length > 200) throw new Error("INVALID_PRODUCT_ID");
    if (!purchaseToken || purchaseToken.length > 4096) throw new Error("INVALID_PURCHASE_TOKEN");
    if (!["subscription", "one_time", "consumable"].includes(purchaseType)) {
      throw new Error("INVALID_PURCHASE_TYPE");
    }

    const result = await verifyAndApplyPurchase(adminClient(), {
      userId: user.id,
      productId,
      purchaseToken,
      purchaseType,
    });
    return json(req, result);
  } catch (error) {
    const code = safeErrorCode(error);
    console.warn("[PLAY BILLING] verification refused", code);
    const status = code === "NOT_AUTHENTICATED"
      ? 401
      : code.startsWith("INVALID_") || code.includes("MISMATCH") || code.includes("NOT_CONFIGURED")
      ? 400
      : code.startsWith("MISSING_GOOGLE") || code.startsWith("INVALID_GOOGLE_PLAY_SERVICE")
      ? 503
      : 502;
    return json(req, { error: code }, status);
  }
});
