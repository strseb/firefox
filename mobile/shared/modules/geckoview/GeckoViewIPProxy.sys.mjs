/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { GeckoViewUtils } from "resource://gre/modules/GeckoViewUtils.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  EventDispatcher: "resource://gre/modules/Messaging.sys.mjs",
  IPPProxyManager:
    "moz-src:///toolkit/components/ipprotection/IPPProxyManager.sys.mjs",
  IPProtectionActivator:
    "moz-src:///toolkit/components/ipprotection/IPProtectionActivator.sys.mjs",
});

const { debug, warn } = GeckoViewUtils.initLogging("GeckoViewIPProxy");

let initialized = false;
let listening = false;

function ensureInitialized() {
  if (initialized) {
    return;
  }
  initialized = true;
  lazy.IPProtectionActivator.init();
}

function ensureListening() {
  if (listening) {
    return;
  }
  listening = true;
  lazy.IPPProxyManager.addEventListener(
    "IPPProxyManager:StateChanged",
    GeckoViewIPProxy
  );
  lazy.IPPProxyManager.addEventListener(
    "IPPProxyManager:UsageChanged",
    GeckoViewIPProxy
  );
}

function buildStateResponse() {
  const manager = lazy.IPPProxyManager;
  const response = { state: manager.state };

  if (manager.state === "error" && manager.errors.length > 0) {
    response.lastError = manager.errors[manager.errors.length - 1];
  }

  const usage = manager.usageInfo;
  if (usage) {
    response.remaining = usage.remaining;
    response.max = usage.max;
    if (usage.reset) {
      response.resetTime = usage.reset.toString();
    }
  }

  return response;
}

export const GeckoViewIPProxy = {
  handleEvent(event) {
    switch (event.type) {
      case "IPPProxyManager:StateChanged": {
        const data = { state: event.detail.state };
        const manager = lazy.IPPProxyManager;
        if (
          event.detail.state === "error" &&
          manager.errors.length > 0
        ) {
          data.lastError = manager.errors[manager.errors.length - 1];
        }
        lazy.EventDispatcher.instance.sendRequest(
          "GeckoView:IPProxy:StateChanged",
          data
        );
        break;
      }
      case "IPPProxyManager:UsageChanged": {
        const usage = event.detail.usage;
        const data = {
          remaining: usage.remaining,
          max: usage.max,
        };
        if (usage.reset) {
          data.resetTime = usage.reset.toString();
        }
        lazy.EventDispatcher.instance.sendRequest(
          "GeckoView:IPProxy:UsageChanged",
          data
        );
        break;
      }
    }
  },

  onEvent(aEvent, aData, aCallback) {
    debug`onEvent ${aEvent}`;

    ensureInitialized();
    ensureListening();

    switch (aEvent) {
      case "GeckoView:IPProxy:GetState": {
        aCallback.onSuccess(buildStateResponse());
        break;
      }
      case "GeckoView:IPProxy:Activate": {
        lazy.IPPProxyManager.start()
          .then(() => {
            aCallback.onSuccess({
              ok: true,
              state: lazy.IPPProxyManager.state,
            });
          })
          .catch(err => {
            aCallback.onError(`Activation failed: ${err}`);
          });
        break;
      }
      case "GeckoView:IPProxy:Deactivate": {
        lazy.IPPProxyManager.stop()
          .then(() => {
            aCallback.onSuccess({
              ok: true,
              state: lazy.IPPProxyManager.state,
            });
          })
          .catch(err => {
            aCallback.onError(`Deactivation failed: ${err}`);
          });
        break;
      }
    }
  },
};
