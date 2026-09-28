import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

const ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const API_ROOT = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

export type GooglePlayProduct = {
  product_id: string;
  product_type: "subscription" | "one_time" | "consumable";
  entitlement_kind: "subscription" | "lifetime" | "crystals";
  plan_code: string | null;
  base_plan_id: string | null;
  offer_id: string | null;
  crystal_amount: number;
  active: boolean;
};

type VerifiedPurchase = {
  entitled: boolean;
  purchaseState: string;
  entitlementStatus: string;
  acknowledged: boolean;
  consumed: boolean;
  orderId: string | null;
  purchasedAt: string | null;
  expiresAt: string | null;
  obfuscatedAccountId: string | null;
  sanitized: Record<string, unknown>;
};

let cachedAccessToken = "";
let cachedAccessTokenExpiresAt = 0;

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}

function base64Url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemBytes(pem: string): Uint8Array {
  const binary = atob(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, ""));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function serviceAccount(): ServiceAccount {
  let parsed: ServiceAccount;
  try {
    parsed = JSON.parse(requiredEnv("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"));
  } catch {
    throw new Error("INVALID_GOOGLE_PLAY_SERVICE_ACCOUNT_JSON");
  }
  if (!parsed.client_email || !parsed.private_key) throw new Error("INVALID_GOOGLE_PLAY_SERVICE_ACCOUNT_JSON");
  return parsed;
}

async function googleAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessTokenExpiresAt > Date.now() + 60_000) return cachedAccessToken;
  const account = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: ANDROID_PUBLISHER_SCOPE,
    aud: account.token_uri ?? TOKEN_ENDPOINT,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch(account.token_uri ?? TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error(`GOOGLE_OAUTH_${response.status}`);
  cachedAccessToken = String(body.access_token);
  cachedAccessTokenExpiresAt = Date.now() + Math.max(60, Number(body.expires_in ?? 3600)) * 1000;
  return cachedAccessToken;
}

async function googleJson(url: string, init: RequestInit = {}): Promise<Record<string, any>> {
  const token = await googleAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: Record<string, any> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!response.ok) {
    const reason = String(body?.error?.status ?? body?.error?.message ?? response.status).slice(0, 80);
    throw new Error(`GOOGLE_PLAY_API_${response.status}_${reason}`);
  }
  return body;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function loadProduct(admin: SupabaseClient, productId: string): Promise<GooglePlayProduct> {
  const { data, error } = await admin
    .from("google_play_products")
    .select("product_id,product_type,entitlement_kind,plan_code,base_plan_id,offer_id,crystal_amount,active")
    .eq("product_id", productId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error("GOOGLE_PLAY_PRODUCT_LOOKUP_FAILED");
  if (!data) throw new Error("GOOGLE_PLAY_PRODUCT_NOT_CONFIGURED");
  return data as GooglePlayProduct;
}

function packageName(): string {
  return Deno.env.get("GOOGLE_PLAY_PACKAGE_NAME") ?? "com.nextlvldigital.levelingapp";
}

async function verifySubscription(productId: string, purchaseToken: string): Promise<VerifiedPurchase> {
  const url = `${API_ROOT}/${encodeURIComponent(packageName())}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const body = await googleJson(url);
  const state = String(body.subscriptionState ?? "SUBSCRIPTION_STATE_UNSPECIFIED");
  const lineItems = Array.isArray(body.lineItems) ? body.lineItems : [];
  const expiresAt = lineItems
    .map((item: Record<string, unknown>) => String(item.expiryTime ?? ""))
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
  const productMatches = lineItems.some((item: Record<string, unknown>) => String(item.productId ?? "") === productId);
  if (!productMatches) throw new Error("GOOGLE_PLAY_PRODUCT_MISMATCH");
  const entitled = [
    "SUBSCRIPTION_STATE_ACTIVE",
    "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
    "SUBSCRIPTION_STATE_CANCELED",
  ].includes(state) && (!expiresAt || Date.parse(expiresAt) > Date.now());
  const status = state === "SUBSCRIPTION_STATE_ON_HOLD"
    ? "on_hold"
    : state === "SUBSCRIPTION_STATE_EXPIRED"
    ? "expired"
    : state === "SUBSCRIPTION_STATE_PAUSED"
    ? "paused"
    : state === "SUBSCRIPTION_STATE_PENDING"
    ? "pending"
    : entitled
    ? "active"
    : "inactive";
  const acknowledged = String(body.acknowledgementState ?? "") === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED";
  const obfuscatedAccountId = body.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null;
  return {
    entitled,
    purchaseState: state,
    entitlementStatus: status,
    acknowledged,
    consumed: false,
    orderId: body.latestOrderId ? String(body.latestOrderId) : null,
    purchasedAt: body.startTime ? String(body.startTime) : null,
    expiresAt,
    obfuscatedAccountId: obfuscatedAccountId ? String(obfuscatedAccountId) : null,
    sanitized: {
      subscriptionState: state,
      acknowledgementState: body.acknowledgementState ?? null,
      latestOrderId: body.latestOrderId ?? null,
      startTime: body.startTime ?? null,
      expiresAt,
      regionCode: body.regionCode ?? null,
      testPurchase: body.testPurchase ?? null,
    },
  };
}

async function verifyOneTime(productId: string, purchaseToken: string): Promise<VerifiedPurchase> {
  const url = `${API_ROOT}/${encodeURIComponent(packageName())}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
  const body = await googleJson(url);
  const stateValue = body.purchaseState;
  const state = stateValue === 0 || stateValue === "PURCHASED"
    ? "purchased"
    : stateValue === 2 || stateValue === "PENDING"
    ? "pending"
    : "canceled";
  const acknowledged = body.acknowledgementState === 1 || body.acknowledgementState === "ACKNOWLEDGED";
  const consumed = body.consumptionState === 1 || body.consumptionState === "CONSUMED";
  const purchasedAt = body.purchaseTimeMillis
    ? new Date(Number(body.purchaseTimeMillis)).toISOString()
    : null;
  return {
    entitled: state === "purchased",
    purchaseState: state,
    entitlementStatus: state,
    acknowledged,
    consumed,
    orderId: body.orderId ? String(body.orderId) : null,
    purchasedAt,
    expiresAt: null,
    obfuscatedAccountId: body.obfuscatedExternalAccountId ? String(body.obfuscatedExternalAccountId) : null,
    sanitized: {
      purchaseState: body.purchaseState ?? null,
      consumptionState: body.consumptionState ?? null,
      acknowledgementState: body.acknowledgementState ?? null,
      orderId: body.orderId ?? null,
      purchaseTimeMillis: body.purchaseTimeMillis ?? null,
      purchaseType: body.purchaseType ?? null,
      regionCode: body.regionCode ?? null,
    },
  };
}

async function settleWithGoogle(
  product: GooglePlayProduct,
  purchaseToken: string,
  verified: VerifiedPurchase,
): Promise<{ acknowledged: boolean; consumed: boolean; pending: boolean }> {
  if (!verified.entitled) {
    return { acknowledged: verified.acknowledged, consumed: verified.consumed, pending: false };
  }
  const base = `${API_ROOT}/${encodeURIComponent(packageName())}/purchases`;
  if (product.product_type === "consumable") {
    if (!verified.consumed) {
      await googleJson(
        `${base}/products/${encodeURIComponent(product.product_id)}/tokens/${encodeURIComponent(purchaseToken)}:consume`,
        { method: "POST", body: "{}" },
      );
    }
    return { acknowledged: true, consumed: true, pending: false };
  }
  if (!verified.acknowledged) {
    const kind = product.product_type === "subscription" ? "subscriptions" : "products";
    await googleJson(
      `${base}/${kind}/${encodeURIComponent(product.product_id)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
      { method: "POST", body: "{}" },
    );
  }
  return { acknowledged: true, consumed: verified.consumed, pending: false };
}

async function updateSubscription(
  admin: SupabaseClient,
  userId: string,
  product: GooglePlayProduct,
  tokenHash: string,
  verified: VerifiedPurchase,
): Promise<void> {
  const providerSubscriptionId = `gp:${tokenHash}`;
  const { data: existing, error: findError } = await admin
    .from("user_subscriptions")
    .select("id")
    .eq("provider", "google_play")
    .eq("provider_subscription_id", providerSubscriptionId)
    .maybeSingle();
  if (findError) throw new Error("GOOGLE_PLAY_SUBSCRIPTION_LOOKUP_FAILED");
  const lifetime = product.entitlement_kind === "lifetime";
  const values = {
    user_id: userId,
    plan_code: product.plan_code,
    status: verified.entitled ? (lifetime ? "lifetime" : "active") : verified.entitlementStatus,
    provider: "google_play",
    provider_customer_id: null,
    provider_subscription_id: providerSubscriptionId,
    current_period_end: lifetime ? null : verified.expiresAt,
    canceled_at: verified.purchaseState === "SUBSCRIPTION_STATE_CANCELED" ? new Date().toISOString() : null,
    metadata: {
      product_id: product.product_id,
      base_plan_id: product.base_plan_id,
      offer_id: product.offer_id,
      purchase_state: verified.purchaseState,
      order_id: verified.orderId,
    },
    updated_at: new Date().toISOString(),
  };
  const query = existing?.id
    ? admin.from("user_subscriptions").update(values).eq("id", existing.id)
    : admin.from("user_subscriptions").insert({ ...values, started_at: verified.purchasedAt ?? new Date().toISOString() });
  const { error } = await query;
  if (error) throw new Error("GOOGLE_PLAY_SUBSCRIPTION_WRITE_FAILED");
}

export async function verifyAndApplyPurchase(
  admin: SupabaseClient,
  input: {
    userId: string;
    productId: string;
    purchaseToken: string;
    purchaseType: string;
  },
): Promise<Record<string, unknown>> {
  const product = await loadProduct(admin, input.productId);
  if (product.product_type !== input.purchaseType) throw new Error("GOOGLE_PLAY_PRODUCT_TYPE_MISMATCH");
  const tokenHash = await sha256Hex(input.purchaseToken);
  const expectedAccountId = await sha256Hex(input.userId);
  const verified = product.product_type === "subscription"
    ? await verifySubscription(product.product_id, input.purchaseToken)
    : await verifyOneTime(product.product_id, input.purchaseToken);
  if (verified.obfuscatedAccountId !== expectedAccountId) throw new Error("GOOGLE_PLAY_ACCOUNT_MISMATCH");

  const now = new Date().toISOString();
  const { error: receiptError } = await admin.from("google_play_purchase_receipts").upsert({
    user_id: input.userId,
    product_id: product.product_id,
    purchase_token_hash: tokenHash,
    provider_order_id: verified.orderId,
    purchase_type: product.product_type,
    entitlement_kind: product.entitlement_kind,
    purchase_state: verified.purchaseState,
    entitlement_status: verified.entitlementStatus,
    acknowledged: verified.acknowledged,
    consumed: verified.consumed,
    purchased_at: verified.purchasedAt,
    expires_at: verified.expiresAt,
    verified_payload: verified.sanitized,
    last_verified_at: now,
    updated_at: now,
  }, { onConflict: "purchase_token_hash,product_id" });
  if (receiptError) throw new Error("GOOGLE_PLAY_RECEIPT_WRITE_FAILED");

  if (product.entitlement_kind === "crystals" && verified.entitled) {
    const { error } = await admin.rpc("grant_crystals_service", {
      p_user_id: input.userId,
      p_amount: product.crystal_amount,
      p_reason: "google_play_purchase",
      p_external_ref: `google-play:${tokenHash}:${product.product_id}`,
      p_metadata: { product_id: product.product_id, order_id: verified.orderId },
    });
    if (error) throw new Error("GOOGLE_PLAY_CRYSTAL_GRANT_FAILED");
  } else if (product.entitlement_kind !== "crystals") {
    await updateSubscription(admin, input.userId, product, tokenHash, verified);
  }

  let settlementPending = false;
  let acknowledged = verified.acknowledged;
  let consumed = verified.consumed;
  if (verified.entitled) {
    try {
      const settlement = await settleWithGoogle(product, input.purchaseToken, verified);
      acknowledged = settlement.acknowledged;
      consumed = settlement.consumed;
    } catch (error) {
      settlementPending = true;
      console.warn("[PLAY BILLING] settlement pending", error instanceof Error ? error.message : "unknown");
    }
  }

  const finalStatus = product.entitlement_kind === "crystals" && verified.entitled
    ? "credited"
    : verified.entitlementStatus;
  const { error: finalReceiptError } = await admin
    .from("google_play_purchase_receipts")
    .update({
      entitlement_status: finalStatus,
      acknowledged,
      consumed,
      updated_at: new Date().toISOString(),
    })
    .eq("purchase_token_hash", tokenHash)
    .eq("product_id", product.product_id);
  if (finalReceiptError) throw new Error("GOOGLE_PLAY_RECEIPT_FINALIZE_FAILED");

  return {
    ok: true,
    product_id: product.product_id,
    entitlement_kind: product.entitlement_kind,
    purchase_state: verified.purchaseState,
    entitled: verified.entitled,
    settlement_pending: settlementPending,
    acknowledged,
    consumed,
  };
}

export async function revokePurchase(
  admin: SupabaseClient,
  purchaseToken: string,
  orderId: string | null,
): Promise<Record<string, unknown>> {
  const tokenHash = await sha256Hex(purchaseToken);
  const { data: receipt, error } = await admin
    .from("google_play_purchase_receipts")
    .select("user_id,product_id,entitlement_kind,purchase_token_hash")
    .eq("purchase_token_hash", tokenHash)
    .maybeSingle();
  if (error) throw new Error("GOOGLE_PLAY_RECEIPT_LOOKUP_FAILED");
  if (!receipt) return { ok: true, ignored: true, reason: "receipt_not_found" };

  if (receipt.user_id && receipt.entitlement_kind === "crystals") {
    const product = await loadProduct(admin, receipt.product_id);
    const { error: revokeError } = await admin.rpc("revoke_google_play_crystals_service", {
      p_user_id: receipt.user_id,
      p_amount: product.crystal_amount,
      p_external_ref: `google-play:refund:${tokenHash}:${receipt.product_id}`,
      p_metadata: { product_id: receipt.product_id, order_id: orderId },
    });
    if (revokeError) throw new Error("GOOGLE_PLAY_CRYSTAL_REVOCATION_FAILED");
  } else if (receipt.user_id) {
    const { error: subscriptionError } = await admin
      .from("user_subscriptions")
      .update({ status: "revoked", current_period_end: new Date().toISOString(), canceled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("provider", "google_play")
      .eq("provider_subscription_id", `gp:${tokenHash}`);
    if (subscriptionError) throw new Error("GOOGLE_PLAY_SUBSCRIPTION_REVOCATION_FAILED");
  }

  const { error: receiptError } = await admin
    .from("google_play_purchase_receipts")
    .update({ purchase_state: "voided", entitlement_status: "revoked", updated_at: new Date().toISOString() })
    .eq("purchase_token_hash", tokenHash);
  if (receiptError) throw new Error("GOOGLE_PLAY_RECEIPT_REVOCATION_FAILED");
  return { ok: true, revoked: true };
}
