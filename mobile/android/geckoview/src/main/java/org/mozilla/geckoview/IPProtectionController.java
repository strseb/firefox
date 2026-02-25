/* -*- Mode: Java; c-basic-offset: 4; tab-width: 20; indent-tabs-mode: nil; -*-
 * vim: ts=4 sw=4 expandtab:
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.geckoview;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.UiThread;
import org.mozilla.gecko.EventDispatcher;
import org.mozilla.gecko.util.BundleEventListener;
import org.mozilla.gecko.util.EventCallback;
import org.mozilla.gecko.util.GeckoBundle;
import org.mozilla.gecko.util.ThreadUtils;

/** Controller for managing IP protection state. */
public class IPProtectionController {

  /** Holds information about the current IP protection state and usage. */
  public static class StateInfo {
    /** The current service state (e.g. "uninitialized", "ready"). */
    public final @NonNull String serviceState;

    /** The current proxy state (e.g. "not-ready", "active"). */
    public final @NonNull String proxyState;

    /** The last error string, if the proxy state is "error". */
    public final @Nullable String lastError;

    /** Remaining usage allowance, or -1 if unavailable. */
    public final int remaining;

    /** Maximum usage allowance, or -1 if unavailable. */
    public final int max;

    /** The time when usage resets, as an ISO 8601 string, or null if unavailable. */
    public final @Nullable String resetTime;

    protected StateInfo() {
      serviceState = "";
      proxyState = "";
      lastError = null;
      remaining = -1;
      max = -1;
      resetTime = null;
    }

    /* package */ StateInfo(final @NonNull GeckoBundle bundle) {
      serviceState = bundle.getString("serviceState", "");
      proxyState = bundle.getString("proxyState", "");
      lastError = bundle.getString("lastError");
      remaining = bundle.getInt("remaining", -1);
      max = bundle.getInt("max", -1);
      resetTime = bundle.getString("resetTime");
    }
  }

  /** Delegate for receiving IP protection state notifications. */
  public interface Delegate {
    /**
     * Called when the IP protection state changes.
     *
     * @param info The current state information.
     */
    @UiThread
    default void onStateChanged(final @NonNull StateInfo info) {}
  }

  private Delegate mDelegate;
  private final BundleEventListener mEventListener;

  /* package */ IPProtectionController() {
    mEventListener = new EventListener();
    EventDispatcher.getInstance()
        .registerUiThreadListener(mEventListener, "GeckoView:IPProtection:StateChanged");
  }

  /**
   * Sets the {@link Delegate} for this instance.
   *
   * @param delegate The {@link Delegate} instance.
   */
  @UiThread
  public void setDelegate(final @Nullable Delegate delegate) {
    ThreadUtils.assertOnUiThread();
    mDelegate = delegate;
  }

  /**
   * Gets the {@link Delegate} for this instance.
   *
   * @return The {@link Delegate} instance.
   */
  @UiThread
  @Nullable
  public Delegate getDelegate() {
    ThreadUtils.assertOnUiThread();
    return mDelegate;
  }

  /**
   * Gets the current IP protection state.
   *
   * @return A {@link GeckoResult} that resolves to a {@link StateInfo} containing the current
   *     state.
   */
  @UiThread
  public @NonNull GeckoResult<StateInfo> getState() {
    ThreadUtils.assertOnUiThread();
    return EventDispatcher.getInstance()
        .queryBundle("GeckoView:IPProtection:GetState", null)
        .map(StateInfo::new);
  }

  /**
   * Activates the IP proxy.
   *
   * @return A {@link GeckoResult} that resolves on success.
   */
  @UiThread
  public @NonNull GeckoResult<Void> activate() {
    ThreadUtils.assertOnUiThread();
    return EventDispatcher.getInstance()
        .queryBundle("GeckoView:IPProtection:Activate", null)
        .map(bundle -> null);
  }

  /**
   * Deactivates the IP proxy.
   *
   * @return A {@link GeckoResult} that resolves on success.
   */
  @UiThread
  public @NonNull GeckoResult<Void> deactivate() {
    ThreadUtils.assertOnUiThread();
    return EventDispatcher.getInstance()
        .queryBundle("GeckoView:IPProtection:Deactivate", null)
        .map(bundle -> null);
  }

  /**
   * Signs in to IP protection with the given authentication token.
   *
   * @param token The authentication token.
   * @param type The token type (e.g. "Bearer"), or empty string.
   * @return A {@link GeckoResult} that resolves to the updated {@link StateInfo}.
   */
  @UiThread
  public @NonNull GeckoResult<StateInfo> signIn(
      final @NonNull String token, final @NonNull String type) {
    ThreadUtils.assertOnUiThread();
    final GeckoBundle bundle = new GeckoBundle(2);
    bundle.putString("token", token);
    bundle.putString("type", type);
    return EventDispatcher.getInstance()
        .queryBundle("GeckoView:IPProtection:SignIn", bundle)
        .map(StateInfo::new);
  }

  /**
   * Signs out of IP protection.
   *
   * @return A {@link GeckoResult} that resolves to the updated {@link StateInfo}.
   */
  @UiThread
  public @NonNull GeckoResult<StateInfo> signOut() {
    ThreadUtils.assertOnUiThread();
    return EventDispatcher.getInstance()
        .queryBundle("GeckoView:IPProtection:SignOut", null)
        .map(StateInfo::new);
  }

  private class EventListener implements BundleEventListener {
    @Override
    public void handleMessage(
        final String event, final GeckoBundle message, final EventCallback callback) {
      if (mDelegate == null) {
        return;
      }

      if ("GeckoView:IPProtection:StateChanged".equals(event)) {
        mDelegate.onStateChanged(new StateInfo(message));
      }
    }
  }
}
