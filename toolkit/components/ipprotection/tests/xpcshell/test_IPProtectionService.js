/* Any copyright is dedicated to the Public Domain.
https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { AddonTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/AddonTestUtils.sys.mjs"
);
const { ExtensionTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/ExtensionXPCShellUtils.sys.mjs"
);
const { IPPAuthProvider } = ChromeUtils.importESModule(
  "moz-src:///toolkit/components/ipprotection/IPPAuthProvider.sys.mjs"
);

do_get_profile();

AddonTestUtils.init(this);
AddonTestUtils.createAppInfo(
  "xpcshell@tests.mozilla.org",
  "XPCShell",
  "1",
  "1"
);

ExtensionTestUtils.init(this);

add_setup(async function () {
  await putServerInRemoteSettings();
  IPProtectionService.uninit();

  registerCleanupFunction(async () => {
    await IPProtectionService.init();
  });
});

/**
 * Tests that a signed in status sends a status changed event.
 */
add_task(async function test_IPProtectionService_updateState_signedIn() {
  await IPProtectionService.init();

  setupStubs();

  let signedInEventPromise = waitForEvent(
    IPProtectionService,
    "IPProtectionService:StateChanged",
    () => IPProtectionService.state === IPProtectionStates.READY
  );

  IPProtectionService.updateState();

  await signedInEventPromise;

  Assert.ok(
    IPProtectionService.authProvider.isReady,
    "Auth provider should be ready after update"
  );

  IPProtectionService.uninit();
});

/**
 * Tests that any other status sends a changed event event.
 */
add_task(async function test_IPProtectionService_updateState_signedOut() {
  setupStubs();

  await IPProtectionService.init();

  IPPDummyAuthProvider.simulateSignIn(false);

  let signedOutEventPromise = waitForEvent(
    IPProtectionService,
    "IPProtectionService:StateChanged",
    () => IPProtectionService.state === IPProtectionStates.UNAUTHENTICATED
  );

  IPProtectionService.updateState();

  await signedOutEventPromise;

  Assert.ok(
    !IPProtectionService.authProvider.isReady,
    "Auth provider should not be ready after sign-out"
  );

  IPProtectionService.uninit();
});

/**
 * Tests that signing off generates a reset of the entitlement and the sending
 * of an event.
 */
add_task(async function test_IPProtectionService_hasUpgraded_signed_out() {
  setupStubs();

  await IPProtectionService.init();
  await IPProtectionService.authProvider.enroll();
  IPProtectionService.updateState();

  IPPDummyAuthProvider.simulateSignIn(false);

  let signedOutEventPromise = waitForEvent(
    IPProtectionService,
    "IPProtectionService:StateChanged"
  );
  IPProtectionService.updateState();

  await signedOutEventPromise;

  Assert.ok(
    !IPProtectionService.authProvider.hasUpgraded,
    "hasUpgraded should be false in after signing out"
  );

  IPProtectionService.uninit();
});

/**
 * Tests that isEnrolling is true while maybeEnrollAndEntitle is in progress and
 * false once it completes.
 */
add_task(async function test_isEnrolling_during_maybeEnrollAndEntitle() {
  setupStubs();

  await IPProtectionService.init();

  // initOnStartupCompleted() runs updateEntitlement() which sets the
  // entitlement via the configured getEntitlement response. Reset it so that
  // enroll() takes the slow path and isEnrolling stays true while in progress.
  IPPDummyAuthProvider.resetEntitlement();

  let resolveEnroll;
  // Slow down enrolling step info so that we can properly test
  // isEnrolling. The promise only resolves when we call resolveEnroll().
  IPPDummyAuthProvider.setEnrollResponse(
    new Promise(resolve => {
      resolveEnroll = resolve;
    })
  );

  Assert.ok(
    !IPPDummyAuthProvider.isEnrolling,
    "isEnrolling should be false before maybeEnrollAndEntitle"
  );

  let enrollPromise = IPPDummyAuthProvider.enroll();

  Assert.ok(
    IPPDummyAuthProvider.isEnrolling,
    "isEnrolling should be true while maybeEnrollAndEntitle is in progress"
  );

  let stateChangedFired = false;
  IPProtectionService.addEventListener(
    "IPProtectionService:AuthStateChanged",
    () => {
      stateChangedFired = true;
    },
    { once: true }
  );

  resolveEnroll({ isEnrolledAndEntitled: true });
  await enrollPromise;

  Assert.ok(
    !IPPDummyAuthProvider.isEnrolling,
    "isEnrolling should be false after maybeEnrollAndEntitle completes"
  );
  Assert.ok(
    stateChangedFired,
    "StateChanged should fire after maybeEnrollAndEntitle completes"
  );

  IPProtectionService.uninit();
});

const LIFECYCLE = ["init", "uninit", "initOnStartupCompleted"];
const FULL_LIFECYCLE = ["init", "initOnStartupCompleted", "uninit"];

/**
 * An auth provider that records the lifecycle calls made on it and on a second
 * helper it owns, like the FxA provider's signInWatcher.
 *
 * @param {boolean|Function} [isReady] - What the provider reports as isReady,
 *  or a callback returning it so a test can flip it mid-swap.
 * @param {string} [failOn] - Name of a lifecycle method that should fail.
 * @returns {Proxy} - The provider, with `calls` and `helper.calls` to assert on.
 */
function createRecordingProvider(isReady = true, failOn = null) {
  const calls = [];
  const helper = { calls: [] };
  LIFECYCLE.forEach(name => (helper[name] = () => helper.calls.push(name)));

  const provider = new Proxy(new IPPAuthProvider(), {
    get(target, property) {
      if (LIFECYCLE.includes(property)) {
        return () => {
          calls.push(property);
          if (property !== failOn) {
            return undefined;
          }
          const error = new Error(`${property} failed`);
          // The real initOnStartupCompleted hooks are async, the others are not.
          if (property === "initOnStartupCompleted") {
            return Promise.reject(error);
          }
          throw error;
        };
      }
      switch (property) {
        case "isReady":
          return typeof isReady === "function" ? isReady() : isReady;
        case "helpers":
          return [provider, helper];
        case "helper":
          return helper;
        case "calls":
          return calls;
      }
      // Bind so DOM methods like addEventListener run with the real
      // EventTarget as `this` rather than this proxy.
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return provider;
}

/**
 * Tests that swapping the provider on a running service moves the lifecycle
 * from the old provider and its helpers to the new ones.
 */
add_task(async function test_setAuthProvider_swap_moves_lifecycle() {
  const from = createRecordingProvider();
  const to = createRecordingProvider();
  IPProtectionActivator.setAuthProvider(from);

  await initServiceToReady();

  IPProtectionActivator.setAuthProvider(to);

  Assert.equal(
    IPProtectionService.authProvider,
    to,
    "Service should report the new provider"
  );

  // uninit() walks the service's helper list, so it only reaches `to` and its
  // helper if the swap rebuilt that list.
  IPProtectionService.uninit();

  Assert.deepEqual(from.calls, FULL_LIFECYCLE, "Old provider swapped out once");
  Assert.deepEqual(
    from.helper.calls,
    FULL_LIFECYCLE,
    "Old provider's helper swapped out once"
  );
  Assert.deepEqual(to.calls, FULL_LIFECYCLE, "New provider swapped in once");
  Assert.deepEqual(
    to.helper.calls,
    FULL_LIFECYCLE,
    "New provider's helper swapped in once"
  );

  IPProtectionActivator.setAuthProvider(IPPDummyAuthProvider);
});

/**
 * Tests that the service republishes the current provider's auth state changes,
 * and stops republishing the ones from a provider it swapped out.
 */
add_task(async function test_setAuthProvider_forwards_auth_state() {
  const from = createRecordingProvider();
  const to = createRecordingProvider();
  IPProtectionActivator.setAuthProvider(from);

  await initServiceToReady();

  let forwarded = 0;
  const countForwarded = () => forwarded++;
  IPProtectionService.addEventListener(
    "IPProtectionService:AuthStateChanged",
    countForwarded
  );

  from.dispatchEvent(new CustomEvent("IPPAuthProvider:StateChanged"));
  Assert.equal(forwarded, 1, "The current provider's change is republished");

  IPProtectionActivator.setAuthProvider(to);

  // The swapped-out provider may still be alive and dispatching; consumers
  // listening on the service should no longer hear from it.
  from.dispatchEvent(new CustomEvent("IPPAuthProvider:StateChanged"));
  Assert.equal(forwarded, 1, "The old provider's change is not republished");

  to.dispatchEvent(new CustomEvent("IPPAuthProvider:StateChanged"));
  Assert.equal(forwarded, 2, "The new provider's change is republished");

  IPProtectionService.removeEventListener(
    "IPProtectionService:AuthStateChanged",
    countForwarded
  );
  IPProtectionService.uninit();
  IPProtectionActivator.setAuthProvider(IPPDummyAuthProvider);
});

/**
 * Tests that a helper throwing part-way through the swap still leaves the new
 * provider installed and the state recomputed, rather than stranding the
 * service on its pre-swap state.
 */
add_task(async function test_setAuthProvider_swap_helper_throws() {
  const ready = createRecordingProvider();
  const failing = createRecordingProvider(false, "init");
  IPProtectionActivator.setAuthProvider(ready);

  await initServiceToReady();

  Assert.throws(
    () => IPProtectionActivator.setAuthProvider(failing),
    /init failed/,
    "The failing helper should not be swallowed"
  );

  Assert.equal(
    IPProtectionService.authProvider,
    failing,
    "The new provider should be installed even though its init threw"
  );
  Assert.equal(
    IPProtectionService.state,
    IPProtectionStates.UNAUTHENTICATED,
    "The state should be recomputed even though a helper threw"
  );

  IPProtectionService.uninit();
  IPProtectionActivator.setAuthProvider(IPPDummyAuthProvider);
});

/**
 * Tests that a rejecting startup hook does not break the swap, and that the
 * state is recomputed once the hooks settle.
 */
add_task(async function test_setAuthProvider_swap_startup_hook_rejects() {
  const ready = createRecordingProvider();
  let becameReady = false;
  const rejecting = createRecordingProvider(
    () => becameReady,
    "initOnStartupCompleted"
  );
  IPProtectionActivator.setAuthProvider(ready);

  await initServiceToReady();

  const swapped = IPProtectionActivator.setAuthProvider(rejecting);

  Assert.equal(
    IPProtectionService.state,
    IPProtectionStates.UNAUTHENTICATED,
    "The synchronous part of the swap should recompute the state"
  );

  // Flip before the hooks settle: the state may only reach READY if the swap
  // recomputes again afterwards.
  becameReady = true;
  await swapped;

  Assert.equal(
    IPProtectionService.state,
    IPProtectionStates.READY,
    "The state should be recomputed once the startup hooks settle"
  );

  IPProtectionService.uninit();
  IPProtectionActivator.setAuthProvider(IPPDummyAuthProvider);
});

/**
 * Tests that swapping the provider recomputes the state, in both directions.
 */
add_task(async function test_setAuthProvider_swap_recomputes_state() {
  const ready = createRecordingProvider();
  const notReady = createRecordingProvider(false);
  IPProtectionActivator.setAuthProvider(ready);

  await initServiceToReady();

  // The state is recomputed synchronously, so assert it before awaiting the
  // event: a missing recomputation then fails here instead of timing out.
  let unauthenticatedEventPromise = waitForEvent(
    IPProtectionService,
    "IPProtectionService:StateChanged",
    () => IPProtectionService.state === IPProtectionStates.UNAUTHENTICATED
  );
  IPProtectionActivator.setAuthProvider(notReady);
  Assert.equal(
    IPProtectionService.state,
    IPProtectionStates.UNAUTHENTICATED,
    "Swapping in a provider that is not ready should recompute the state"
  );
  await unauthenticatedEventPromise;

  let readyEventPromise = waitForEvent(
    IPProtectionService,
    "IPProtectionService:StateChanged",
    () => IPProtectionService.state === IPProtectionStates.READY
  );
  IPProtectionActivator.setAuthProvider(ready);
  Assert.equal(
    IPProtectionService.state,
    IPProtectionStates.READY,
    "Swapping back to a ready provider should recompute the state"
  );
  await readyEventPromise;

  IPProtectionService.uninit();
  IPProtectionActivator.setAuthProvider(IPPDummyAuthProvider);
});
