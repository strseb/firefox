/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { PrivateBrowsingUtils } from "resource://gre/modules/PrivateBrowsingUtils.sys.mjs";
import { IPPEarlyStartupFilter } from "moz-src:///toolkit/components/ipprotection/IPPEarlyStartupFilter.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  IPPAutoRestoreHelper:
    "moz-src:///toolkit/components/ipprotection/IPPAutoRestore.sys.mjs",
  IPPExceptionsManager:
    "moz-src:///toolkit/components/ipprotection/IPPExceptionsManager.sys.mjs",
  IPProtectionServerlist:
    "moz-src:///toolkit/components/ipprotection/IPProtectionServerlist.sys.mjs",
  IPPProxyManager:
    "moz-src:///toolkit/components/ipprotection/IPPProxyManager.sys.mjs",
  IPPProxyModes:
    "moz-src:///toolkit/components/ipprotection/IPPProxyManager.sys.mjs",
  IPPProxyStates:
    "moz-src:///toolkit/components/ipprotection/IPPProxyManager.sys.mjs",
  IPProtectionService:
    "moz-src:///toolkit/components/ipprotection/IPProtectionService.sys.mjs",
  IPProtectionStates:
    "moz-src:///toolkit/components/ipprotection/IPProtectionService.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "logConsole", () =>
  console.createInstance({
    prefix: "IPPInclusionActivator",
    maxLogLevel: Services.prefs.getBoolPref("browser.ipProtection.log", false)
      ? "Debug"
      : "Warn",
  })
);

/**
 * Keeps the sites the user marked as always using the VPN covered.
 *
 * Such a site is only proxied while the connection is up, so this class brings
 * the proxy up in inclusion mode whenever it is idle: at startup, and after the
 * user turns the VPN off. Owning that decision here is what lets the panel and
 * the GeckoView layer stay unaware of inclusions - they start and stop the
 * proxy, and this class puts the narrow connection back.
 *
 * Full protection always wins: a connection in any other mode is left alone.
 */
export class IPPInclusionActivatorSingleton {
  #initialized = false;
  #serviceReady = false;

  constructor() {
    this.handleServiceEvent = this.#handleServiceEvent.bind(this);
    this.handleProxyEvent = this.#handleProxyEvent.bind(this);
  }

  /**
   * Whether a narrow connection should be kept up.
   *
   * A pending auto-restore takes precedence: it brings the proxy up in full
   * mode, which covers the included sites as well.
   *
   * @returns {boolean}
   */
  get shouldActivate() {
    return (
      lazy.IPProtectionServerlist.hasList &&
      !lazy.IPPAutoRestoreHelper.willAutoRestore &&
      lazy.IPPExceptionsManager.getInclusionCount() > 0
    );
  }

  init() {
    if (this.#initialized) {
      return;
    }
    this.#initialized = true;

    lazy.IPProtectionService.addEventListener(
      "IPProtectionService:StateChanged",
      this.handleServiceEvent
    );
    lazy.IPPProxyManager.addEventListener(
      "IPPProxyManager:StateChanged",
      this.handleProxyEvent
    );
  }

  initOnStartupCompleted() {}

  uninit() {
    if (!this.#initialized) {
      return;
    }
    this.#initialized = false;
    this.#serviceReady = false;

    lazy.IPProtectionService.removeEventListener(
      "IPProtectionService:StateChanged",
      this.handleServiceEvent
    );
    lazy.IPPProxyManager.removeEventListener(
      "IPPProxyManager:StateChanged",
      this.handleProxyEvent
    );
  }

  #handleServiceEvent() {
    const serviceReady =
      lazy.IPProtectionService.state === lazy.IPProtectionStates.READY;
    this.#serviceReady = serviceReady;

    if (serviceReady) {
      this.#maybeActivate();
    }
  }

  #handleProxyEvent() {
    // Only an idle proxy is ours to start. Every other state either already
    // carries the included sites or is one the user has to resolve, like an
    // error or an exhausted quota.
    if (lazy.IPPProxyManager.state === lazy.IPPProxyStates.READY) {
      this.#maybeActivate();
    }
  }

  #maybeActivate() {
    if (
      !this.#serviceReady ||
      lazy.IPPProxyManager.state !== lazy.IPPProxyStates.READY ||
      !this.shouldActivate
    ) {
      return;
    }

    lazy.logConsole.info("Starting proxy for the included sites");
    lazy.IPPProxyManager.start({
      userAction: false,
      inPrivateBrowsing: PrivateBrowsingUtils.permanentPrivateBrowsing,
      mode: lazy.IPPProxyModes.INCLUSION,
    });
  }
}

const IPPInclusionActivator = new IPPInclusionActivatorSingleton();

const IPPInclusionActivatorHelpers = [
  IPPInclusionActivator,
  new IPPEarlyStartupFilter(() => IPPInclusionActivator.shouldActivate),
];

export { IPPInclusionActivator, IPPInclusionActivatorHelpers };
