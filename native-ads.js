(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // node_modules/.pnpm/@capacitor+core@8.5.2/node_modules/@capacitor/core/dist/index.js
  var ExceptionCode, CapacitorException, getPlatformId, createCapacitor, initCapacitorGlobal, Capacitor, registerPlugin, WebPlugin, encode, decode, CapacitorCookiesPluginWeb, CapacitorCookies, readBlobAsBase64, normalizeHttpHeaders, buildUrlParams, buildRequestInit, CapacitorHttpPluginWeb, CapacitorHttp, SystemBarsStyle, SystemBarType, SystemBarsPluginWeb, SystemBars;
  var init_dist = __esm({
    "node_modules/.pnpm/@capacitor+core@8.5.2/node_modules/@capacitor/core/dist/index.js"() {
      (function(ExceptionCode2) {
        ExceptionCode2["Unimplemented"] = "UNIMPLEMENTED";
        ExceptionCode2["Unavailable"] = "UNAVAILABLE";
      })(ExceptionCode || (ExceptionCode = {}));
      CapacitorException = class extends Error {
        constructor(message, code, data) {
          super(message);
          this.message = message;
          this.code = code;
          this.data = data;
        }
      };
      getPlatformId = (win) => {
        var _a, _b;
        if (win === null || win === void 0 ? void 0 : win.androidBridge) {
          return "android";
        } else if ((_b = (_a = win === null || win === void 0 ? void 0 : win.webkit) === null || _a === void 0 ? void 0 : _a.messageHandlers) === null || _b === void 0 ? void 0 : _b.bridge) {
          return "ios";
        } else {
          return "web";
        }
      };
      createCapacitor = (win) => {
        const capCustomPlatform = win.CapacitorCustomPlatform || null;
        const cap = win.Capacitor || {};
        const Plugins = cap.Plugins = cap.Plugins || {};
        const getPlatform = () => {
          return capCustomPlatform !== null ? capCustomPlatform.name : getPlatformId(win);
        };
        const isNativePlatform = () => getPlatform() !== "web";
        const isPluginAvailable = (pluginName) => {
          const plugin = registeredPlugins.get(pluginName);
          if (plugin === null || plugin === void 0 ? void 0 : plugin.platforms.has(getPlatform())) {
            return true;
          }
          if (getPluginHeader(pluginName)) {
            return true;
          }
          return false;
        };
        const getPluginHeader = (pluginName) => {
          var _a;
          return (_a = cap.PluginHeaders) === null || _a === void 0 ? void 0 : _a.find((h) => h.name === pluginName);
        };
        const handleError = (err) => win.console.error(err);
        const registeredPlugins = /* @__PURE__ */ new Map();
        const registerPlugin2 = (pluginName, jsImplementations = {}) => {
          const registeredPlugin = registeredPlugins.get(pluginName);
          if (registeredPlugin) {
            console.warn(`Capacitor plugin "${pluginName}" already registered. Cannot register plugins twice.`);
            return registeredPlugin.proxy;
          }
          const platform = getPlatform();
          const pluginHeader = getPluginHeader(pluginName);
          let jsImplementation;
          const loadPluginImplementation = async () => {
            if (!jsImplementation && platform in jsImplementations) {
              jsImplementation = typeof jsImplementations[platform] === "function" ? jsImplementation = await jsImplementations[platform]() : jsImplementation = jsImplementations[platform];
            } else if (capCustomPlatform !== null && !jsImplementation && "web" in jsImplementations) {
              jsImplementation = typeof jsImplementations["web"] === "function" ? jsImplementation = await jsImplementations["web"]() : jsImplementation = jsImplementations["web"];
            }
            return jsImplementation;
          };
          const createPluginMethod = (impl, prop) => {
            var _a, _b;
            if (pluginHeader) {
              const methodHeader = pluginHeader === null || pluginHeader === void 0 ? void 0 : pluginHeader.methods.find((m) => prop === m.name);
              if (methodHeader) {
                if (methodHeader.rtype === "promise") {
                  return (options) => cap.nativePromise(pluginName, prop.toString(), options);
                } else {
                  return (options, callback) => cap.nativeCallback(pluginName, prop.toString(), options, callback);
                }
              } else if (impl) {
                return (_a = impl[prop]) === null || _a === void 0 ? void 0 : _a.bind(impl);
              }
            } else if (impl) {
              return (_b = impl[prop]) === null || _b === void 0 ? void 0 : _b.bind(impl);
            } else {
              throw new CapacitorException(`"${pluginName}" plugin is not implemented on ${platform}`, ExceptionCode.Unimplemented);
            }
          };
          const createPluginMethodWrapper = (prop) => {
            let remove;
            const wrapper = (...args) => {
              const p = loadPluginImplementation().then((impl) => {
                const fn = createPluginMethod(impl, prop);
                if (fn) {
                  const p2 = fn(...args);
                  remove = p2 === null || p2 === void 0 ? void 0 : p2.remove;
                  return p2;
                } else {
                  throw new CapacitorException(`"${pluginName}.${prop}()" is not implemented on ${platform}`, ExceptionCode.Unimplemented);
                }
              });
              if (prop === "addListener") {
                p.remove = async () => remove();
              }
              return p;
            };
            wrapper.toString = () => `${prop.toString()}() { [capacitor code] }`;
            Object.defineProperty(wrapper, "name", {
              value: prop,
              writable: false,
              configurable: false
            });
            return wrapper;
          };
          const addListener = createPluginMethodWrapper("addListener");
          const removeListener = createPluginMethodWrapper("removeListener");
          const addListenerNative = (eventName, callback) => {
            const call = addListener({ eventName }, callback);
            const remove = async () => {
              const callbackId = await call;
              removeListener({
                eventName,
                callbackId
              }, callback);
            };
            const p = new Promise((resolve) => call.then(() => resolve({ remove })));
            p.remove = async () => {
              console.warn(`Using addListener() without 'await' is deprecated.`);
              await remove();
            };
            return p;
          };
          const proxy = new Proxy({}, {
            get(_, prop) {
              switch (prop) {
                // https://github.com/facebook/react/issues/20030
                case "$$typeof":
                  return void 0;
                case "toJSON":
                  return () => ({});
                case "addListener":
                  return pluginHeader ? addListenerNative : addListener;
                case "removeListener":
                  return removeListener;
                default:
                  return createPluginMethodWrapper(prop);
              }
            }
          });
          Plugins[pluginName] = proxy;
          registeredPlugins.set(pluginName, {
            name: pluginName,
            proxy,
            platforms: /* @__PURE__ */ new Set([...Object.keys(jsImplementations), ...pluginHeader ? [platform] : []])
          });
          return proxy;
        };
        if (!cap.convertFileSrc) {
          cap.convertFileSrc = (filePath) => filePath;
        }
        cap.getPlatform = getPlatform;
        cap.handleError = handleError;
        cap.isNativePlatform = isNativePlatform;
        cap.isPluginAvailable = isPluginAvailable;
        cap.registerPlugin = registerPlugin2;
        cap.Exception = CapacitorException;
        cap.DEBUG = !!cap.DEBUG;
        cap.isLoggingEnabled = !!cap.isLoggingEnabled;
        return cap;
      };
      initCapacitorGlobal = (win) => win.Capacitor = createCapacitor(win);
      Capacitor = /* @__PURE__ */ initCapacitorGlobal(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : {});
      registerPlugin = Capacitor.registerPlugin;
      WebPlugin = class {
        constructor() {
          this.listeners = {};
          this.retainedEventArguments = {};
          this.windowListeners = {};
        }
        addListener(eventName, listenerFunc) {
          let firstListener = false;
          const listeners = this.listeners[eventName];
          if (!listeners) {
            this.listeners[eventName] = [];
            firstListener = true;
          }
          this.listeners[eventName].push(listenerFunc);
          const windowListener = this.windowListeners[eventName];
          if (windowListener && !windowListener.registered) {
            this.addWindowListener(windowListener);
          }
          if (firstListener) {
            this.sendRetainedArgumentsForEvent(eventName);
          }
          const remove = async () => this.removeListener(eventName, listenerFunc);
          const p = Promise.resolve({ remove });
          return p;
        }
        async removeAllListeners() {
          this.listeners = {};
          for (const listener in this.windowListeners) {
            this.removeWindowListener(this.windowListeners[listener]);
          }
          this.windowListeners = {};
        }
        notifyListeners(eventName, data, retainUntilConsumed) {
          const listeners = this.listeners[eventName];
          if (!listeners) {
            if (retainUntilConsumed) {
              let args = this.retainedEventArguments[eventName];
              if (!args) {
                args = [];
              }
              args.push(data);
              this.retainedEventArguments[eventName] = args;
            }
            return;
          }
          listeners.forEach((listener) => listener(data));
        }
        hasListeners(eventName) {
          var _a;
          return !!((_a = this.listeners[eventName]) === null || _a === void 0 ? void 0 : _a.length);
        }
        registerWindowListener(windowEventName, pluginEventName) {
          this.windowListeners[pluginEventName] = {
            registered: false,
            windowEventName,
            pluginEventName,
            handler: (event) => {
              this.notifyListeners(pluginEventName, event);
            }
          };
        }
        unimplemented(msg = "not implemented") {
          return new Capacitor.Exception(msg, ExceptionCode.Unimplemented);
        }
        unavailable(msg = "not available") {
          return new Capacitor.Exception(msg, ExceptionCode.Unavailable);
        }
        async removeListener(eventName, listenerFunc) {
          const listeners = this.listeners[eventName];
          if (!listeners) {
            return;
          }
          const index = listeners.indexOf(listenerFunc);
          if (index !== -1) {
            this.listeners[eventName].splice(index, 1);
          }
          if (!this.listeners[eventName].length) {
            this.removeWindowListener(this.windowListeners[eventName]);
          }
        }
        addWindowListener(handle) {
          window.addEventListener(handle.windowEventName, handle.handler);
          handle.registered = true;
        }
        removeWindowListener(handle) {
          if (!handle) {
            return;
          }
          window.removeEventListener(handle.windowEventName, handle.handler);
          handle.registered = false;
        }
        sendRetainedArgumentsForEvent(eventName) {
          const args = this.retainedEventArguments[eventName];
          if (!args) {
            return;
          }
          delete this.retainedEventArguments[eventName];
          args.forEach((arg) => {
            this.notifyListeners(eventName, arg);
          });
        }
      };
      encode = (str) => encodeURIComponent(str).replace(/%(2[346B]|5E|60|7C)/g, decodeURIComponent).replace(/[()]/g, escape);
      decode = (str) => str.replace(/(%[\dA-F]{2})+/gi, decodeURIComponent);
      CapacitorCookiesPluginWeb = class extends WebPlugin {
        async getCookies() {
          const cookies = document.cookie;
          const cookieMap = {};
          cookies.split(";").forEach((cookie) => {
            if (cookie.length <= 0)
              return;
            let [key, value] = cookie.replace(/=/, "CAP_COOKIE").split("CAP_COOKIE");
            key = decode(key).trim();
            value = decode(value).trim();
            cookieMap[key] = value;
          });
          return cookieMap;
        }
        async setCookie(options) {
          try {
            const encodedKey = encode(options.key);
            const encodedValue = encode(options.value);
            const expires = options.expires ? `; expires=${options.expires.replace("expires=", "")}` : "";
            const path = (options.path || "/").replace("path=", "");
            const domain = options.url != null && options.url.length > 0 ? `domain=${options.url}` : "";
            document.cookie = `${encodedKey}=${encodedValue || ""}${expires}; path=${path}; ${domain};`;
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async deleteCookie(options) {
          try {
            document.cookie = `${options.key}=; Max-Age=0`;
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async clearCookies() {
          try {
            const cookies = document.cookie.split(";") || [];
            for (const cookie of cookies) {
              document.cookie = cookie.replace(/^ +/, "").replace(/=.*/, `=;expires=${(/* @__PURE__ */ new Date()).toUTCString()};path=/`);
            }
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async clearAllCookies() {
          try {
            await this.clearCookies();
          } catch (error) {
            return Promise.reject(error);
          }
        }
      };
      CapacitorCookies = registerPlugin("CapacitorCookies", {
        web: () => new CapacitorCookiesPluginWeb()
      });
      readBlobAsBase64 = async (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64String = reader.result;
          resolve(base64String.indexOf(",") >= 0 ? base64String.split(",")[1] : base64String);
        };
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(blob);
      });
      normalizeHttpHeaders = (headers = {}) => {
        const originalKeys = Object.keys(headers);
        const loweredKeys = Object.keys(headers).map((k) => k.toLocaleLowerCase());
        const normalized = loweredKeys.reduce((acc, key, index) => {
          acc[key] = headers[originalKeys[index]];
          return acc;
        }, {});
        return normalized;
      };
      buildUrlParams = (params, shouldEncode = true) => {
        if (!params)
          return null;
        const output = Object.entries(params).reduce((accumulator, entry) => {
          const [key, value] = entry;
          let encodedValue;
          let item;
          if (Array.isArray(value)) {
            item = "";
            value.forEach((str) => {
              encodedValue = shouldEncode ? encodeURIComponent(str) : str;
              item += `${key}=${encodedValue}&`;
            });
            item.slice(0, -1);
          } else {
            encodedValue = shouldEncode ? encodeURIComponent(value) : value;
            item = `${key}=${encodedValue}`;
          }
          return `${accumulator}&${item}`;
        }, "");
        return output.substr(1);
      };
      buildRequestInit = (options, extra = {}) => {
        const output = Object.assign({ method: options.method || "GET", headers: options.headers }, extra);
        const headers = normalizeHttpHeaders(options.headers);
        const type = headers["content-type"] || "";
        if (typeof options.data === "string") {
          output.body = options.data;
        } else if (type.includes("application/x-www-form-urlencoded")) {
          const params = new URLSearchParams();
          for (const [key, value] of Object.entries(options.data || {})) {
            params.set(key, value);
          }
          output.body = params.toString();
        } else if (type.includes("multipart/form-data") || options.data instanceof FormData) {
          const form = new FormData();
          if (options.data instanceof FormData) {
            options.data.forEach((value, key) => {
              form.append(key, value);
            });
          } else {
            for (const key of Object.keys(options.data)) {
              form.append(key, options.data[key]);
            }
          }
          output.body = form;
          const headers2 = new Headers(output.headers);
          headers2.delete("content-type");
          output.headers = headers2;
        } else if (type.includes("application/json") || typeof options.data === "object") {
          output.body = JSON.stringify(options.data);
        }
        return output;
      };
      CapacitorHttpPluginWeb = class extends WebPlugin {
        /**
         * Perform an Http request given a set of options
         * @param options Options to build the HTTP request
         */
        async request(options) {
          const requestInit = buildRequestInit(options, options.webFetchExtra);
          const urlParams = buildUrlParams(options.params, options.shouldEncodeUrlParams);
          const url = urlParams ? `${options.url}?${urlParams}` : options.url;
          const response = await fetch(url, requestInit);
          const contentType = response.headers.get("content-type") || "";
          let { responseType = "text" } = response.ok ? options : {};
          if (contentType.includes("application/json")) {
            responseType = "json";
          }
          let data;
          let blob;
          switch (responseType) {
            case "arraybuffer":
            case "blob":
              blob = await response.blob();
              data = await readBlobAsBase64(blob);
              break;
            case "json":
              data = await response.json();
              break;
            case "document":
            case "text":
            default:
              data = await response.text();
          }
          const headers = {};
          response.headers.forEach((value, key) => {
            headers[key] = value;
          });
          return {
            data,
            headers,
            status: response.status,
            url: response.url
          };
        }
        /**
         * Perform an Http GET request given a set of options
         * @param options Options to build the HTTP request
         */
        async get(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "GET" }));
        }
        /**
         * Perform an Http POST request given a set of options
         * @param options Options to build the HTTP request
         */
        async post(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "POST" }));
        }
        /**
         * Perform an Http PUT request given a set of options
         * @param options Options to build the HTTP request
         */
        async put(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "PUT" }));
        }
        /**
         * Perform an Http PATCH request given a set of options
         * @param options Options to build the HTTP request
         */
        async patch(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "PATCH" }));
        }
        /**
         * Perform an Http DELETE request given a set of options
         * @param options Options to build the HTTP request
         */
        async delete(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "DELETE" }));
        }
      };
      CapacitorHttp = registerPlugin("CapacitorHttp", {
        web: () => new CapacitorHttpPluginWeb()
      });
      (function(SystemBarsStyle2) {
        SystemBarsStyle2["Dark"] = "DARK";
        SystemBarsStyle2["Light"] = "LIGHT";
        SystemBarsStyle2["Default"] = "DEFAULT";
      })(SystemBarsStyle || (SystemBarsStyle = {}));
      (function(SystemBarType2) {
        SystemBarType2["StatusBar"] = "StatusBar";
        SystemBarType2["NavigationBar"] = "NavigationBar";
      })(SystemBarType || (SystemBarType = {}));
      SystemBarsPluginWeb = class extends WebPlugin {
        async setStyle() {
          this.unavailable("not available for web");
        }
        async setAnimation() {
          this.unavailable("not available for web");
        }
        async show() {
          this.unavailable("not available for web");
        }
        async hide() {
          this.unavailable("not available for web");
        }
      };
      SystemBars = registerPlugin("SystemBars", {
        web: () => new SystemBarsPluginWeb()
      });
    }
  });

  // node_modules/.pnpm/@capacitor-community+admob@8.1.0/node_modules/@capacitor-community/admob/dist/esm/consent/consent-status.enum.js
  var AdmobConsentStatus;
  var init_consent_status_enum = __esm({
    "node_modules/.pnpm/@capacitor-community+admob@8.1.0/node_modules/@capacitor-community/admob/dist/esm/consent/consent-status.enum.js"() {
      (function(AdmobConsentStatus2) {
        AdmobConsentStatus2["NOT_REQUIRED"] = "NOT_REQUIRED";
        AdmobConsentStatus2["OBTAINED"] = "OBTAINED";
        AdmobConsentStatus2["REQUIRED"] = "REQUIRED";
        AdmobConsentStatus2["UNKNOWN"] = "UNKNOWN";
      })(AdmobConsentStatus || (AdmobConsentStatus = {}));
    }
  });

  // node_modules/.pnpm/@capacitor-community+admob@8.1.0/node_modules/@capacitor-community/admob/dist/esm/consent/privacy-options-requirement-status.enum.js
  var PrivacyOptionsRequirementStatus;
  var init_privacy_options_requirement_status_enum = __esm({
    "node_modules/.pnpm/@capacitor-community+admob@8.1.0/node_modules/@capacitor-community/admob/dist/esm/consent/privacy-options-requirement-status.enum.js"() {
      (function(PrivacyOptionsRequirementStatus2) {
        PrivacyOptionsRequirementStatus2["NOT_REQUIRED"] = "NOT_REQUIRED";
        PrivacyOptionsRequirementStatus2["REQUIRED"] = "REQUIRED";
        PrivacyOptionsRequirementStatus2["UNKNOWN"] = "UNKNOWN";
      })(PrivacyOptionsRequirementStatus || (PrivacyOptionsRequirementStatus = {}));
    }
  });

  // node_modules/.pnpm/@capacitor-community+admob@8.1.0/node_modules/@capacitor-community/admob/dist/esm/web.js
  var web_exports = {};
  __export(web_exports, {
    AdMobWeb: () => AdMobWeb
  });
  var AdMobWeb;
  var init_web = __esm({
    "node_modules/.pnpm/@capacitor-community+admob@8.1.0/node_modules/@capacitor-community/admob/dist/esm/web.js"() {
      init_dist();
      init_consent_status_enum();
      init_privacy_options_requirement_status_enum();
      AdMobWeb = class extends WebPlugin {
        async initialize() {
          console.log("initialize");
        }
        async requestTrackingAuthorization() {
          console.log("requestTrackingAuthorization");
        }
        async trackingAuthorizationStatus() {
          return {
            status: "authorized"
          };
        }
        async requestConsentInfo(options) {
          console.log("requestConsentInfo", options);
          return {
            status: AdmobConsentStatus.REQUIRED,
            isConsentFormAvailable: true,
            canRequestAds: true,
            privacyOptionsRequirementStatus: PrivacyOptionsRequirementStatus.REQUIRED
          };
        }
        async showPrivacyOptionsForm() {
          console.log("showPrivacyOptionsForm");
        }
        async showConsentForm() {
          console.log("showConsentForm");
          return {
            status: AdmobConsentStatus.REQUIRED,
            canRequestAds: true,
            privacyOptionsRequirementStatus: PrivacyOptionsRequirementStatus.REQUIRED
          };
        }
        async resetConsentInfo() {
          console.log("resetConsentInfo");
        }
        async setApplicationMuted(options) {
          console.log("setApplicationMuted", options);
        }
        async setApplicationVolume(options) {
          console.log("setApplicationVolume", options);
        }
        async showBanner(options) {
          console.log("showBanner", options);
        }
        async hideBanner() {
          console.log("hideBanner");
        }
        async resumeBanner() {
          console.log("resumeBanner");
        }
        async removeBanner() {
          console.log("removeBanner");
        }
        async prepareInterstitial(options) {
          console.log("prepareInterstitial", options);
          return {
            adUnitId: options.adId
          };
        }
        async showInterstitial(options) {
          console.log("showInterstitial", options);
        }
        async prepareRewardVideoAd(options) {
          console.log("prepareRewardVideoAd", options);
          return {
            adUnitId: options.adId
          };
        }
        async showRewardVideoAd(options) {
          console.log("showRewardVideoAd", options);
          return {
            type: "",
            amount: 0
          };
        }
        async prepareRewardInterstitialAd(options) {
          console.log("prepareRewardInterstitialAd", options);
          return {
            adUnitId: options.adId
          };
        }
        async showRewardInterstitialAd(options) {
          console.log("showRewardInterstitialAd", options);
          return {
            type: "",
            amount: 0
          };
        }
        async loadAppOpen(options) {
          console.log("loadAppOpen", options);
          return {
            adUnitId: options.adId
          };
        }
        async showAppOpen(options) {
          console.log("showAppOpen", options);
        }
        async isAppOpenLoaded() {
          return { value: false };
        }
        addListener(eventName, listenerFunc) {
          void listenerFunc;
          console.log("addListener", eventName);
          return Promise.resolve({ remove: () => Promise.resolve() });
        }
      };
    }
  });

  // src/native-ads.js
  init_dist();

  // node_modules/.pnpm/@capacitor-community+admob@8.1.0/node_modules/@capacitor-community/admob/dist/esm/index.js
  init_dist();

  // node_modules/.pnpm/@capacitor-community+admob@8.1.0/node_modules/@capacitor-community/admob/dist/esm/definitions.js
  var MaxAdContentRating;
  (function(MaxAdContentRating2) {
    MaxAdContentRating2["General"] = "General";
    MaxAdContentRating2["ParentalGuidance"] = "ParentalGuidance";
    MaxAdContentRating2["Teen"] = "Teen";
    MaxAdContentRating2["MatureAudience"] = "MatureAudience";
  })(MaxAdContentRating || (MaxAdContentRating = {}));

  // node_modules/.pnpm/@capacitor-community+admob@8.1.0/node_modules/@capacitor-community/admob/dist/esm/banner/banner-ad-plugin-events.enum.js
  var BannerAdPluginEvents;
  (function(BannerAdPluginEvents2) {
    BannerAdPluginEvents2["SizeChanged"] = "bannerAdSizeChanged";
    BannerAdPluginEvents2["Loaded"] = "bannerAdLoaded";
    BannerAdPluginEvents2["FailedToLoad"] = "bannerAdFailedToLoad";
    BannerAdPluginEvents2["Opened"] = "bannerAdOpened";
    BannerAdPluginEvents2["Closed"] = "bannerAdClosed";
    BannerAdPluginEvents2["AdImpression"] = "bannerAdImpression";
    BannerAdPluginEvents2["AdPaid"] = "bannerAdPaid";
  })(BannerAdPluginEvents || (BannerAdPluginEvents = {}));

  // node_modules/.pnpm/@capacitor-community+admob@8.1.0/node_modules/@capacitor-community/admob/dist/esm/banner/banner-ad-position.enum.js
  var BannerAdPosition;
  (function(BannerAdPosition2) {
    BannerAdPosition2["TOP_CENTER"] = "TOP_CENTER";
    BannerAdPosition2["CENTER"] = "CENTER";
    BannerAdPosition2["BOTTOM_CENTER"] = "BOTTOM_CENTER";
  })(BannerAdPosition || (BannerAdPosition = {}));

  // node_modules/.pnpm/@capacitor-community+admob@8.1.0/node_modules/@capacitor-community/admob/dist/esm/banner/banner-ad-size.enum.js
  var BannerAdSize;
  (function(BannerAdSize2) {
    BannerAdSize2["BANNER"] = "BANNER";
    BannerAdSize2["FULL_BANNER"] = "FULL_BANNER";
    BannerAdSize2["LARGE_BANNER"] = "LARGE_BANNER";
    BannerAdSize2["MEDIUM_RECTANGLE"] = "MEDIUM_RECTANGLE";
    BannerAdSize2["LEADERBOARD"] = "LEADERBOARD";
    BannerAdSize2["ADAPTIVE_BANNER"] = "ADAPTIVE_BANNER";
    BannerAdSize2["SMART_BANNER"] = "SMART_BANNER";
  })(BannerAdSize || (BannerAdSize = {}));

  // node_modules/.pnpm/@capacitor-community+admob@8.1.0/node_modules/@capacitor-community/admob/dist/esm/interstitial/interstitial-ad-plugin-events.enum.js
  var InterstitialAdPluginEvents;
  (function(InterstitialAdPluginEvents2) {
    InterstitialAdPluginEvents2["Loaded"] = "interstitialAdLoaded";
    InterstitialAdPluginEvents2["FailedToLoad"] = "interstitialAdFailedToLoad";
    InterstitialAdPluginEvents2["Showed"] = "interstitialAdShowed";
    InterstitialAdPluginEvents2["FailedToShow"] = "interstitialAdFailedToShow";
    InterstitialAdPluginEvents2["Dismissed"] = "interstitialAdDismissed";
    InterstitialAdPluginEvents2["AdImpression"] = "interstitialAdImpression";
  })(InterstitialAdPluginEvents || (InterstitialAdPluginEvents = {}));

  // node_modules/.pnpm/@capacitor-community+admob@8.1.0/node_modules/@capacitor-community/admob/dist/esm/reward-interstitial/reward-interstitial-ad-plugin-events.enum.js
  var RewardInterstitialAdPluginEvents;
  (function(RewardInterstitialAdPluginEvents2) {
    RewardInterstitialAdPluginEvents2["Loaded"] = "onRewardedInterstitialAdLoaded";
    RewardInterstitialAdPluginEvents2["FailedToLoad"] = "onRewardedInterstitialAdFailedToLoad";
    RewardInterstitialAdPluginEvents2["Showed"] = "onRewardedInterstitialAdShowed";
    RewardInterstitialAdPluginEvents2["FailedToShow"] = "onRewardedInterstitialAdFailedToShow";
    RewardInterstitialAdPluginEvents2["Dismissed"] = "onRewardedInterstitialAdDismissed";
    RewardInterstitialAdPluginEvents2["Rewarded"] = "onRewardedInterstitialAdReward";
    RewardInterstitialAdPluginEvents2["AdImpression"] = "onRewardedInterstitialAdImpression";
  })(RewardInterstitialAdPluginEvents || (RewardInterstitialAdPluginEvents = {}));

  // node_modules/.pnpm/@capacitor-community+admob@8.1.0/node_modules/@capacitor-community/admob/dist/esm/reward/reward-ad-plugin-events.enum.js
  var RewardAdPluginEvents;
  (function(RewardAdPluginEvents2) {
    RewardAdPluginEvents2["Loaded"] = "onRewardedVideoAdLoaded";
    RewardAdPluginEvents2["FailedToLoad"] = "onRewardedVideoAdFailedToLoad";
    RewardAdPluginEvents2["Showed"] = "onRewardedVideoAdShowed";
    RewardAdPluginEvents2["FailedToShow"] = "onRewardedVideoAdFailedToShow";
    RewardAdPluginEvents2["Dismissed"] = "onRewardedVideoAdDismissed";
    RewardAdPluginEvents2["Rewarded"] = "onRewardedVideoAdReward";
    RewardAdPluginEvents2["AdImpression"] = "onRewardedVideoAdImpression";
  })(RewardAdPluginEvents || (RewardAdPluginEvents = {}));

  // node_modules/.pnpm/@capacitor-community+admob@8.1.0/node_modules/@capacitor-community/admob/dist/esm/consent/index.js
  init_consent_status_enum();

  // node_modules/.pnpm/@capacitor-community+admob@8.1.0/node_modules/@capacitor-community/admob/dist/esm/consent/consent-debug-geography.enum.js
  var AdmobConsentDebugGeography;
  (function(AdmobConsentDebugGeography2) {
    AdmobConsentDebugGeography2[AdmobConsentDebugGeography2["DISABLED"] = 0] = "DISABLED";
    AdmobConsentDebugGeography2[AdmobConsentDebugGeography2["EEA"] = 1] = "EEA";
    AdmobConsentDebugGeography2[AdmobConsentDebugGeography2["NOT_EEA"] = 2] = "NOT_EEA";
    AdmobConsentDebugGeography2[AdmobConsentDebugGeography2["US"] = 3] = "US";
    AdmobConsentDebugGeography2[AdmobConsentDebugGeography2["OTHER"] = 4] = "OTHER";
  })(AdmobConsentDebugGeography || (AdmobConsentDebugGeography = {}));

  // node_modules/.pnpm/@capacitor-community+admob@8.1.0/node_modules/@capacitor-community/admob/dist/esm/shared/ad-mob-revenue-data.interface.js
  var AdValuePrecision;
  (function(AdValuePrecision2) {
    AdValuePrecision2[AdValuePrecision2["Unknown"] = 0] = "Unknown";
    AdValuePrecision2[AdValuePrecision2["Estimated"] = 1] = "Estimated";
    AdValuePrecision2[AdValuePrecision2["PublisherProvided"] = 2] = "PublisherProvided";
    AdValuePrecision2[AdValuePrecision2["Precise"] = 3] = "Precise";
  })(AdValuePrecision || (AdValuePrecision = {}));

  // node_modules/.pnpm/@capacitor-community+admob@8.1.0/node_modules/@capacitor-community/admob/dist/esm/app-open/app-open-ad-plugin-events.enum.js
  var AppOpenAdPluginEvents;
  (function(AppOpenAdPluginEvents2) {
    AppOpenAdPluginEvents2["Loaded"] = "appOpenAdLoaded";
    AppOpenAdPluginEvents2["FailedToLoad"] = "appOpenAdFailedToLoad";
    AppOpenAdPluginEvents2["Opened"] = "appOpenAdOpened";
    AppOpenAdPluginEvents2["Closed"] = "appOpenAdClosed";
    AppOpenAdPluginEvents2["FailedToShow"] = "appOpenAdFailedToShow";
    AppOpenAdPluginEvents2["AdImpression"] = "appOpenAdImpression";
  })(AppOpenAdPluginEvents || (AppOpenAdPluginEvents = {}));

  // node_modules/.pnpm/@capacitor-community+admob@8.1.0/node_modules/@capacitor-community/admob/dist/esm/index.js
  var AdMob = registerPlugin("AdMob", {
    web: () => Promise.resolve().then(() => (init_web(), web_exports)).then((m) => new m.AdMobWeb())
  });

  // src/native-ads.js
  var ADS_MODE = "test";
  var IS_PRODUCTION = ADS_MODE === "production";
  var DAILY_REWARDED_LIMIT = 3;
  var REWARD_CRYSTALS = 10;
  var BACKOFF_MS = [15e3, 3e4, 6e4, 12e4];
  var AD_IDS = Object.freeze({
    rewarded: "ca-app-pub-3940256099942544/5224354917",
    interstitial: "ca-app-pub-3940256099942544/1033173712"
  });
  var runtime = {
    initialized: false,
    canRequestAds: false,
    consentStatus: "UNKNOWN",
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
    lastRewardedReason: "idle",
    lastInterstitialReason: "idle",
    lastConsentReason: "not_initialized"
  };
  var initializePromise = null;
  var listenersPromise = null;
  var rewardReloadTimer = 0;
  var interstitialReloadTimer = 0;
  function isNativeAndroid() {
    try {
      return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
    } catch {
      return false;
    }
  }
  function isForeground() {
    return document.visibilityState === "visible";
  }
  function hasAuthenticatedUser() {
    return userId() !== "anonymous";
  }
  function rewardedAccessAllowed({ includeQuota = true } = {}) {
    if (!hasAuthenticatedUser()) return false;
    if (!includeQuota) return true;
    const remaining = Number(window.LevelingRewardedAdsV2141?.status?.()?.remaining);
    return !Number.isFinite(remaining) || remaining > 0;
  }
  function interstitialAccessAllowed() {
    const info = window.getLevelingAccessInfo?.();
    const state = String(info?.access_state || "UNKNOWN").toUpperCase();
    return ["TRIAL", "PASS", "FREE"].includes(state) && info?.ad_supported === true;
  }
  function diagnostic(kind, reason, detail = "") {
    const normalized = String(reason || "unknown");
    if (kind === "rewarded") runtime.lastRewardedReason = normalized;
    else if (kind === "interstitial") runtime.lastInterstitialReason = normalized;
    else runtime.lastConsentReason = normalized;
    const suffix = detail ? ` \xB7 ${String(detail).slice(0, 160)}` : "";
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
      rewardCrystals: REWARD_CRYSTALS
    };
  }
  function emitStatus() {
    window.dispatchEvent(new CustomEvent("leveling-native-ads-status", { detail: status() }));
  }
  function userId() {
    return String(window.getLevelingCloudAccessState?.()?.user?.id || "anonymous");
  }
  function claimId() {
    const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `${userId()}:${random}`;
  }
  function clearReloadTimer(kind) {
    if (kind === "rewarded") {
      clearTimeout(rewardReloadTimer);
      rewardReloadTimer = 0;
    } else {
      clearTimeout(interstitialReloadTimer);
      interstitialReloadTimer = 0;
    }
  }
  function scheduleReload(kind) {
    const accessAllowed = kind === "rewarded" ? rewardedAccessAllowed({ includeQuota: false }) : interstitialAccessAllowed();
    if (!isNativeAndroid() || !runtime.canRequestAds || !accessAllowed) return;
    const failures = kind === "rewarded" ? runtime.rewardFailures : runtime.interstitialFailures;
    const delay = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)];
    clearReloadTimer(kind);
    const callback = () => kind === "rewarded" ? prepareRewarded() : prepareInterstitial();
    if (kind === "rewarded") rewardReloadTimer = window.setTimeout(callback, delay);
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
        runtime.lastRewardedReason = "loaded";
        clearReloadTimer("rewarded");
        emitStatus();
      }),
      AdMob.addListener(RewardAdPluginEvents.FailedToLoad, (error) => {
        runtime.rewardedLoading = false;
        runtime.rewardedReady = false;
        runtime.rewardFailures += 1;
        diagnostic("rewarded", "load_failed", error?.message || error?.code || "plugin_event");
        scheduleReload("rewarded");
      }),
      AdMob.addListener(RewardAdPluginEvents.Showed, () => {
        runtime.rewardedReady = false;
        runtime.lastRewardedReason = "shown";
        emitStatus();
      }),
      AdMob.addListener(RewardAdPluginEvents.Rewarded, async (reward) => {
        const request = runtime.rewardRequest;
        if (!request || request.rewardEventReceived) return;
        request.rewardEventReceived = true;
        diagnostic("rewarded", "reward_earned");
        try {
          const credited = await window.LevelingRewardedAdsV2141?.creditNativeReward?.({
            claimId: request.claimId,
            placement: request.placement,
            crystals: REWARD_CRYSTALS,
            networkRewardType: String(reward?.type || ""),
            networkRewardAmount: Number(reward?.amount || 0),
            adsMode: ADS_MODE
          });
          request.resolve(Boolean(credited));
        } catch (error) {
          console.warn("Reward credit:", error);
          request.resolve(false);
        }
      }),
      AdMob.addListener(RewardAdPluginEvents.Dismissed, () => {
        const request = runtime.rewardRequest;
        runtime.rewardedShowing = false;
        runtime.rewardRequest = null;
        if (request && !request.rewardEventReceived) {
          diagnostic("rewarded", "dismissed_before_reward");
          request.resolve(false);
        }
        emitStatus();
        prepareRewarded();
      }),
      AdMob.addListener(RewardAdPluginEvents.FailedToShow, (error) => {
        const request = runtime.rewardRequest;
        runtime.rewardedShowing = false;
        runtime.rewardedReady = false;
        runtime.rewardRequest = null;
        if (request) request.resolve(false);
        diagnostic("rewarded", "show_failed", error?.message || error?.code || "plugin_event");
        scheduleReload("rewarded");
      }),
      AdMob.addListener(InterstitialAdPluginEvents.Loaded, () => {
        runtime.interstitialLoading = false;
        runtime.interstitialReady = true;
        runtime.interstitialFailures = 0;
        runtime.lastInterstitialReason = "loaded";
        clearReloadTimer("interstitial");
        emitStatus();
      }),
      AdMob.addListener(InterstitialAdPluginEvents.FailedToLoad, (error) => {
        runtime.interstitialLoading = false;
        runtime.interstitialReady = false;
        runtime.interstitialFailures += 1;
        diagnostic("interstitial", "load_failed", error?.message || error?.code || "plugin_event");
        scheduleReload("interstitial");
      }),
      AdMob.addListener(InterstitialAdPluginEvents.Showed, () => {
        const request = runtime.interstitialRequest;
        if (request && !request.shown) {
          request.shown = true;
          request.resolve(true);
        }
        runtime.interstitialReady = false;
        runtime.lastInterstitialReason = "shown";
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
      AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, (error) => {
        const request = runtime.interstitialRequest;
        runtime.interstitialShowing = false;
        runtime.interstitialReady = false;
        runtime.interstitialRequest = null;
        if (request) request.resolve(false);
        diagnostic("interstitial", "show_failed", error?.message || error?.code || "plugin_event");
        scheduleReload("interstitial");
      })
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
          tagForUnderAgeOfConsent: false
        });
        runtime.initialized = true;
        let consent = await AdMob.requestConsentInfo();
        if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) {
          consent = await AdMob.showConsentForm();
        }
        runtime.consentStatus = String(consent.status || "UNKNOWN");
        runtime.canRequestAds = consent.canRequestAds === true;
        runtime.privacyOptionsRequired = consent.privacyOptionsRequirementStatus === "REQUIRED";
        runtime.lastConsentReason = runtime.canRequestAds ? "ads_allowed" : "ads_blocked";
        diagnostic("consent", runtime.lastConsentReason, `status=${runtime.consentStatus} privacy=${runtime.privacyOptionsRequired ? "required" : "not_required"}`);
        if (runtime.canRequestAds) {
          const preparations = [];
          if (rewardedAccessAllowed({ includeQuota: false })) preparations.push(prepareRewarded());
          if (interstitialAccessAllowed()) preparations.push(prepareInterstitial());
          await Promise.allSettled(preparations);
        }
        return runtime.canRequestAds;
      } catch (error) {
        runtime.canRequestAds = false;
        diagnostic("consent", "initialization_failed", error?.message || error);
        return false;
      } finally {
        initializePromise = null;
      }
    })();
    return initializePromise;
  }
  async function prepareRewarded() {
    if (!isNativeAndroid()) return diagnostic("rewarded", "not_native_android");
    if (!runtime.canRequestAds) return diagnostic("rewarded", "consent_not_ready");
    if (!rewardedAccessAllowed({ includeQuota: false })) return diagnostic("rewarded", "not_authenticated");
    if (runtime.rewardedReady || runtime.rewardedLoading || runtime.rewardedShowing) return runtime.rewardedReady;
    runtime.rewardedLoading = true;
    emitStatus();
    try {
      await AdMob.prepareRewardVideoAd({
        adId: AD_IDS.rewarded,
        isTesting: !IS_PRODUCTION,
        immersiveMode: true
      });
      runtime.rewardedLoading = false;
      runtime.rewardedReady = true;
      runtime.rewardFailures = 0;
      runtime.lastRewardedReason = "loaded";
      emitStatus();
      return true;
    } catch (error) {
      runtime.rewardedLoading = false;
      runtime.rewardedReady = false;
      runtime.rewardFailures += 1;
      diagnostic("rewarded", "load_failed", error?.message || error);
      scheduleReload("rewarded");
      return false;
    }
  }
  async function prepareInterstitial() {
    if (!isNativeAndroid()) return diagnostic("interstitial", "not_native_android");
    if (!runtime.canRequestAds) return diagnostic("interstitial", "consent_not_ready");
    if (!interstitialAccessAllowed()) return diagnostic("interstitial", "access_not_ad_supported");
    if (runtime.interstitialReady || runtime.interstitialLoading || runtime.interstitialShowing) return runtime.interstitialReady;
    runtime.interstitialLoading = true;
    emitStatus();
    try {
      await AdMob.prepareInterstitial({
        adId: AD_IDS.interstitial,
        isTesting: !IS_PRODUCTION,
        immersiveMode: true
      });
      runtime.interstitialLoading = false;
      runtime.interstitialReady = true;
      runtime.interstitialFailures = 0;
      runtime.lastInterstitialReason = "loaded";
      emitStatus();
      return true;
    } catch (error) {
      runtime.interstitialLoading = false;
      runtime.interstitialReady = false;
      runtime.interstitialFailures += 1;
      diagnostic("interstitial", "load_failed", error?.message || error);
      scheduleReload("interstitial");
      return false;
    }
  }
  async function showRewarded({ placement = "rewarded_crystals" } = {}) {
    if (!isNativeAndroid()) return diagnostic("rewarded", "not_native_android");
    if (!isForeground()) return diagnostic("rewarded", "app_background");
    if (!hasAuthenticatedUser()) return diagnostic("rewarded", "not_authenticated");
    if (!rewardedAccessAllowed()) return diagnostic("rewarded", "daily_limit_reached");
    if (runtime.rewardedShowing || runtime.rewardRequest) return diagnostic("rewarded", "already_showing");
    if (!await initialize()) return diagnostic("rewarded", "consent_not_ready");
    if (!runtime.rewardedReady && !await prepareRewarded()) return diagnostic("rewarded", "not_loaded");
    runtime.rewardedShowing = true;
    emitStatus();
    return new Promise(async (resolve) => {
      runtime.rewardRequest = {
        claimId: claimId(),
        placement,
        rewardEventReceived: false,
        resolve
      };
      try {
        await AdMob.showRewardVideoAd();
      } catch (error) {
        const request = runtime.rewardRequest;
        runtime.rewardRequest = null;
        runtime.rewardedShowing = false;
        runtime.rewardedReady = false;
        if (request) request.resolve(false);
        diagnostic("rewarded", "show_failed", error?.message || error);
        scheduleReload("rewarded");
      }
    });
  }
  async function showInterstitial({ reason = "natural_break" } = {}) {
    if (!isNativeAndroid()) return diagnostic("interstitial", "not_native_android", reason);
    if (!isForeground()) return diagnostic("interstitial", "app_background", reason);
    if (!interstitialAccessAllowed()) return diagnostic("interstitial", "access_not_ad_supported", reason);
    if (runtime.interstitialShowing || runtime.interstitialRequest) return diagnostic("interstitial", "already_showing", reason);
    if (window.LevelingWorkoutGuard?.criticalModalOpen?.()) return diagnostic("interstitial", "critical_modal_open", reason);
    if (window.LevelingWorkoutGuard?.isPowerSessionActive?.()) return diagnostic("interstitial", "power_session_active", reason);
    if (!await initialize()) return diagnostic("interstitial", "consent_not_ready", reason);
    if (!runtime.interstitialReady && !await prepareInterstitial()) return diagnostic("interstitial", "not_loaded", reason);
    if (window.LevelingWorkoutGuard?.criticalModalOpen?.()) return diagnostic("interstitial", "critical_modal_open", reason);
    if (window.LevelingWorkoutGuard?.isPowerSessionActive?.()) return diagnostic("interstitial", "power_session_active", reason);
    runtime.interstitialShowing = true;
    emitStatus();
    return new Promise(async (resolve) => {
      runtime.interstitialRequest = { shown: false, resolve };
      try {
        await AdMob.showInterstitial();
      } catch (error) {
        const request = runtime.interstitialRequest;
        runtime.interstitialRequest = null;
        runtime.interstitialShowing = false;
        runtime.interstitialReady = false;
        if (request) request.resolve(false);
        diagnostic("interstitial", "show_failed", error?.message || error);
        scheduleReload("interstitial");
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
      runtime.consentStatus = String(consent.status || "UNKNOWN");
      runtime.canRequestAds = consent.canRequestAds === true;
      runtime.privacyOptionsRequired = consent.privacyOptionsRequirementStatus === "REQUIRED";
      runtime.lastConsentReason = runtime.canRequestAds ? "ads_allowed" : "ads_blocked";
      diagnostic("consent", runtime.lastConsentReason, `status=${runtime.consentStatus} privacy=${runtime.privacyOptionsRequired ? "required" : "not_required"}`);
      if (runtime.canRequestAds) await refreshEligibility();
      return true;
    } catch (error) {
      diagnostic("consent", "privacy_options_failed", error?.message || error);
      return false;
    }
  }
  async function refreshEligibility() {
    if (!isNativeAndroid()) return false;
    if (!runtime.initialized && !await initialize()) return false;
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
    status
  });
  function boot() {
    emitStatus();
    if (isNativeAndroid()) initialize();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
