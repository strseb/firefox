/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  IPProtectionService:
    "moz-src:///toolkit/components/ipprotection/IPProtectionService.sys.mjs",
});

const MATCH_PATTERN_OPTIONS = {
  ignorePath: true,
  restrictSchemes: false,
};

/** @typedef {"included"|"excluded"|null} IPPPrincipalRule */

/**
 * DEFAULT is null because that is what a SiteRuleManager returns when no
 * provider claimed the principal.
 */
export const IPPPrincipalRules = Object.freeze({
  INCLUDED: "included",
  EXCLUDED: "excluded",
  DEFAULT: null,
});

/**
 * Base class for site rule providers.
 *
 * A provider answers "which rule applies to this principal?" for exactly one
 * source of truth, so that adding a new source is adding a new subclass rather
 * than another branch in a shared if-chain.
 *
 * Subclasses override what they need. The defaults are safe no-ops: no opinion
 * and no writes. A provider that stores rules also overrides canSet and
 * setRule.
 *
 * Providers call notifyChange when their underlying data changes; the manager
 * listens for that and re-dispatches a single SiteRuleManager:RuleChanged to
 * consumers, so nothing outside has to subscribe to providers individually.
 */
export class SiteRuleProvider extends EventTarget {
  /**
   * Registers observers and builds any cached state. Called by the manager.
   */
  init() {}

  uninit() {}

  /**
   * This provider's opinion for a principal.
   *
   * @param {?nsIPrincipal} _principal
   * @returns {?string}
   *  The rule, or null for "no opinion, ask the next provider".
   */
  getRule(_principal) {
    return null;
  }

  /**
   * Whether a user-initiated write for this principal would be stored here.
   * Read-only providers keep the default.
   *
   * @param {?nsIPrincipal} _principal
   * @returns {boolean}
   */
  canSet(_principal) {
    return false;
  }

  /**
   * Stores a rule for a principal, or clears it when rule is null.
   *
   * @param {nsIPrincipal} _principal
   * @param {?string} _rule
   */
  setRule(_principal, _rule) {
    throw new Error("setRule() must be implemented by writable subclasses");
  }

  /**
   * Tells the manager this provider's underlying data changed.
   */
  notifyChange() {
    this.dispatchEvent(new CustomEvent("change"));
  }
}

/**
 * Traffic that can never be proxied, whatever the user or the lists say.
 */
export class IPPProxyableRuleProvider extends SiteRuleProvider {
  getRule(principal) {
    // Exclude non-http(s) schemes (about:, file:, etc.), but NOT null
    // principals: a null principal's scheme is moz-nullprincipal even when it
    // backs real http(s) content (e.g. a sandboxed iframe), so its scheme says
    // nothing about whether the traffic should be proxied.
    if (
      !principal?.isNullPrincipal &&
      !principal?.schemeIs("http") &&
      !principal?.schemeIs("https")
    ) {
      return IPPPrincipalRules.EXCLUDED;
    }
    if (principal.isLoopbackHost || principal.isLocalIpAddress) {
      return IPPPrincipalRules.EXCLUDED;
    }
    return null;
  }
}

/**
 * Origins the VPN itself depends on (the guardian endpoint, captive portal
 * detection). Proxying these would break the VPN, so they beat inclusions.
 */
export class IPPInfrastructureRuleProvider extends SiteRuleProvider {
  static #DEFAULT_URL_PREFS = [
    "browser.ipProtection.guardian.endpoint",
    "captivedetect.canonicalURL",
  ];

  #origins = new MatchPatternSet([], MATCH_PATTERN_OPTIONS);
  #observedPrefs = [];
  #prefObserver = null;

  init() {
    // The excluded origins come from the default-excluded prefs plus the active
    // auth provider's prefs; observe each so the set stays current.
    this.#observedPrefs = [
      ...IPPInfrastructureRuleProvider.#DEFAULT_URL_PREFS,
      ...(lazy.IPProtectionService.authProvider?.excludedUrlPrefs ?? []),
    ];
    this.#prefObserver = () => {
      this.#rebuild();
      this.notifyChange();
    };
    for (const pref of this.#observedPrefs) {
      Services.prefs.addObserver(pref, this.#prefObserver);
    }
    this.#rebuild();
  }

  uninit() {
    if (!this.#prefObserver) {
      return;
    }
    for (const pref of this.#observedPrefs) {
      Services.prefs.removeObserver(pref, this.#prefObserver);
    }
    this.#prefObserver = null;
    this.#observedPrefs = [];
  }

  getRule(principal) {
    const uri = principal?.URI;
    if (uri && this.#origins.matches(uri)) {
      return IPPPrincipalRules.EXCLUDED;
    }
    return null;
  }

  #rebuild() {
    const patterns = [];
    for (const pref of this.#observedPrefs) {
      const pattern = IPPInfrastructureRuleProvider.#toHostPattern(
        Services.prefs.getStringPref(pref, "")
      );
      if (pattern) {
        patterns.push(pattern);
      }
    }
    this.#origins = new MatchPatternSet(patterns, MATCH_PATTERN_OPTIONS);
  }

  /**
   * Converts an excluded page URL to a host match pattern (scheme://host/*),
   * or null if the URL cannot be parsed.
   *
   * @param {string} url
   * @returns {?string}
   */
  static #toHostPattern(url) {
    try {
      const uri = Services.io.newURI(url);
      return `${uri.scheme}://${uri.host}/*`;
    } catch (_) {
      return null;
    }
  }
}
