/* Any copyright is dedicated to the Public Domain.
https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { MatchPatternPrefRule } = ChromeUtils.importESModule(
  "moz-src:///toolkit/components/ipprotection/SiteRuleProviders.sys.mjs"
);

const PREF = "browser.ipProtection.test.match_patterns";

const makePrincipal = url =>
  Services.scriptSecurityManager.createContentPrincipal(
    Services.io.newURI(url),
    {}
  );

const setPatterns = patterns =>
  Services.prefs.setStringPref(PREF, JSON.stringify(patterns));

registerCleanupFunction(() => {
  Services.prefs.clearUserPref(PREF);
});

/**
 * A matching origin gets whichever rule the instance was built with, whatever
 * the path, and anything else is left to the next provider.
 */
add_task(function test_applies_the_configured_rule() {
  setPatterns(["*://listed.example/*"]);

  for (const rule of [IPPPrincipalRules.INCLUDED, IPPPrincipalRules.EXCLUDED]) {
    const provider = new MatchPatternPrefRule(PREF, rule);
    provider.init();

    Assert.equal(
      provider.getRule(makePrincipal("https://listed.example/deep/path?q=1")),
      rule,
      `a listed origin -> ${rule}`
    );
    Assert.equal(
      provider.getRule(makePrincipal("https://example.com/")),
      null,
      "an unlisted origin gets no opinion"
    );

    provider.uninit();
  }
});

/**
 * The pattern set follows the pref, so a remote push takes effect without a
 * restart. A pref that is not a JSON array throws instead of quietly matching
 * nothing, which the manager turns into a fail-closed EXCLUDED.
 */
add_task(async function test_tracks_pref_changes() {
  setPatterns(["*://old.example/*"]);

  const provider = new MatchPatternPrefRule(PREF, IPPPrincipalRules.INCLUDED);
  provider.init();

  const changed = waitForEvent(provider, "change");
  setPatterns(["*://new.example/*"]);
  await changed;

  Assert.equal(
    provider.getRule(makePrincipal("https://new.example/")),
    IPPPrincipalRules.INCLUDED,
    "the newly listed origin is included"
  );
  Assert.equal(
    provider.getRule(makePrincipal("https://old.example/")),
    null,
    "the removed origin is not"
  );

  provider.uninit();

  Services.prefs.setStringPref(PREF, JSON.stringify({}));
  Assert.throws(
    () => new MatchPatternPrefRule(PREF, IPPPrincipalRules.INCLUDED).init(),
    /does not contain a JSON array/,
    "a pref that is not a JSON array throws"
  );
});
