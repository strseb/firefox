/* Any copyright is dedicated to the Public Domain.
https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { IPPInclusionActivatorSingleton } = ChromeUtils.importESModule(
  "moz-src:///toolkit/components/ipprotection/IPPInclusionActivator.sys.mjs"
);
const { IPProtectionServerlist } = ChromeUtils.importESModule(
  "moz-src:///toolkit/components/ipprotection/IPProtectionServerlist.sys.mjs"
);

const AUTORESTORE_PREF = "browser.ipProtection.autoRestoreEnabled";
const USER_ENABLED_PREF = "browser.ipProtection.userEnabled";
const PERM_NAME = "ipp-vpn";

const SITE = "https://always-on.example.com";

add_setup(async function () {
  await putServerInRemoteSettings();
  await IPProtectionServerlist.maybeFetchList();
  await IPProtectionServerlist.initOnStartupCompleted();

  IPProtectionService.uninit();

  registerCleanupFunction(async () => {
    Services.perms.removeByType(PERM_NAME);
    Services.prefs.clearUserPref(AUTORESTORE_PREF);
    Services.prefs.clearUserPref(USER_ENABLED_PREF);
    await IPProtectionService.init();
  });
});

function addRule(capability) {
  Services.perms.addFromPrincipal(
    Services.scriptSecurityManager.createContentPrincipalFromOrigin(SITE),
    PERM_NAME,
    capability
  );
}

/**
 * Registers a fresh activator as a helper so IPProtectionService initializes it
 * after IPPProxyManager, then drives the service to READY.
 *
 * @returns {Promise<IPPInclusionActivatorSingleton>}
 */
async function initServiceWithActivator() {
  const activator = new IPPInclusionActivatorSingleton();
  IPProtectionActivator.addHelpers([activator]);
  IPProtectionActivator.setupHelpers();

  setupStubs();

  const readyEvent = waitForEvent(
    IPProtectionService,
    "IPProtectionService:StateChanged",
    () => IPProtectionService.state === IPProtectionStates.READY
  );
  IPProtectionService.init();
  await readyEvent;

  if (IPPProxyManager.state === IPPProxyStates.ACTIVATING) {
    await waitForProxyState(IPPProxyStates.ACTIVE);
  }

  return activator;
}

async function cleanup(activator) {
  activator.uninit();
  if (IPPProxyManager.state !== IPPProxyStates.READY) {
    await IPPProxyManager.stop(false);
  }
  IPProtectionService.uninit();
  IPProtectionActivator.removeHelpers();
  IPProtectionActivator.setupHelpers();
  Services.perms.removeByType(PERM_NAME);
  Services.prefs.clearUserPref(AUTORESTORE_PREF);
  Services.prefs.clearUserPref(USER_ENABLED_PREF);
}

/**
 * A site marked as always using the VPN brings the proxy up in inclusion mode.
 */
add_task(async function test_starts_in_inclusion_mode() {
  addRule(Ci.nsIPermissionManager.ALLOW_ACTION);

  const activator = await initServiceWithActivator();

  Assert.equal(
    IPPProxyManager.state,
    IPPProxyStates.ACTIVE,
    "An inclusion should start the proxy"
  );
  Assert.equal(
    IPPProxyManager.mode,
    IPPProxyModes.INCLUSION,
    "The proxy should only route the included sites"
  );

  await cleanup(activator);
});

/**
 * Without an inclusion there is nothing to keep up.
 */
add_task(async function test_does_not_start_without_inclusions() {
  const activator = await initServiceWithActivator();

  Assert.ok(!activator.shouldActivate, "The activator should stand down");
  Assert.equal(
    IPPProxyManager.state,
    IPPProxyStates.READY,
    "The proxy should stay idle"
  );

  await cleanup(activator);
});

/**
 * An exclusion is not an inclusion.
 */
add_task(async function test_exclusion_does_not_start() {
  addRule(Ci.nsIPermissionManager.DENY_ACTION);

  const activator = await initServiceWithActivator();

  Assert.ok(!activator.shouldActivate, "The activator should stand down");
  Assert.equal(
    IPPProxyManager.state,
    IPPProxyStates.READY,
    "The proxy should stay idle"
  );

  await cleanup(activator);
});

/**
 * Stopping the proxy - the panel's off switch - leaves the included sites
 * covered: the activator brings a narrow connection back.
 */
add_task(async function test_restarts_after_the_proxy_is_stopped() {
  addRule(Ci.nsIPermissionManager.ALLOW_ACTION);

  const activator = await initServiceWithActivator();

  // Widen it the way the panel does, so the restart is observable.
  await IPPProxyManager.start({ mode: IPPProxyModes.FULL });
  Assert.equal(
    IPPProxyManager.mode,
    IPPProxyModes.FULL,
    "The connection is full before stopping"
  );

  await IPPProxyManager.stop();
  await waitForProxyState(IPPProxyStates.ACTIVE);

  Assert.equal(
    IPPProxyManager.mode,
    IPPProxyModes.INCLUSION,
    "Stopping should leave a connection for the included sites"
  );

  await cleanup(activator);
});

/**
 * With no included site left, stopping the proxy stops it for good.
 */
add_task(async function test_stays_stopped_without_inclusions() {
  addRule(Ci.nsIPermissionManager.ALLOW_ACTION);

  const activator = await initServiceWithActivator();

  Services.perms.removeByType(PERM_NAME);
  await IPPProxyManager.stop();

  Assert.equal(
    IPPProxyManager.state,
    IPPProxyStates.READY,
    "Nothing should bring the proxy back"
  );

  await cleanup(activator);
});

/**
 * A pending auto-restore owns the session: it brings the proxy up in full mode,
 * so the activator stands down instead of racing it.
 */
add_task(async function test_pending_auto_restore_wins() {
  Services.prefs.setBoolPref(AUTORESTORE_PREF, true);
  Services.prefs.setBoolPref(USER_ENABLED_PREF, true);
  addRule(Ci.nsIPermissionManager.ALLOW_ACTION);

  const activator = await initServiceWithActivator();

  Assert.ok(
    !activator.shouldActivate,
    "The activator should stand down for a pending auto-restore"
  );
  Assert.equal(
    IPPProxyManager.state,
    IPPProxyStates.READY,
    "The activator should leave the session to auto-restore"
  );

  await cleanup(activator);
});
