import { Capacitor } from '@capacitor/core';
import './native-billing.js';
import {
  AdMob,
  AdmobConsentStatus,
  InterstitialAdPluginEvents,
  MaxAdContentRating,
  RewardAdPluginEvents,
} from '@capacitor-community/admob';

const ADS_MODE = __LEVELING_ADS_MODE__;
const IS_PRODUCTION = ADS_MODE === 'production';
const DAILY_REWARDED_LIMIT = 3;
const REWARD_CRYSTALS = 10;
const BACKOFF_MS = [15_000, 30_000, 60_000, 120_000];
const AD_IDS = Object.freeze({
  rewarded: __LEVELING_REWARDED_AD_ID__,
  interstitial: __LEVELING_INTERSTITIAL_AD_ID__,
});

const runtime = {
  initialized: false,
  canRequestAds: false,
  consentStatus: 'UNKNOWN',
  privacyOptionsRequired: false,
  listenersReady: false,
  rewardedReady: false,
  rewardedLoading: false,
  rewardedShowing: false,
  interstitialReady: false,
  interstitialLoading: false,
  interstitialShowing: false,
  rewardFailures: 0,
  interstitialFailures: 0,
  rewardRequest: null,
  interstitialRequest: null,
  lastRewardedReason: 'idle',
  lastInterstitialReason: 'idle',
  lastConsentReason: 'not_initialized',
};

let initializePromise = null;
let listenersPromise = null;
let rewardReloadTimer = 0;
let interstitialReloadTimer = 0;

function isNativeAndroid() {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

function isForeground() {
  return document.visibilityState === 'visible';
}

function accessInfo() {
  return window.getLevelingAccessInfo?.() || {};
}

function hasAuthenticatedUser() {
  return userId() !== 'anonymous';
}

function rewardedAccessAllowed({ includeQuota = true } = {}) {
  if (!hasAuthenticatedUser()) return false;
  if (!includeQuota) return true;
  const remaining = Number(window.LevelingRewardedAdsV2141?.status?.()?.remaining);
  return !Number.isFinite(remaining) || remaining > 0;
}

function interstitialAccessAllowed() {
  const info = window.getLevelingAccessInfo?.();
  const state = String(info?.access_state || 'UNKNOWN').toUpperCase();
  return ['TRIAL', 'PASS', 'FREE'].includes(state) && info?.ad_supported === true;
}

function diagnostic(kind, reason, detail = '') {
  const normalized = String(reason || 'unknown');
  if (kind === 'rewarded') runtime.lastRewardedReason = normalized;
  else if (kind === 'interstitial') runtime.lastInterstitialReason = normalized;
  else runtime.lastConsentReason = normalized;
  const suffix = detail ? ` · ${String(detail).slice(0, 160)}` : '';
  console.info(`[LEVELING ADS] ${kind}: ${normalized}${suffix}`);
  emitStatus();
  return false;
}

function status() {
  return {
    mode: ADS_MODE,
    nativeAndroid: isNativeAndroid(),
    initialized: runtime.initialized,
    canRequestAds: runtime.canRequestAds,
    consentStatus: runtime.consentStatus,
    privacyOptionsRequired: runtime.privacyOptionsRequired,
    rewardedReady: runtime.rewardedReady,
    rewardedLoading: runtime.rewardedLoading,
    rewardedShowing: runtime.rewardedShowing,
    interstitialReady: runtime.interstitialReady,
    interstitialLoading: runtime.interstitialLoading,
    interstitialShowing: runtime.interstitialShowing,
    lastRewardedReason: runtime.lastRewardedReason,
    lastInterstitialReason: runtime.lastInterstitialReason,
    lastConsentReason: runtime.lastConsentReason,
    rewardedLimit: DAILY_REWARDED_LIMIT,
    rewardCrystals: REWARD_CRYSTALS,
  };
}

function emitStatus() {
  window.dispatchEvent(new CustomEvent('leveling-native-ads-status', { detail: status() }));
}

function userId() {
  return String(window.getLevelingCloudAccessState?.()?.user?.id || 'anonymous');
}

function claimId() {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${userId()}:${random}`;
}

function clearReloadTimer(kind) {
  if (kind === 'rewarded') {
    clearTimeout(rewardReloadTimer);
    rewardReloadTimer = 0;
  } else {
    clearTimeout(interstitialReloadTimer);
    interstitialReloadTimer = 0;
  }
}

function scheduleReload(kind) {
  const accessAllowed = kind === 'rewarded'
    ? rewardedAccessAllowed({ includeQuota: false })
    : interstitialAccessAllowed();
  if (!isNativeAndroid() || !runtime.canRequestAds || !accessAllowed) return;
  const failures = kind === 'rewarded' ? runtime.rewardFailures : runtime.interstitialFailures;
  const delay = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)];
  clearReloadTimer(kind);
  const callback = () => kind === 'rewarded' ? prepareRewarded() : prepareInterstitial();
  if (kind === 'rewarded') rewardReloadTimer = window.setTimeout(callback, delay);
  else interstitialReloadTimer = window.setTimeout(callback, delay);
}

async function addListenersOnce() {
  if (runtime.listenersReady) return true;
  if (listenersPromise) return listenersPromise;

  listenersPromise = Promise.all([
  AdMob.addListener(RewardAdPluginEvents.Loaded, () => {
    runtime.rewardedLoading = false;
    runtime.rewardedReady = true;
    runtime.rewardFailures = 0;
    runtime.lastRewardedReason = 'loaded';
    clearReloadTimer('rewarded');
    emitStatus();
  }),
  AdMob.addListener(RewardAdPluginEvents.FailedToLoad, error => {
    runtime.rewardedLoading = false;
    runtime.rewardedReady = false;
    runtime.rewardFailures += 1;
    diagnostic('rewarded', 'load_failed', error?.message || error?.code || 'plugin_event');
    scheduleReload('rewarded');
  }),
  AdMob.addListener(RewardAdPluginEvents.Showed, () => {
    runtime.rewardedReady = false;
    runtime.lastRewardedReason = 'shown';
    emitStatus();
  }),
  AdMob.addListener(RewardAdPluginEvents.Rewarded, async reward => {
    const request = runtime.rewardRequest;
    if (!request || request.rewardEventReceived) return;
    request.rewardEventReceived = true;
    diagnostic('rewarded', 'reward_earned');
    try {
      const credited = await window.LevelingRewardedAdsV2141?.creditNativeReward?.({
        claimId: request.claimId,
        placement: request.placement,
        crystals: REWARD_CRYSTALS,
        networkRewardType: String(reward?.type || ''),
        networkRewardAmount: Number(reward?.amount || 0),
        adsMode: ADS_MODE,
      });
      request.resolve(Boolean(credited));
    } catch (error) {
      console.warn('Reward credit:', error);
      request.resolve(false);
    }
  }),
  AdMob.addListener(RewardAdPluginEvents.Dismissed, () => {
    const request = runtime.rewardRequest;
    runtime.rewardedShowing = false;
    runtime.rewardRequest = null;
    if (request && !request.rewardEventReceived) {
      diagnostic('rewarded', 'dismissed_before_reward');
      request.resolve(false);
    }
    emitStatus();
    prepareRewarded();
  }),
  AdMob.addListener(RewardAdPluginEvents.FailedToShow, error => {
    const request = runtime.rewardRequest;
    runtime.rewardedShowing = false;
    runtime.rewardedReady = false;
    runtime.rewardRequest = null;
    if (request) request.resolve(false);
    diagnostic('rewarded', 'show_failed', error?.message || error?.code || 'plugin_event');
    scheduleReload('rewarded');
  }),

  AdMob.addListener(InterstitialAdPluginEvents.Loaded, () => {
    runtime.interstitialLoading = false;
    runtime.interstitialReady = true;
    runtime.interstitialFailures = 0;
    runtime.lastInterstitialReason = 'loaded';
    clearReloadTimer('interstitial');
    emitStatus();
  }),
  AdMob.addListener(InterstitialAdPluginEvents.FailedToLoad, error => {
    runtime.interstitialLoading = false;
    runtime.interstitialReady = false;
    runtime.interstitialFailures += 1;
    diagnostic('interstitial', 'load_failed', error?.message || error?.code || 'plugin_event');
    scheduleReload('interstitial');
  }),
  AdMob.addListener(InterstitialAdPluginEvents.Showed, () => {
    const request = runtime.interstitialRequest;
    if (request && !request.shown) {
      request.shown = true;
      request.resolve(true);
    }
    runtime.interstitialReady = false;
    runtime.lastInterstitialReason = 'shown';
    emitStatus();
  }),
  AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => {
    const request = runtime.interstitialRequest;
    runtime.interstitialShowing = false;
    runtime.interstitialRequest = null;
    if (request && !request.shown) request.resolve(false);
    emitStatus();
    prepareInterstitial();
  }),
  AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, error => {
    const request = runtime.interstitialRequest;
    runtime.interstitialShowing = false;
    runtime.interstitialReady = false;
    runtime.interstitialRequest = null;
    if (request) request.resolve(false);
    diagnostic('interstitial', 'show_failed', error?.message || error?.code || 'plugin_event');
    scheduleReload('interstitial');
  }),
  ]).then(() => {
    runtime.listenersReady = true;
    return true;
  });
  return listenersPromise;
}

async function initialize() {
  if (!isNativeAndroid()) return false;
  if (runtime.initialized) return runtime.canRequestAds;
  if (initializePromise) return initializePromise;

  initializePromise = (async () => {
    try {
      await addListenersOnce();
      await AdMob.initialize({
        initializeForTesting: !IS_PRODUCTION,
        maxAdContentRating: MaxAdContentRating.Teen,
        tagForChildDirectedTreatment: false,
        tagForUnderAgeOfConsent: false,
      });
      runtime.initialized = true;

      let consent = await AdMob.requestConsentInfo();
      if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) {
        consent = await AdMob.showConsentForm();
      }
      runtime.consentStatus = String(consent.status || 'UNKNOWN');
      runtime.canRequestAds = consent.canRequestAds === true;
      runtime.privacyOptionsRequired = consent.privacyOptionsRequirementStatus === 'REQUIRED';
      runtime.lastConsentReason = runtime.canRequestAds ? 'ads_allowed' : 'ads_blocked';
      diagnostic('consent', runtime.lastConsentReason, `status=${runtime.consentStatus} privacy=${runtime.privacyOptionsRequired ? 'required' : 'not_required'}`);

      if (runtime.canRequestAds) {
        const preparations = [];
        if (rewardedAccessAllowed({ includeQuota: false })) preparations.push(prepareRewarded());
        if (interstitialAccessAllowed()) preparations.push(prepareInterstitial());
        await Promise.allSettled(preparations);
      }
      return runtime.canRequestAds;
    } catch (error) {
      runtime.canRequestAds = false;
      diagnostic('consent', 'initialization_failed', error?.message || error);
      return false;
    } finally {
      initializePromise = null;
    }
  })();
  return initializePromise;
}

async function prepareRewarded() {
  if (!isNativeAndroid()) return diagnostic('rewarded', 'not_native_android');
  if (!runtime.canRequestAds) return diagnostic('rewarded', 'consent_not_ready');
  if (!rewardedAccessAllowed({ includeQuota: false })) return diagnostic('rewarded', 'not_authenticated');
  if (runtime.rewardedReady || runtime.rewardedLoading || runtime.rewardedShowing) return runtime.rewardedReady;
  runtime.rewardedLoading = true;
  emitStatus();
  try {
    await AdMob.prepareRewardVideoAd({
      adId: AD_IDS.rewarded,
      isTesting: !IS_PRODUCTION,
      immersiveMode: true,
    });
    runtime.rewardedLoading = false;
    runtime.rewardedReady = true;
    runtime.rewardFailures = 0;
    runtime.lastRewardedReason = 'loaded';
    emitStatus();
    return true;
  } catch (error) {
    runtime.rewardedLoading = false;
    runtime.rewardedReady = false;
    runtime.rewardFailures += 1;
    diagnostic('rewarded', 'load_failed', error?.message || error);
    scheduleReload('rewarded');
    return false;
  }
}

async function prepareInterstitial() {
  if (!isNativeAndroid()) return diagnostic('interstitial', 'not_native_android');
  if (!runtime.canRequestAds) return diagnostic('interstitial', 'consent_not_ready');
  if (!interstitialAccessAllowed()) return diagnostic('interstitial', 'access_not_ad_supported');
  if (runtime.interstitialReady || runtime.interstitialLoading || runtime.interstitialShowing) return runtime.interstitialReady;
  runtime.interstitialLoading = true;
  emitStatus();
  try {
    await AdMob.prepareInterstitial({
      adId: AD_IDS.interstitial,
      isTesting: !IS_PRODUCTION,
      immersiveMode: true,
    });
    runtime.interstitialLoading = false;
    runtime.interstitialReady = true;
    runtime.interstitialFailures = 0;
    runtime.lastInterstitialReason = 'loaded';
    emitStatus();
    return true;
  } catch (error) {
    runtime.interstitialLoading = false;
    runtime.interstitialReady = false;
    runtime.interstitialFailures += 1;
    diagnostic('interstitial', 'load_failed', error?.message || error);
    scheduleReload('interstitial');
    return false;
  }
}

async function showRewarded({ placement = 'rewarded_crystals' } = {}) {
  if (!isNativeAndroid()) return diagnostic('rewarded', 'not_native_android');
  if (!isForeground()) return diagnostic('rewarded', 'app_background');
  if (!hasAuthenticatedUser()) return diagnostic('rewarded', 'not_authenticated');
  if (!rewardedAccessAllowed()) return diagnostic('rewarded', 'daily_limit_reached');
  if (runtime.rewardedShowing || runtime.rewardRequest) return diagnostic('rewarded', 'already_showing');
  if (!(await initialize())) return diagnostic('rewarded', 'consent_not_ready');
  if (!runtime.rewardedReady && !(await prepareRewarded())) return diagnostic('rewarded', 'not_loaded');

  runtime.rewardedShowing = true;
  emitStatus();
  return new Promise(async resolve => {
    runtime.rewardRequest = {
      claimId: claimId(),
      placement,
      rewardEventReceived: false,
      resolve,
    };
    try {
      await AdMob.showRewardVideoAd();
    } catch (error) {
      const request = runtime.rewardRequest;
      runtime.rewardRequest = null;
      runtime.rewardedShowing = false;
      runtime.rewardedReady = false;
      if (request) request.resolve(false);
      diagnostic('rewarded', 'show_failed', error?.message || error);
      scheduleReload('rewarded');
    }
  });
}

async function showInterstitial({ reason = 'natural_break' } = {}) {
  if (!isNativeAndroid()) return diagnostic('interstitial', 'not_native_android', reason);
  if (!isForeground()) return diagnostic('interstitial', 'app_background', reason);
  if (!interstitialAccessAllowed()) return diagnostic('interstitial', 'access_not_ad_supported', reason);
  if (runtime.interstitialShowing || runtime.interstitialRequest) return diagnostic('interstitial', 'already_showing', reason);
  if (window.LevelingWorkoutGuard?.criticalModalOpen?.()) return diagnostic('interstitial', 'critical_modal_open', reason);
  if (window.LevelingWorkoutGuard?.isPowerSessionActive?.()) return diagnostic('interstitial', 'power_session_active', reason);
  if (!(await initialize())) return diagnostic('interstitial', 'consent_not_ready', reason);
  if (!runtime.interstitialReady && !(await prepareInterstitial())) return diagnostic('interstitial', 'not_loaded', reason);
  if (window.LevelingWorkoutGuard?.criticalModalOpen?.()) return diagnostic('interstitial', 'critical_modal_open', reason);
  if (window.LevelingWorkoutGuard?.isPowerSessionActive?.()) return diagnostic('interstitial', 'power_session_active', reason);

  runtime.interstitialShowing = true;
  emitStatus();
  return new Promise(async resolve => {
    runtime.interstitialRequest = { shown: false, resolve };
    try {
      await AdMob.showInterstitial();
    } catch (error) {
      const request = runtime.interstitialRequest;
      runtime.interstitialRequest = null;
      runtime.interstitialShowing = false;
      runtime.interstitialReady = false;
      if (request) request.resolve(false);
      diagnostic('interstitial', 'show_failed', error?.message || error);
      scheduleReload('interstitial');
    }
  });
}

async function showPrivacyOptions() {
  if (!isNativeAndroid()) return false;
  if (!runtime.initialized) await initialize();
  if (!runtime.privacyOptionsRequired) return false;
  try {
    await AdMob.showPrivacyOptionsForm();
    const consent = await AdMob.requestConsentInfo();
    runtime.consentStatus = String(consent.status || 'UNKNOWN');
    runtime.canRequestAds = consent.canRequestAds === true;
    runtime.privacyOptionsRequired = consent.privacyOptionsRequirementStatus === 'REQUIRED';
    runtime.lastConsentReason = runtime.canRequestAds ? 'ads_allowed' : 'ads_blocked';
    diagnostic('consent', runtime.lastConsentReason, `status=${runtime.consentStatus} privacy=${runtime.privacyOptionsRequired ? 'required' : 'not_required'}`);
    if (runtime.canRequestAds) await refreshEligibility();
    return true;
  } catch (error) {
    diagnostic('consent', 'privacy_options_failed', error?.message || error);
    return false;
  }
}

async function refreshEligibility() {
  if (!isNativeAndroid()) return false;
  if (!runtime.initialized && !(await initialize())) return false;
  if (!runtime.canRequestAds) return false;
  const preparations = [];
  if (rewardedAccessAllowed({ includeQuota: false })) preparations.push(prepareRewarded());
  if (interstitialAccessAllowed()) preparations.push(prepareInterstitial());
  await Promise.allSettled(preparations);
  return preparations.length > 0;
}

window.LevelingNativeAds = Object.freeze({
  mode: ADS_MODE,
  isNativeAndroid,
  initialize,
  prepareRewarded,
  prepareInterstitial,
  showRewarded,
  showInterstitial,
  showPrivacyOptions,
  refreshEligibility,
  status,
});

function boot() {
  emitStatus();
  if (isNativeAndroid()) initialize();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
