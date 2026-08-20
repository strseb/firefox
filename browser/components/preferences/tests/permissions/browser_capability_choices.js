/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use strict";

const ONBOARDING_MESSAGE_MASK_PREF =
  "browser.ipProtection.onboardingMessageMask";

// capabilityChoices isn't exclusive to any permission type, ipp-vpn is used
// here because it is the first type offering a per-row picker.
const PERM_TYPE = "ipp-vpn";
const DENY = Ci.nsIPermissionManager.DENY_ACTION;
const ALLOW = Ci.nsIPermissionManager.ALLOW_ACTION;

const DENIED_SITE = "https://denied.example.com";
const ALLOWED_SITE = "https://allowed.example.com";

const principalFor = site =>
  Services.scriptSecurityManager.createContentPrincipalFromOrigin(site);

function addPermission(site, capability) {
  Services.perms.addFromPrincipal(principalFor(site), PERM_TYPE, capability);
}

function getCapability(site) {
  return Services.perms.getPermissionObject(
    principalFor(site),
    PERM_TYPE,
    true /* exactHost */
  )?.capability;
}

function cleanup() {
  Services.perms.removeByType(PERM_TYPE);
  Services.prefs.clearUserPref(ONBOARDING_MESSAGE_MASK_PREF);
}

/**
 * Opens the permissions dialog offering both rules as choices, with two sites
 * already saved: one DENY and one ALLOW.
 *
 * @param {Browser} browser
 *  The about:preferences browser.
 * @returns {Window} The dialog window.
 */
async function openDialogWithChoices(browser) {
  addPermission(DENIED_SITE, DENY);
  addPermission(ALLOWED_SITE, ALLOW);

  let dialogLoaded = TestUtils.topicObserved("subdialog-loaded");

  browser.contentWindow.gSubDialog.open(
    "chrome://browser/content/preferences/dialogs/permissions.xhtml",
    { features: "resizable=yes" },
    {
      addVisible: true,
      prefilledHost: "",
      permissionType: PERM_TYPE,
      capabilityChoices: [DENY, ALLOW],
    }
  );

  let [dialogWin] = await dialogLoaded;
  await dialogWin.document.mozSubdialogReady;

  let permissionsBox = dialogWin.document.getElementById("permissionsBox");
  await BrowserTestUtils.waitForMutationCondition(
    permissionsBox,
    { childList: true, subtree: true },
    () => permissionsBox.itemCount === 2
  );

  return dialogWin;
}

function getPicker(doc, origin) {
  return doc
    .querySelector(`richlistitem[origin="${origin}"]`)
    ?.querySelector("menulist");
}

/**
 * Every capability in capabilityChoices is listed, no matter which one the
 * dialog was opened on, and each row's picker shows that site's rule.
 */
add_task(async function test_rows_show_a_picker_per_capability() {
  await BrowserTestUtils.withNewTab("about:preferences", async browser => {
    let dialog = await openDialogWithChoices(browser);
    let doc = dialog.document;

    let deniedPicker = getPicker(doc, DENIED_SITE);
    let allowedPicker = getPicker(doc, ALLOWED_SITE);

    Assert.ok(deniedPicker, `${DENIED_SITE} is listed with a picker`);
    Assert.ok(allowedPicker, `${ALLOWED_SITE} is listed with a picker`);

    Assert.equal(
      Number(deniedPicker.value),
      DENY,
      "The picker shows DENY_ACTION for the denied site"
    );
    Assert.equal(
      Number(allowedPicker.value),
      ALLOW,
      "The picker shows ALLOW_ACTION for the allowed site"
    );
    Assert.equal(
      deniedPicker.itemCount,
      2,
      "Both choices are offered, regardless of the site's current rule"
    );

    doc.querySelector("dialog").getButton("cancel").click();
  });

  cleanup();
});

/**
 * Picking another rule for a row is only written to the permission manager once
 * the dialog is accepted.
 */
add_task(async function test_picking_a_rule_writes_on_accept() {
  await BrowserTestUtils.withNewTab("about:preferences", async browser => {
    let dialog = await openDialogWithChoices(browser);
    let doc = dialog.document;

    getPicker(doc, DENIED_SITE)
      .querySelector(`menuitem[value="${ALLOW}"]`)
      .doCommand();

    Assert.equal(
      getCapability(DENIED_SITE),
      DENY,
      "The permission is unchanged before saving"
    );

    doc.querySelector("dialog").getButton("accept").click();

    await TestUtils.waitForCondition(
      () => getCapability(DENIED_SITE) === ALLOW,
      "The picked rule is saved"
    );
    Assert.equal(
      getCapability(ALLOWED_SITE),
      ALLOW,
      "The untouched site keeps its rule"
    );
  });

  cleanup();
});

/**
 * Cancelling the dialog discards a picked rule.
 */
add_task(async function test_picking_a_rule_is_discarded_on_cancel() {
  await BrowserTestUtils.withNewTab("about:preferences", async browser => {
    let dialog = await openDialogWithChoices(browser);
    let doc = dialog.document;

    getPicker(doc, ALLOWED_SITE)
      .querySelector(`menuitem[value="${DENY}"]`)
      .doCommand();

    doc.querySelector("dialog").getButton("cancel").click();

    Assert.equal(
      getCapability(ALLOWED_SITE),
      ALLOW,
      "The permission is unchanged after cancelling"
    );
  });

  cleanup();
});
