package com.sautilink.nativeapp

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.UpdateAvailability
import com.sautilink.nativeapp.ui.theme.SautiShape

/** Require an update only after Play reports a newer compatible bundle for this install. */
internal class NativePlayUpdate(private val activity: ComponentActivity) {
    private val manager = if (activity.packageName == "com.sautilink.app") {
        runCatching { AppUpdateManagerFactory.create(activity) }.getOrNull()
    } else null
    private val options = AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build()
    private var checking = false
    private var playFlowOpen = false
    private var attemptedVersion: Int? = null
    private var required by mutableStateOf(false)
    private var message by mutableStateOf(DEFAULT_MESSAGE)

    private val launcher = activity.registerForActivityResult(
        ActivityResultContracts.StartIntentSenderForResult()
    ) { result ->
        playFlowOpen = false
        when (result.resultCode) {
            Activity.RESULT_CANCELED -> activity.finishAndRemoveTask()
            Activity.RESULT_OK -> check()
            else -> message = "Google Play could not complete the update. Try again or open Play Store."
        }
    }

    fun check(retry: Boolean = false) {
        val updates = manager ?: return
        if (checking || playFlowOpen || activity.isFinishing) return
        checking = true
        updates.appUpdateInfo.addOnCompleteListener { task ->
            checking = false
            if (activity.isFinishing || activity.isDestroyed ||
                !activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) return@addOnCompleteListener
            if (!task.isSuccessful) {
                if (retry) openPlayStore()
                return@addOnCompleteListener
            }
            val info = task.result ?: return@addOnCompleteListener
            val availability = info.updateAvailability()
            val resuming = availability == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
            val version = info.availableVersionCode()
            required = resuming || (availability == UpdateAvailability.UPDATE_AVAILABLE &&
                version > BuildConfig.VERSION_CODE)
            if (!required) return@addOnCompleteListener
            if (!resuming && !retry && attemptedVersion == version) return@addOnCompleteListener
            attemptedVersion = version
            if (info.isUpdateTypeAllowed(options)) {
                playFlowOpen = runCatching {
                    updates.startUpdateFlowForResult(info, launcher, options)
                }.getOrDefault(false)
            }
            if (!playFlowOpen && retry) openPlayStore()
        }
    }

    private fun openPlayStore() {
        val packageName = activity.packageName
        val store = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$packageName"))
            .setPackage("com.android.vending")
        if (runCatching { activity.startActivity(store) }.isFailure) {
            val listing = Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$packageName"))
            if (runCatching { activity.startActivity(listing) }.isFailure) {
                message = "Open Google Play to update SautiLink."
            }
        }
    }

    @Composable
    fun UpdateDialog() {
        if (!required) return
        AlertDialog(
            onDismissRequest = {},
            title = { Text("Update SautiLink") },
            text = { Text(message) },
            confirmButton = { TextButton(onClick = { check(retry = true) }) { Text("Update") } },
            dismissButton = { TextButton(onClick = { activity.finishAndRemoveTask() }) { Text("Close app") } },
            properties = DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false),
            shape = SautiShape.Card
        )
    }

    private companion object {
        const val DEFAULT_MESSAGE = "A newer version is available. Update in Google Play to keep using SautiLink."
    }
}
