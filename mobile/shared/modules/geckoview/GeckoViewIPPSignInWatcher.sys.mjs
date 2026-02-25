/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  IPPSignInWatcher:
    "moz-src:///toolkit/components/ipprotection/IPPSignInWatcher.sys.mjs",
  IPProtectionService:
    "moz-src:///toolkit/components/ipprotection/IPProtectionService.sys.mjs",
});

/**
 * GeckoView implementation of sign-in state. Starts not-signed-in.
 * Registers itself as the backing implementation of the IPPSignInWatcher proxy.
 * The embedding app calls signIn(token, type) to authenticate.
 */
class GeckoViewIPPSignInWatcherImpl extends EventTarget {
  #signedIn = false;
  token = null;
  type = "";

  get isSignedIn() {
    return this.#signedIn;
  }

  init() {
    lazy.IPPSignInWatcher.setImplementation(this);
  }

  initOnStartupCompleted() {}

  uninit() {
    this.token = null;
    this.type = "";
    this.#signedIn = false;
  }

  signIn(token, type = "") {
    this.token = token;
    this.type = type;
    this.#signedIn = true;
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
