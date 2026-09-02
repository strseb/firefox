/* Any copyright is dedicated to the Public Domain.
https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const PERM_NAME = "ipp-vpn";
const INCLUSION_PREF = "browser.ipProtection.inclusion.match_patterns";
const GUARDIAN_PREF = "browser.ipProtection.guardian.endpoint";

const makePrincipal = url =>
  Services.scriptSecurityManager.createContentPrincipal(
    Services.io.newURI(url),
    {}
  );

// Every provider in the singleton's array claims one of these origins, so a
// single configuration is enough to pin down which providers are wired in and
// in what order. Each origin a lower-precedence provider would also claim is
// deliberately overlapped: localhost and guardian.example are in the inclusion
// list, and included.example carries a user exclusion.
const UNPROXYABLE = "http://localhost";
const INFRASTRUCTURE = "https://guardian.example";
const INCLUDED = "https://included.example";
const USER_EXCLUDED = "https://user-excluded.example";
const UNCLAIMED = "https://plain.example";

function setUpRules() {
  Services.perms.removeByType(PERM_NAME);
  Services.prefs.setStringPref(GUARDIAN_PREF, `${INFRASTRUCTURE}/api`);
  Services.prefs.setStringPref(
    INCLUSION_PREF,
    JSON.stringify([
      "*://included.example/*",
      "*://guardian.example/*",
      "*://localhost/*",
    ])
  );

  IPPSiteRuleManager.init();
  IPPPermissionRules.setRule(
    makePrincipal(INCLUDED),
    IPPPrincipalRules.EXCLUDED
  );
  IPPPermissionRules.setRule(
    makePrincipal(USER_EXCLUDED),
    IPPPrincipalRules.EXCLUDED
  );
}

registerCleanupFunction(() => {
  IPPSiteRuleManager.uninit();
  Services.perms.removeByType(PERM_NAME);
  Services.prefs.clearUserPref(GUARDIAN_PREF);
  Services.prefs.clearUserPref(INCLUSION_PREF);
});

/**
 * Each provider is reachable through the singleton, and the array order is the
 * precedence the UI and the channel filter rely on.
 */
add_task(function test_provider_precedence() {
  setUpRules();

  Assert.equal(
    IPPSiteRuleManager.getRule(makePrincipal(UNPROXYABLE)),
    IPPPrincipalRules.EXCLUDED,
    "unproxyable traffic beats the inclusion list"
  );
  Assert.equal(
    IPPSiteRuleManager.getRule(makePrincipal(INFRASTRUCTURE)),
    IPPPrincipalRules.EXCLUDED,
    "VPN infrastructure beats the inclusion list"
  );
  Assert.equal(
    IPPSiteRuleManager.getRule(makePrincipal(INCLUDED)),
    IPPPrincipalRules.INCLUDED,
    "the inclusion list beats a user exclusion on the same site"
  );
  Assert.equal(
    IPPSiteRuleManager.getRule(makePrincipal(USER_EXCLUDED)),
    IPPPrincipalRules.EXCLUDED,
    "a user exclusion applies when nothing above it claims the site"
  );
  Assert.equal(
    IPPSiteRuleManager.getRule(makePrincipal(UNCLAIMED)),
    IPPPrincipalRules.DEFAULT,
    "no provider claims an ordinary site"
  );
});

/**
 * The permission store is reachable for the sites the UI offers a toggle for,
 * and masked for the ones it must not. Which providers claim which origin is
 * pinned above; that a claim blocks a write is covered by test_SiteRuleManager.
 */
add_task(function test_canManage() {
  setUpRules();

  Assert.ok(
    !IPPSiteRuleManager.canManage(makePrincipal(INCLUDED)),
    "a site pinned by the inclusion list is not manageable"
  );
  Assert.ok(
    IPPSiteRuleManager.canManage(makePrincipal(UNCLAIMED)),
    "an unclaimed site is manageable"
  );
  Assert.ok(
    IPPSiteRuleManager.canManage(makePrincipal(USER_EXCLUDED)),
    "a site the user already set stays manageable, so it can be toggled back"
  );
});
