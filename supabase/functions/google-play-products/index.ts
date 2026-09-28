import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json, preflight, safeErrorCode } from "../_shared/http.ts";
import { adminClient, authenticatedUser } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  try {
    await authenticatedUser(req);
    const { data, error } = await adminClient()
      .from("google_play_products")
      .select("product_id,product_type,entitlement_kind,plan_code,base_plan_id,offer_id,crystal_amount")
      .eq("active", true)
      .order("product_id");
    if (error) throw new Error("GOOGLE_PLAY_CATALOG_UNAVAILABLE");
    return json(req, {
      products: (data ?? []).map((product) => ({
        ...product,
        billing_product_type: product.product_type === "subscription" ? "subs" : "inapp",
      })),
    });
  } catch (error) {
    const code = safeErrorCode(error);
    return json(req, { error: code }, code === "NOT_AUTHENTICATED" ? 401 : 503);
  }
});
