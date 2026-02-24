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

/** Controller for managing IP protection proxy state. */
public class IPProxyController {

  /** Holds information about the current IP proxy state and usage. */
  public static class StateInfo {
    /** The current proxy state. */
    public final @NonNull String state;

    /** The last error string, if the state is "error". */
    public final @Nullable String lastError;

    /** Remaining usage allowance, or -1 if unavailable. */
    public final int remaining;

    /** Maximum usage allowance, or -1 if unavailable. */
    public final int max;

    /** The time when usage resets, as an ISO 8601 string, or null if unavailable. */
    public final @Nullable String resetTime;

    protected StateInfo() {
      state = "";
      lastError = null;
      remaining = -1;
      max = -1;
      resetTime = null;
    }

    /* package */ StateInfo(final @NonNull GeckoBundle bundle) {
      state = bundle.getString("state", "");
      lastError = bundle.getString("lastError");
      remaining = bundle.getInt("remaining", -1);
      max = bundle.getInt("max", -1);
      resetTime = bundle.getString("resetTime");
    }
  }

  /** Delegate for receiving IP proxy state and usage notifications. */
  public interface Delegate {
    /**
     * Called when the IP proxy state changes.
     *
     * @param state The new proxy state.
     * @param lastError The last error string, or null.
     */
    @UiThread
    default void onStateChanged(final @NonNull String state, final @Nullable String lastError) {}

    /**
     * Called when the IP proxy usage changes.
     *
     * @param remaining Remaining usage allowance.
     * @param max Maximum usage allowance.
     * @param resetTime The time when usage resets, or null.
     */
    @UiThread
    default void onUsageChanged(
        final int remaining, final int max, final @Nullable String resetTime) {}
  }

  private Delegate mDelegate;
  private final BundleEventListener mEventListener;

  /* package */ IPProxyController() {
    mEventListener = new EventListener();
    EventDispatcher.getInstance()
        .registerUiThreadListener(
            mEventListener, "GeckoView:IPProxy:StateChanged", "GeckoView:IPProxy:UsageChanged");
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
   * Gets the current IP proxy state.
   *
   * @return A {@link GeckoResult} that resolves to a {@link StateInfo} containing the current
   *     state.
   */
  @UiThread
  public @NonNull GeckoResult<StateInfo> getState() {
    ThreadUtils.assertOnUiThread();
    return EventDispatcher.getInstance()
        .queryBundle("GeckoView:IPProxy:GetState", null)
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
        .queryBundle("GeckoView:IPProxy:Activate", null)
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
        .queryBundle("GeckoView:IPProxy:Deactivate", null)
        .map(bundle -> null);
  }

  private class EventListener implements BundleEventListener {
    @Override
    public void handleMessage(
        final String event, final GeckoBundle message, final EventCallback callback) {
      if (mDelegate == null) {
        return;
      }

      switch (event) {
        case "GeckoView:IPProxy:StateChanged":
          mDelegate.onStateChanged(message.getString("state", ""), message.getString("lastError"));
          break;
        case "GeckoView:IPProxy:UsageChanged":
          mDelegate.onUsageChanged(
              message.getInt("remaining"), message.getInt("max"), message.getString("resetTime"));
          break;
      }
    }
  }
}
