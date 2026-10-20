package com.sautilink.nativeapp.feature.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.ManageAccounts
import androidx.compose.material.icons.rounded.VerifiedUser
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.util.UUID

/** The production setting and confirmation, independently renderable with an offline fake gateway. */
@Composable
internal fun VerificationRemovalSetting(
    ownerId: String?,
    verified: Boolean,
    loading: Boolean,
    enabled: Boolean,
    gateway: NativeVerificationRemovalGateway,
    onRemoved: (String) -> Unit,
    onBusyChange: (Boolean) -> Unit = {}
) {
    val currentOwner = rememberUpdatedState(ownerId)
    val currentVerified = rememberUpdatedState(verified)
    val currentLoading = rememberUpdatedState(loading)
    val currentGateway = rememberUpdatedState(gateway)
    val currentRemoved = rememberUpdatedState(onRemoved)
    val currentBusyChange = rememberUpdatedState(onBusyChange)
    val eligible = NativeVerificationRemovalPolicy.eligible(ownerId, ownerId, verified, loading)
    if (!eligible) return

    val scope = rememberCoroutineScope()
    var open by remember(ownerId) { mutableStateOf(false) }
    var removing by remember(ownerId) { mutableStateOf(false) }
    var requestId by remember(ownerId) { mutableStateOf<String?>(null) }
    var error by remember(ownerId) { mutableStateOf<String?>(null) }
    val operation = remember(ownerId) { arrayOfNulls<Job>(1) }
    val visible = remember(ownerId) { booleanArrayOf(true) }
    DisposableEffect(ownerId) {
        visible[0] = true
        onDispose {
            visible[0] = false
            operation[0]?.cancel()
            if (removing) currentBusyChange.value(false)
        }
    }

    fun close() {
        if (removing) return
        open = false
        requestId = null
        error = null
    }

    Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
        Row(Modifier.padding(top = 16.dp, bottom = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Rounded.ManageAccounts, null, Modifier.size(21.dp),
                tint = MaterialTheme.colorScheme.primary)
            Text("Account", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }
        Surface(onClick = {
            if (enabled && !removing) {
                error = null
                requestId = UUID.randomUUID().toString()
                open = true
            }
        }, enabled = enabled && !removing, shape = RoundedCornerShape(20.dp),
            modifier = Modifier.testTag("verification-removal-setting"),
            color = MaterialTheme.colorScheme.surface) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(Icons.Rounded.VerifiedUser, null, Modifier.size(22.dp),
                    tint = MaterialTheme.colorScheme.error)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(NativeVerificationRemovalPolicy.confirmLabel, style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium)
                    Text("Remove your checkmark. Normal username change limits still apply (once every 30 days).",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Icon(Icons.Rounded.ChevronRight, null, Modifier.size(19.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }

    if (open) AlertDialog(
        modifier = Modifier.widthIn(max = (LocalConfiguration.current.screenWidthDp - 40)
            .coerceIn(240, 520).dp).fillMaxWidth().testTag("verification-removal-dialog"),
        onDismissRequest = ::close,
        shape = RoundedCornerShape(28.dp),
        icon = {
            Surface(shape = RoundedCornerShape(17.dp), color = MaterialTheme.colorScheme.errorContainer) {
                Icon(Icons.Rounded.VerifiedUser, null, Modifier.padding(13.dp).size(28.dp),
                    tint = MaterialTheme.colorScheme.error)
            }
        },
        title = { Text(NativeVerificationRemovalPolicy.title) },
        text = {
            Column(Modifier.testTag("verification-removal-dialog-content").verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(NativeVerificationRemovalPolicy.warning, style = MaterialTheme.typography.bodyMedium)
                if (removing) {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                    Text("Removing verification…", style = MaterialTheme.typography.bodySmall)
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            Button(onClick = {
                val expectedOwner = ownerId ?: return@Button
                if (removing || !enabled || !visible[0] || currentOwner.value != expectedOwner ||
                    !currentVerified.value || currentLoading.value) return@Button
                val actionId = requestId ?: return@Button
                removing = true
                error = null
                currentBusyChange.value(true)
                operation[0] = scope.launch {
                    try {
                        val result = currentGateway.value.removeVerification(expectedOwner, actionId)
                        if (!visible[0] || currentOwner.value != expectedOwner ||
                            !currentVerified.value || currentLoading.value) return@launch
                        if (result.ownerId != expectedOwner || result.status !in setOf("removed", "already_removed"))
                            throw IllegalStateException(NativeVerificationRemovalPolicy.unconfirmed)
                        // Only a confirmed response may dismiss the dialog and remove the local checkmark.
                        open = false
                        requestId = null
                        currentRemoved.value(expectedOwner)
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (failure: Exception) {
                        if (visible[0] && currentOwner.value == expectedOwner) {
                            error = failure.message ?: "Verification could not be removed. Please try again."
                        }
                    } finally {
                        operation[0] = null
                        removing = false
                        if (visible[0] && currentOwner.value == expectedOwner) currentBusyChange.value(false)
                    }
                }
            }, enabled = enabled && !removing,
                modifier = Modifier.heightIn(min = 48.dp).testTag("verification-removal-confirm"),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error,
                    contentColor = MaterialTheme.colorScheme.onError)) {
                Text(NativeVerificationRemovalPolicy.confirmLabel)
            }
        },
        dismissButton = {
            val keepFocus = remember { FocusRequester() }
            LaunchedEffect(removing) {
                if (!removing) keepFocus.requestFocus()
            }
            OutlinedButton(onClick = ::close, enabled = !removing,
                modifier = Modifier.heightIn(min = 48.dp).focusRequester(keepFocus)
                    .testTag("verification-removal-keep")) {
                Text(NativeVerificationRemovalPolicy.cancelLabel)
            }
        },
        properties = DialogProperties(dismissOnBackPress = !removing, dismissOnClickOutside = !removing,
            usePlatformDefaultWidth = false)
    )
}
