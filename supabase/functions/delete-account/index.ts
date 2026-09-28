import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json, preflight, safeErrorCode } from "../_shared/http.ts";
import { adminClient, authenticatedUser } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== "POST") return json(req, { error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const user = await authenticatedUser(req);
    const body = await req.json();
    if (body?.confirmation !== "DELETE_LEVELING_ACCOUNT") {
      return json(req, { error: "EXPLICIT_CONFIRMATION_REQUIRED" }, 400);
    }

    const admin = adminClient();
    const { data: cleanup, error: cleanupError } = await admin.rpc(
      "delete_leveling_user_data_service",
      { p_user_id: user.id },
    );
    if (cleanupError || cleanup?.ok !== true) throw new Error("ACCOUNT_DATA_CLEANUP_FAILED");

    const { error: authError } = await admin.auth.admin.deleteUser(user.id, false);
    if (authError) throw new Error("ACCOUNT_AUTH_DELETE_FAILED");

    return json(req, {
      ok: true,
      subscription_notice: "Google Play and Stripe subscriptions are not canceled automatically by account deletion.",
    });
  } catch (error) {
    const code = safeErrorCode(error);
    console.warn("[ACCOUNT DELETE] refused", code);
    return json(req, { error: code }, code === "NOT_AUTHENTICATED" ? 401 : 500);
  }
});
