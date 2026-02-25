/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.settings

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import org.mozilla.fenix.R
import org.mozilla.fenix.databinding.SettingsIpProtectionBinding
import org.mozilla.fenix.ext.components
import org.mozilla.geckoview.IPProxyController

class IpProtectionFragment : Fragment() {
    private var binding: SettingsIpProtectionBinding? = null
    private var controller: IPProxyController? = null

    private val delegate = object : IPProxyController.Delegate {
        override fun onStateChanged(state: String, lastError: String?) {
            updateUI(state, lastError)
        }
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        val b = SettingsIpProtectionBinding.inflate(inflater)
        binding = b

        val runtime = requireContext().components.core.geckoRuntime
        val ctrl = runtime.getIPProxyController()
        controller = ctrl

        ctrl.setDelegate(delegate)
        ctrl.state.accept { stateInfo ->
            if (stateInfo != null) {
                updateUI(stateInfo.state, stateInfo.lastError)
            }
        }

        return b.root
    }

    override fun onDestroyView() {
        controller?.setDelegate(null)
        controller = null
        binding = null
        super.onDestroyView()
    }

    private fun updateUI(state: String, lastError: String?) {
        val b = binding ?: return
        val isActive = state == "active" || state == "activating"

        b.ipProtectionSwitch.setOnCheckedChangeListener(null)
        b.ipProtectionSwitch.isChecked = isActive
        b.ipProtectionSwitch.isEnabled = state != "activating"

        b.ipProtectionSwitch.setOnCheckedChangeListener { _, isChecked ->
            if (isChecked) {
                b.ipProtectionSwitch.isEnabled = false
                b.ipProtectionState.setText(R.string.ip_protection_state_activating)
                controller?.activate()?.accept(
                    { /* delegate will update UI */ },
                    {
                        b.ipProtectionSwitch.isEnabled = true
                        b.ipProtectionSwitch.isChecked = false
                    },
                )
            } else {
                controller?.deactivate()
            }
        }

        val stateText = when (state) {
            "active" -> getString(R.string.ip_protection_state_active)
            "activating" -> getString(R.string.ip_protection_state_activating)
            "not-ready" -> getString(R.string.ip_protection_state_not_ready)
            "paused" -> getString(R.string.ip_protection_state_paused)
            "error" -> {
                if (lastError != null) {
                    "${getString(R.string.ip_protection_state_error)}: $lastError"
                } else {
                    getString(R.string.ip_protection_state_error)
                }
            }
            else -> state
        }
        b.ipProtectionState.text = stateText
    }
}
