/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  IPPInfrastructureRuleProvider,
  IPPPrincipalRules,
  IPPProxyableRuleProvider,
  MatchPatternPrefRule,
} from "moz-src:///toolkit/components/ipprotection/SiteRuleProviders.sys.mjs";

export { IPPPrincipalRules };

/**
 * Resolves a principal to a rule by asking an ordered list of providers.
 *
 * The array order is the precedence: the first provider with an opinion wins,
 * and the ones after it are never consulted.
 */
export class SiteRuleManager extends EventTarget {
  #providers;
  #inited = false;
  #onProviderChange;

  /**
   * @param {SiteRuleProvider[]} providers
   *  Ordered most-important first.
   */
  constructor(providers) {
    super();
    this.#providers = providers;
    // The event carries no payload. Which provider changed does not map to
    // which principals changed rule: precedence means one provider's update
    // can start or stop masking another's.
    this.#onProviderChange = () => {
      this.dispatchEvent(new CustomEvent("SiteRuleManager:RuleChanged"));
    };
  }

  init() {
    if (this.#inited) {
      return;
    }
    // Set before initing the providers: a provider may notify from within
    // init(), and re-entering here would double-register the listeners.
    this.#inited = true;
    for (const provider of this.#providers) {
      provider.addEventListener("change", this.#onProviderChange);
      provider.init();
    }
  }

  uninit() {
    if (!this.#inited) {
      return;
    }
    for (const provider of this.#providers) {
      provider.removeEventListener("change", this.#onProviderChange);
      provider.uninit();
    }
    this.#inited = false;
  }

  /**
   * The rule that applies to a principal.
   *
   * @param {?nsIPrincipal} principal
   * @returns {?string}
   *  The first non-null opinion, or null if no provider has one.
   */
  getRule(principal) {
    if (!this.#inited) {
      this.init();
    }
    try {
      for (const provider of this.#providers) {
        const rule = provider.getRule(principal);
        if (rule != null) {
          return rule;
        }
      }
      return null;
    } catch (_) {
      return IPPPrincipalRules.EXCLUDED;
    }
  }

  /**
   * Whether the user can change the rule that applies to this principal.
   *
   * It is false for principals that are never proxyable (about:
   * pages, loopback hosts) and for sites pinned by the inclusion list or by
   * the VPN's own infrastructure origins.
   *
   * @param {?nsIPrincipal} principal
   * @returns {boolean}
   */
  canManage(principal) {
    if (!this.#inited) {
      this.init();
    }
    try {
      for (const provider of this.#providers) {
        // canSet comes first for each provider, so that a site the user has
        // already set stays manageable: the store's own rule must not count
        // as something blocking a write to that same store.
        if (provider.canSet(principal)) {
          return true;
        }
        if (provider.getRule(principal) != null) {
          return false;
        }
      }
      return false;
    } catch (_) {
      return false;
    }
  }
}

/**
 * The single source of truth for classifying a principal as
 * included/excluded/default for the proxy, shared by the channel filter and
 * the UI. The array order is the precedence.
 */
export const IPPSiteRuleManager = new SiteRuleManager([
  new IPPProxyableRuleProvider(),
  new IPPInfrastructureRuleProvider(),
  new MatchPatternPrefRule(
    "browser.ipProtection.inclusion.match_patterns",
    IPPPrincipalRules.INCLUDED
  ),
]);
