package com.nextlvldigital.levelingapp;

import android.content.Intent;
import android.net.Uri;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryProductDetailsResult;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "LevelingBilling")
public class LevelingBillingPlugin extends Plugin implements PurchasesUpdatedListener {
    private static final String EVENT_PURCHASE_UPDATED = "purchaseUpdated";
    private static final String EVENT_PURCHASES_RESTORED = "purchasesRestored";

    private BillingClient billingClient;
    private boolean connecting = false;
    private final List<PendingAction> connectionQueue = new ArrayList<>();
    private final Map<String, ProductDetails> productCache = new HashMap<>();

    private static final class PendingAction {
        final PluginCall call;
        final Runnable action;

        PendingAction(PluginCall call, Runnable action) {
            this.call = call;
            this.action = action;
        }
    }

    @Override
    public void load() {
        billingClient = BillingClient.newBuilder(getContext())
            .setListener(this)
            .enableAutoServiceReconnection()
            .enablePendingPurchases(
                PendingPurchasesParams.newBuilder().enableOneTimeProducts().build()
            )
            .build();
        connectIfNeeded(null, null);
    }

    private void connectIfNeeded(PluginCall call, Runnable action) {
        if (billingClient == null) {
            if (call != null) call.reject("BILLING_NOT_INITIALIZED");
            return;
        }
        if (billingClient.isReady()) {
            if (action != null) action.run();
            return;
        }
        if (action != null) connectionQueue.add(new PendingAction(call, action));
        if (connecting) return;
        connecting = true;
        billingClient.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult billingResult) {
                connecting = false;
                if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    List<PendingAction> pending = new ArrayList<>(connectionQueue);
                    connectionQueue.clear();
                    for (PendingAction queued : pending) queued.action.run();
                } else {
                    rejectConnectionQueue(billingResult);
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                connecting = false;
            }
        });
    }

    private void rejectConnectionQueue(BillingResult result) {
        List<PendingAction> pending = new ArrayList<>(connectionQueue);
        connectionQueue.clear();
        String message = billingError("BILLING_CONNECTION_FAILED", result);
        for (PendingAction queued : pending) {
            if (queued.call != null) queued.call.reject(message);
        }
    }

    private String billingError(String prefix, BillingResult result) {
        return prefix + ":" + result.getResponseCode() + ":" + result.getDebugMessage();
    }

    @PluginMethod
    public void getProducts(PluginCall call) {
        JSArray requested = call.getArray("products");
        if (requested == null || requested.length() == 0) {
            call.resolve(new JSObject().put("products", new JSArray()));
            return;
        }
        connectIfNeeded(call, () -> queryProducts(call, requested));
    }

    private void queryProducts(PluginCall call, JSArray requested) {
        List<QueryProductDetailsParams.Product> query = new ArrayList<>();
        try {
            for (int index = 0; index < requested.length(); index++) {
                JSONObject item = requested.getJSONObject(index);
                String productId = item.optString("productId", "").trim();
                String productType = item.optString("productType", "").trim();
                if (productId.isEmpty() || (!BillingClient.ProductType.INAPP.equals(productType) && !BillingClient.ProductType.SUBS.equals(productType))) {
                    call.reject("INVALID_PRODUCT_CONFIGURATION");
                    return;
                }
                query.add(QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(productId)
                    .setProductType(productType)
                    .build());
            }
        } catch (Exception error) {
            call.reject("INVALID_PRODUCT_CONFIGURATION", error);
            return;
        }

        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
            .setProductList(query)
            .build();
        billingClient.queryProductDetailsAsync(params, (billingResult, result) -> {
            if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                call.reject(billingError("PRODUCT_QUERY_FAILED", billingResult));
                return;
            }
            JSArray products = new JSArray();
            for (ProductDetails details : result.getProductDetailsList()) {
                productCache.put(details.getProductId(), details);
                products.put(productToJson(details));
            }
            JSObject response = new JSObject();
            response.put("products", products);
            response.put("unfetchedCount", result.getUnfetchedProductList().size());
            call.resolve(response);
        });
    }

    @PluginMethod
    public void purchase(PluginCall call) {
        String productId = call.getString("productId", "").trim();
        String accountId = call.getString("obfuscatedAccountId", "").trim();
        String requestedBasePlan = call.getString("basePlanId", "").trim();
        String requestedOfferId = call.getString("offerId", "").trim();
        String requestedOfferToken = call.getString("offerToken", "").trim();
        if (productId.isEmpty() || accountId.length() != 64) {
            call.reject("INVALID_PURCHASE_REQUEST");
            return;
        }
        connectIfNeeded(call, () -> {
            ProductDetails details = productCache.get(productId);
            if (details == null) {
                call.reject("PRODUCT_NOT_LOADED");
                return;
            }
            String offerToken = selectOfferToken(details, requestedBasePlan, requestedOfferId, requestedOfferToken);
            if (offerToken == null) {
                call.reject("ELIGIBLE_OFFER_NOT_FOUND");
                return;
            }
            BillingFlowParams.ProductDetailsParams.Builder productParams = BillingFlowParams.ProductDetailsParams
                .newBuilder()
                .setProductDetails(details);
            if (!offerToken.isEmpty()) productParams.setOfferToken(offerToken);

            BillingFlowParams flow = BillingFlowParams.newBuilder()
                .setObfuscatedAccountId(accountId)
                .setProductDetailsParamsList(List.of(productParams.build()))
                .build();
            getActivity().runOnUiThread(() -> {
                BillingResult result = billingClient.launchBillingFlow(getActivity(), flow);
                if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    call.resolve(new JSObject().put("launched", true));
                } else {
                    call.reject(billingError("PURCHASE_LAUNCH_FAILED", result));
                }
            });
        });
    }

    private String selectOfferToken(ProductDetails details, String basePlanId, String offerId, String explicitToken) {
        if (!explicitToken.isEmpty()) return explicitToken;
        if (BillingClient.ProductType.SUBS.equals(details.getProductType())) {
            List<ProductDetails.SubscriptionOfferDetails> offers = details.getSubscriptionOfferDetails();
            if (offers == null) return null;
            for (ProductDetails.SubscriptionOfferDetails offer : offers) {
                boolean baseMatches = basePlanId.isEmpty() || basePlanId.equals(offer.getBasePlanId());
                boolean offerMatches = offerId.isEmpty() || offerId.equals(offer.getOfferId());
                if (baseMatches && offerMatches) return offer.getOfferToken();
            }
            return null;
        }

        List<ProductDetails.OneTimePurchaseOfferDetails> offers = details.getOneTimePurchaseOfferDetailsList();
        if (offers != null && !offers.isEmpty()) {
            for (ProductDetails.OneTimePurchaseOfferDetails offer : offers) {
                if (offerId.isEmpty() || offerId.equals(offer.getOfferId())) return offer.getOfferToken();
            }
            return null;
        }
        ProductDetails.OneTimePurchaseOfferDetails legacy = details.getOneTimePurchaseOfferDetails();
        return legacy == null ? null : "";
    }

    @PluginMethod
    public void restorePurchases(PluginCall call) {
        connectIfNeeded(call, () -> queryAllPurchases(call, false));
    }

    @PluginMethod
    public void getPurchaseState(PluginCall call) {
        connectIfNeeded(call, () -> queryAllPurchases(call, false));
    }

    @PluginMethod
    public void openSubscriptionCenter(PluginCall call) {
        try {
            Uri uri = Uri.parse("https://play.google.com/store/account/subscriptions?package=" + getContext().getPackageName());
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            getActivity().startActivity(intent);
            call.resolve(new JSObject().put("opened", true));
        } catch (Exception error) {
            call.reject("SUBSCRIPTION_CENTER_UNAVAILABLE", error);
        }
    }

    private void queryAllPurchases(PluginCall call, boolean notifyOnly) {
        JSArray purchases = new JSArray();
        AtomicInteger remaining = new AtomicInteger(2);
        int[] failureCode = { BillingClient.BillingResponseCode.OK };
        String[] failureMessage = { "" };

        for (String type : List.of(BillingClient.ProductType.INAPP, BillingClient.ProductType.SUBS)) {
            QueryPurchasesParams params = QueryPurchasesParams.newBuilder().setProductType(type).build();
            billingClient.queryPurchasesAsync(params, (billingResult, found) -> {
                if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    for (Purchase purchase : found) purchases.put(purchaseToJson(purchase, type));
                } else {
                    failureCode[0] = billingResult.getResponseCode();
                    failureMessage[0] = billingResult.getDebugMessage();
                }
                if (remaining.decrementAndGet() == 0) {
                    JSObject response = new JSObject();
                    response.put("purchases", purchases);
                    response.put("responseCode", failureCode[0]);
                    response.put("debugMessage", failureMessage[0]);
                    if (notifyOnly) notifyListeners(EVENT_PURCHASES_RESTORED, response, true);
                    else call.resolve(response);
                }
            });
        }
    }

    @Override
    public void onPurchasesUpdated(BillingResult billingResult, List<Purchase> purchases) {
        JSArray serialized = new JSArray();
        if (purchases != null) {
            for (Purchase purchase : purchases) {
                String type = productTypeFromCache(purchase.getProducts());
                serialized.put(purchaseToJson(purchase, type));
            }
        }
        JSObject event = new JSObject();
        event.put("responseCode", billingResult.getResponseCode());
        event.put("debugMessage", billingResult.getDebugMessage());
        event.put("purchases", serialized);
        notifyListeners(EVENT_PURCHASE_UPDATED, event, true);
    }

    private String productTypeFromCache(List<String> productIds) {
        for (String productId : productIds) {
            ProductDetails details = productCache.get(productId);
            if (details != null) return details.getProductType();
        }
        return "unknown";
    }

    private JSObject purchaseToJson(Purchase purchase, String productType) {
        String state = purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED
            ? "purchased"
            : purchase.getPurchaseState() == Purchase.PurchaseState.PENDING
            ? "pending"
            : "unspecified";
        JSObject value = new JSObject();
        value.put("products", new JSArray(purchase.getProducts()));
        value.put("purchaseToken", purchase.getPurchaseToken());
        value.put("orderId", purchase.getOrderId());
        value.put("purchaseTime", purchase.getPurchaseTime());
        value.put("purchaseState", state);
        value.put("acknowledged", purchase.isAcknowledged());
        value.put("autoRenewing", purchase.isAutoRenewing());
        value.put("productType", productType);
        return value;
    }

    private JSObject productToJson(ProductDetails details) {
        JSObject value = new JSObject();
        value.put("productId", details.getProductId());
        value.put("productType", details.getProductType());
        value.put("name", details.getName());
        value.put("title", details.getTitle());
        value.put("description", details.getDescription());
        JSArray offers = new JSArray();
        if (BillingClient.ProductType.SUBS.equals(details.getProductType())) {
            List<ProductDetails.SubscriptionOfferDetails> subscriptionOffers = details.getSubscriptionOfferDetails();
            if (subscriptionOffers != null) {
                for (ProductDetails.SubscriptionOfferDetails offer : subscriptionOffers) {
                    JSObject serialized = new JSObject();
                    serialized.put("basePlanId", offer.getBasePlanId());
                    serialized.put("offerId", offer.getOfferId());
                    serialized.put("offerToken", offer.getOfferToken());
                    JSArray phases = new JSArray();
                    for (ProductDetails.PricingPhase phase : offer.getPricingPhases().getPricingPhaseList()) {
                        phases.put(new JSObject()
                            .put("formattedPrice", phase.getFormattedPrice())
                            .put("priceAmountMicros", phase.getPriceAmountMicros())
                            .put("priceCurrencyCode", phase.getPriceCurrencyCode())
                            .put("billingPeriod", phase.getBillingPeriod())
                            .put("billingCycleCount", phase.getBillingCycleCount())
                            .put("recurrenceMode", phase.getRecurrenceMode()));
                    }
                    serialized.put("pricingPhases", phases);
                    offers.put(serialized);
                }
            }
        } else {
            List<ProductDetails.OneTimePurchaseOfferDetails> oneTimeOffers = details.getOneTimePurchaseOfferDetailsList();
            if (oneTimeOffers != null && !oneTimeOffers.isEmpty()) {
                for (ProductDetails.OneTimePurchaseOfferDetails offer : oneTimeOffers) {
                    offers.put(oneTimeOfferToJson(offer));
                }
            } else if (details.getOneTimePurchaseOfferDetails() != null) {
                ProductDetails.OneTimePurchaseOfferDetails offer = details.getOneTimePurchaseOfferDetails();
                offers.put(new JSObject()
                    .put("formattedPrice", offer.getFormattedPrice())
                    .put("priceAmountMicros", offer.getPriceAmountMicros())
                    .put("priceCurrencyCode", offer.getPriceCurrencyCode()));
            }
        }
        value.put("offers", offers);
        return value;
    }

    private JSObject oneTimeOfferToJson(ProductDetails.OneTimePurchaseOfferDetails offer) {
        return new JSObject()
            .put("purchaseOptionId", offer.getPurchaseOptionId())
            .put("offerId", offer.getOfferId())
            .put("offerToken", offer.getOfferToken())
            .put("formattedPrice", offer.getFormattedPrice())
            .put("priceAmountMicros", offer.getPriceAmountMicros())
            .put("priceCurrencyCode", offer.getPriceCurrencyCode());
    }

    @Override
    protected void handleOnResume() {
        connectIfNeeded(null, () -> queryAllPurchases(null, true));
    }

    @Override
    protected void handleOnDestroy() {
        if (billingClient != null && billingClient.isReady()) billingClient.endConnection();
        billingClient = null;
    }
}
