import { Capacitor, registerPlugin } from '@capacitor/core';

const NativeBilling = registerPlugin('LevelingBilling');
const runtime = {
  ready: false,
  syncing: false,
  catalog: [],
  products: [],
  lastReason: 'not_initialized',
};

function isNativeAndroid() {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

function diagnostic(reason, detail = '') {
  runtime.lastReason = String(reason || 'unknown');
  console.info(`[LEVELING BILLING] ${runtime.lastReason}${detail ? ` · ${String(detail).slice(0, 140)}` : ''}`);
  window.dispatchEvent(new CustomEvent('leveling-billing-status', { detail: status() }));
  if (runtime.ready) {
    try { window.v1612RenderSubscription?.(); } catch {}
  }
}

function status() {
  return {
    nativeAndroid: isNativeAndroid(),
    ready: runtime.ready,
    syncing: runtime.syncing,
    catalogCount: runtime.catalog.length,
    productCount: runtime.products.length,
    lastReason: runtime.lastReason,
  };
}

async function session() {
  const client = window.sb;
  if (!client) throw new Error('SUPABASE_NOT_READY');
  const { data, error } = await client.auth.getSession();
  if (error || !data?.session?.access_token || !data.session.user?.id) throw new Error('NOT_AUTHENTICATED');
  return data.session;
}

async function callFunction(slug, payload = null, method = 'POST') {
  const activeSession = await session();
  const client = window.sb;
  const supabaseUrl = String(client?.supabaseUrl || '').replace(/\/$/, '');
  const publishableKey = String(client?.supabaseKey || '');
  if (!supabaseUrl || !publishableKey) throw new Error('SUPABASE_CONFIG_NOT_READY');
  const response = await fetch(`${supabaseUrl}/functions/v1/${slug}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${activeSession.access_token}`,
      'apikey': publishableKey,
    },
    body: payload == null ? undefined : JSON.stringify(payload),
  });
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok) throw new Error(body?.error || `${slug.toUpperCase().replaceAll('-', '_')}_${response.status}`);
  return body;
}

async function accountHash(userId) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(userId)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function configForPurchase(purchase) {
  const ids = Array.isArray(purchase?.products) ? purchase.products : [];
  return runtime.catalog.find(item => ids.includes(item.product_id));
}

async function verifyPurchase(purchase) {
  const config = configForPurchase(purchase);
  if (!config || !purchase?.purchaseToken) {
    diagnostic('purchase_not_configured');
    return false;
  }
  try {
    const result = await callFunction('google-play-verify-purchase', {
      product_id: config.product_id,
      purchase_token: purchase.purchaseToken,
      purchase_type: config.product_type,
    });
    diagnostic(result.entitled ? 'purchase_verified' : `purchase_${result.purchase_state || 'not_entitled'}`, config.product_id);
    if (result.entitled) {
      await window.v1647RefreshAccessAfterExternalReturn?.();
      await window.LevelingCrystalShop?.refresh?.(true);
    }
    return result.entitled === true;
  } catch (error) {
    diagnostic('verification_failed', error?.message || error);
    return false;
  }
}

async function processPurchases(purchases) {
  let verified = 0;
  for (const purchase of Array.isArray(purchases) ? purchases : []) {
    if (purchase?.purchaseState === 'purchased' || purchase?.purchaseState === 'pending') {
      if (await verifyPurchase(purchase)) verified += 1;
    }
  }
  return verified;
}

async function initialize() {
  if (!isNativeAndroid()) return false;
  if (runtime.ready) return true;
  if (runtime.syncing) return false;
  runtime.syncing = true;
  try {
    const catalogResponse = await callFunction('google-play-products', {});
    runtime.catalog = Array.isArray(catalogResponse?.products) ? catalogResponse.products : [];
    if (!runtime.catalog.length) {
      runtime.ready = false;
      diagnostic('catalog_empty');
      return false;
    }
    const productResponse = await NativeBilling.getProducts({
      products: runtime.catalog.map(item => ({
        productId: item.product_id,
        productType: item.billing_product_type,
      })),
    });
    runtime.products = Array.isArray(productResponse?.products) ? productResponse.products : [];
    runtime.ready = runtime.products.length > 0;
    diagnostic(runtime.ready ? 'ready' : 'products_unavailable', `${runtime.products.length}/${runtime.catalog.length}`);
    if (runtime.ready) await restorePurchases();
    return runtime.ready;
  } catch (error) {
    runtime.ready = false;
    diagnostic('initialization_failed', error?.message || error);
    return false;
  } finally {
    runtime.syncing = false;
  }
}

async function purchase(productId) {
  if (!isNativeAndroid()) return false;
  if (!runtime.ready && !(await initialize())) return false;
  const activeSession = await session();
  const config = runtime.catalog.find(item => item.product_id === productId);
  const product = runtime.products.find(item => item.productId === productId);
  if (!config || !product) throw new Error('PRODUCT_NOT_AVAILABLE');
  const result = await NativeBilling.purchase({
    productId,
    basePlanId: config.base_plan_id || '',
    offerId: config.offer_id || '',
    obfuscatedAccountId: await accountHash(activeSession.user.id),
  });
  diagnostic(result?.launched ? 'purchase_flow_launched' : 'purchase_flow_refused', productId);
  return result?.launched === true;
}

function planCodeForCard(planId) {
  return ({ '4w': 'month', '1y': '1y', life: 'lifetime' })[String(planId)] || String(planId || '');
}

async function purchasePlan(planId) {
  if (!runtime.ready && !(await initialize())) {
    throw new Error('GOOGLE_PLAY_PRODUCTS_NOT_CONFIGURED');
  }
  const planCode = planCodeForCard(planId);
  const config = runtime.catalog.find(item => item.plan_code === planCode && ['subscription', 'lifetime'].includes(item.entitlement_kind));
  if (!config) throw new Error('GOOGLE_PLAY_PLAN_NOT_CONFIGURED');
  return purchase(config.product_id);
}

async function purchaseCrystals(productId) {
  const config = runtime.catalog.find(item => item.product_id === productId && item.entitlement_kind === 'crystals');
  if (!config) throw new Error('GOOGLE_PLAY_CRYSTAL_PRODUCT_NOT_CONFIGURED');
  return purchase(config.product_id);
}

function priceForPlan(planId) {
  const planCode = planCodeForCard(planId);
  const config = runtime.catalog.find(item => item.plan_code === planCode && ['subscription', 'lifetime'].includes(item.entitlement_kind));
  const product = runtime.products.find(item => item.productId === config?.product_id);
  const offers = Array.isArray(product?.offers) ? product.offers : [];
  const matching = offers.find(offer =>
    (!config?.base_plan_id || offer.basePlanId === config.base_plan_id) &&
    (!config?.offer_id || offer.offerId === config.offer_id)
  ) || offers[0];
  const phases = Array.isArray(matching?.pricingPhases) ? matching.pricingPhases : [];
  return phases.at(-1)?.formattedPrice || matching?.formattedPrice || '';
}

async function restorePurchases() {
  if (!isNativeAndroid()) return 0;
  const result = await NativeBilling.restorePurchases();
  const verified = await processPurchases(result?.purchases);
  diagnostic('restore_complete', `${verified} verified`);
  return verified;
}

async function openSubscriptionCenter() {
  if (!isNativeAndroid()) return false;
  const result = await NativeBilling.openSubscriptionCenter();
  return result?.opened === true;
}

async function onPurchaseEvent(event) {
  if (Number(event?.responseCode) === 1) {
    diagnostic('purchase_canceled');
    return;
  }
  if (Number(event?.responseCode) !== 0) {
    diagnostic('purchase_update_failed', event?.debugMessage || event?.responseCode);
    return;
  }
  await processPurchases(event?.purchases);
}

NativeBilling.addListener('purchaseUpdated', onPurchaseEvent);
NativeBilling.addListener('purchasesRestored', event => processPurchases(event?.purchases));

window.LevelingBilling = Object.freeze({
  isNativeAndroid,
  initialize,
  purchase,
  purchasePlan,
  purchaseCrystals,
  priceForPlan,
  restorePurchases,
  getPurchaseState: restorePurchases,
  openSubscriptionCenter,
  status,
});

window.addEventListener('leveling-access-changed', () => {
  if (isNativeAndroid() && !runtime.syncing) initialize();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isNativeAndroid() && runtime.ready) restorePurchases();
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(initialize, 0), { once: true });
} else {
  setTimeout(initialize, 0);
}
