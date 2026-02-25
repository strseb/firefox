/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  GuardianClient:
    "moz-src:///toolkit/components/ipprotection/GuardianClient.sys.mjs",
  IPPSignInWatcher:
    "moz-src:///toolkit/components/ipprotection/IPPSignInWatcher.sys.mjs",
  IPProtectionService:
    "moz-src:///toolkit/components/ipprotection/IPProtectionService.sys.mjs",
});

const gvConfig = {
  withToken: async cb => {
    const token = GeckoViewIPPSignInWatcher.token;
    if (!token) {
      return null;
    }
    return cb(token);
  },
  guardianEndpoint: "",
  fxaOrigin: "",
};
XPCOMUtils.defineLazyPreferenceGetter(
  gvConfig,
  "guardianEndpoint",
  "browser.ipProtection.guardian.endpoint",
  "https://vpn.mozilla.com"
);
XPCOMUtils.defineLazyPreferenceGetter(
  gvConfig,
  "fxaOrigin",
  "identity.fxaccounts.remote.root"
);

/**
 * GeckoView implementation of sign-in state. Starts not-signed-in.
 * Registers itself as the backing implementation of the IPPSignInWatcher proxy.
 * The embedding app calls signIn(token, type) to authenticate.
 */
class GeckoViewIPPSignInWatcherImpl extends EventTarget {
  #signedIn = false;
  #guardianClient = null;
  token = null;
  type = "";

  get isSignedIn() {
    return this.#signedIn;
  }

  get guardianClient() {
    return this.#guardianClient;
  }

  init() {
    lazy.IPPSignInWatcher.setImplementation(this);
  }

  initOnStartupCompleted() {}

  uninit() {
    this.token = null;
    this.type = "";
    this.#signedIn = false;
    this.#guardianClient = null;
  }

  signIn(token, type = "") {
    this.token = token;
    this.type = type;
    this.#signedIn = true;
    this.#guardianClient = new lazy.GuardianClient(gvConfig);
    lazy.IPProtectionService.updateState();
    this.dispatchEvent(
      new CustomEvent("IPPSignInWatcher:StateChanged", {
        bubbles: true,
        composed: true,
      })
    );
  }

  signOut() {
    this.token = null;
    this.type = "";
    this.#signedIn = false;
    this.#guardianClient = null;
    lazy.IPProtectionService.updateState();
    this.dispatchEvent(
      new CustomEvent("IPPSignInWatcher:StateChanged", {
        bubbles: true,
        composed: true,
      })
    );
  }
}

export const GeckoViewIPPSignInWatcher = new GeckoViewIPPSignInWatcherImpl();
