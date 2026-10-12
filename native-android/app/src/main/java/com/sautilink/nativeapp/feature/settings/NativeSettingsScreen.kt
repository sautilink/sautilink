package com.sautilink.nativeapp.feature.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.auth.StagingSessionState
import com.sautilink.nativeapp.ui.components.SautiExploreSkeleton
import com.sautilink.nativeapp.ui.theme.SautiShape
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NativeSettingsScreen(auth: StagingAuthClient, isDark: Boolean, onToggleTheme: () -> Unit,
    focusPrivacy: Boolean = false,
    onBack: () -> Unit, onSignIn: () -> Unit, onOpenAuth: () -> Unit,
    onOpenRecovery: () -> Unit, onOpenProfile: () -> Unit,
    onOpenNotifications: () -> Unit) {
    val client = remember(auth) { NativeSettingsClient(auth) }
    val scope = rememberCoroutineScope()
    val settingsListState = rememberLazyListState()
    var settings by remember { mutableStateOf<NativeAccountSettings?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var note by remember { mutableStateOf<String?>(null) }
    var deleteDialog by remember { mutableStateOf(false) }
    var deleteText by remember { mutableStateOf("") }

    LaunchedEffect(auth.account?.id, refresh) {
        if (auth.account == null) { settings = null; return@LaunchedEffect }
        loading = true; error = null
        try { settings = client.load() }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) { error = e.message ?: "Could not load account settings." }
        finally { loading = false }
    }
    fun perform(success: String, action: suspend () -> Unit) {
        if (busy) return
        busy = true; error = null; note = null
        scope.launch {
            try { action(); note = success; refresh++ }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { error = e.message ?: "Could not save this setting." }
            finally { busy = false }
        }
    }

    val state = settings
    LaunchedEffect(focusPrivacy, state != null) {
        if (focusPrivacy && state != null) settingsListState.scrollToItem(3)
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") }
            Text("Settings", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
            IconButton(onClick = { refresh++ }, enabled = !loading && !busy) {
                Icon(Icons.Rounded.Refresh, "Refresh settings")
            }
        }
        if (loading && state == null) repeat(4) { SautiExploreSkeleton() }
        else if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (error != null) Text(error.orEmpty(), Modifier.padding(horizontal = 18.dp, vertical = 8.dp),
            color = MaterialTheme.colorScheme.error)
        if (note != null) Text(note.orEmpty(), Modifier.padding(horizontal = 18.dp, vertical = 8.dp),
            color = MaterialTheme.colorScheme.primary)
        if (auth.account == null) {
            Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(if (auth.sessionState == StagingSessionState.CHECKING) "Restoring session…"
                    else "Sign in to manage your account.")
                Spacer(Modifier.height(12.dp))
                if (auth.sessionState != StagingSessionState.CHECKING)
                    Button(onClick = onSignIn) { Text("Sign in") }
            }
        } else if (state != null) LazyColumn(
            state = settingsListState,
            contentPadding = PaddingValues(start = 18.dp, end = 18.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.surfaceContainer) {
                    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(state.displayName.ifBlank { "SautiLink member" },
                            style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                        Text("@${state.handle}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(auth.account?.email.orEmpty(), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        TextButton(onClick = onOpenProfile) { Text("View profile") }
                    }
                }
            }
            item { SectionTitle("APPEARANCE") }
            item { SettingSwitch("Dark appearance", "Use the dark native theme", isDark, !busy) {
                onToggleTheme()
            } }
            item { SectionTitle("PRIVACY") }
            item { SettingSwitch("Discoverable profile", "Let members find your profile",
                state.discoverable, !busy) {
                perform("Privacy saved") { client.setProfileBoolean("is_discoverable", it) }
            } }
            item { SettingSwitch("External search indexing", "Allow search engines to index your public profile",
                state.externalIndexing, !busy && state.discoverable) {
                perform("Privacy saved") { client.setProfileBoolean("allow_external_indexing", it) }
            } }
            item {
                ChoiceSetting("Who can message you", state.dmAccess,
                    listOf("following" to "Following", "everyone" to "Everyone", "none" to "Nobody"), !busy) {
                    perform("Message privacy saved") { client.setDmAccess(it) }
                }
            }
            item { SettingSwitch("Read receipts", "Let people know when you read messages",
                state.readReceipts, !busy) {
                perform("Read receipts saved") { client.setPreferenceBoolean("read_receipts", it) }
            } }
            item { SettingSwitch("Online status", "Show your activity in conversations",
                state.activityStatus, !busy) {
                perform("Online status saved") { client.setPreferenceBoolean("activity_status", it) }
            } }
            item { SectionTitle("NOTIFICATIONS") }
            item { SettingSwitch("Post activity", "Likes, comments and reposts",
                state.notifyPosts, !busy) {
                perform("Notification preference saved") { client.setPreferenceBoolean("notify_post_activity", it) }
            } }
            item { SettingSwitch("Messages", "Alerts for direct messages",
                state.notifyMessages, !busy) {
                perform("Notification preference saved") { client.setPreferenceBoolean("notify_messages", it) }
            } }
            item { SettingSwitch("Followers", "Alerts for new followers",
                state.notifyFollowers, !busy) {
                perform("Notification preference saved") { client.setPreferenceBoolean("notify_followers", it) }
            } }
            item { SettingSwitch("Sautify updates", "Updates from SautiLink",
                state.notifySautify, !busy) {
                perform("Notification preference saved") { client.setPreferenceBoolean("notify_sautify", it) }
            } }
            item {
                ChoiceSetting("Email digest", state.emailDigest,
                    listOf("off" to "Off", "daily" to "Daily", "weekly" to "Weekly"), !busy) {
                    perform("Email digest saved") { client.setEmailDigest(it) }
                }
            }
            item { TextButton(onClick = onOpenNotifications) { Text("View notifications and device alerts") } }
            item { SectionTitle("SAFETY") }
            item { Text("Blocked accounts", style = MaterialTheme.typography.titleMedium) }
            if (state.blocked.isEmpty()) item { Text("No blocked accounts.",
                color = MaterialTheme.colorScheme.onSurfaceVariant) }
            state.blocked.forEach { account -> item(key = "block-${account.id}") {
                SafetyAccountRow(account, "Unblock", !busy) {
                    perform("Account unblocked") { client.removeSafetyTarget(true, account.id) }
                }
            } }
            item { Text("Muted accounts", style = MaterialTheme.typography.titleMedium) }
            if (state.muted.isEmpty()) item { Text("No muted accounts.",
                color = MaterialTheme.colorScheme.onSurfaceVariant) }
            state.muted.forEach { account -> item(key = "mute-${account.id}") {
                SafetyAccountRow(account, "Unmute", !busy) {
                    perform("Account unmuted") { client.removeSafetyTarget(false, account.id) }
                }
            } }
            item { SectionTitle("SECURITY") }
            item { Text("Your sign-in is protected by an encrypted device session.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant) }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = onOpenAuth) { Text("Sign-in & phone") }
                    OutlinedButton(onClick = onOpenRecovery) { Text("Password recovery") }
                }
            }
            item { SectionTitle("YOUR DATA") }
            item { Text("Data export: ${state.exportStatus.ifBlank { "No active request" }}") }
            item {
                if (state.exportStatus in setOf("pending", "processing", "ready"))
                    OutlinedButton(onClick = { perform("Export request cancelled") { client.cancelExport() } }, enabled = !busy) {
                        Text("Cancel export request")
                    }
                else Button(onClick = { perform("Data export requested") { client.requestExport() } }, enabled = !busy) {
                    Text("Request data export")
                }
            }
            item { SectionTitle("ACCOUNT DELETION") }
            item {
                Text(if (state.deletionStatus == "pending")
                    "Deletion requested. You can cancel before ${state.deletionDeadline.take(10)}."
                    else "Requesting deletion hides your profile and begins a 14-day recovery window.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            item {
                if (state.deletionStatus == "pending")
                    OutlinedButton(onClick = { perform("Deletion request cancelled") { client.cancelDeletion() } }, enabled = !busy) {
                        Text("Cancel deletion request")
                    }
                else OutlinedButton(onClick = { deleteText = ""; deleteDialog = true }, enabled = !busy) {
                    Text("Request account deletion")
                }
            }
        }
    }

    if (deleteDialog) AlertDialog(onDismissRequest = { deleteDialog = false },
        title = { Text("Request account deletion") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Your profile will be hidden immediately. You can cancel within 14 days. Type DELETE to confirm.")
                OutlinedTextField(deleteText, { deleteText = it.take(16) },
                    label = { Text("Type DELETE") }, singleLine = true)
            }
        }, confirmButton = {
            TextButton(onClick = {
                deleteDialog = false
                perform("Deletion requested; recovery window is active") {
                    client.requestDeletion(deleteText)
                }
            }, enabled = deleteText.trim().uppercase() == "DELETE" && !busy) { Text("Request deletion") }
        }, dismissButton = { TextButton(onClick = { deleteDialog = false }) { Text("Cancel") } })
}

@Composable
private fun SafetyAccountRow(account: SafetyAccount, action: String, enabled: Boolean,
    onAction: () -> Unit) {
    Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.surfaceContainer) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(account.label, modifier = Modifier.weight(1f))
            TextButton(onClick = onAction, enabled = enabled) { Text(action) }
        }
    }
}

@Composable
private fun SectionTitle(value: String) {
    Text(value, modifier = Modifier.padding(top = 10.dp),
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun SettingSwitch(title: String, description: String, checked: Boolean,
    enabled: Boolean, onChange: (Boolean) -> Unit) {
    Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.surfaceContainer) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(title, fontWeight = FontWeight.SemiBold)
                Text(description, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Switch(checked = checked, onCheckedChange = onChange, enabled = enabled)
        }
    }
}

@Composable
private fun ChoiceSetting(title: String, selected: String, choices: List<Pair<String, String>>,
    enabled: Boolean, onSelect: (String) -> Unit) {
    Surface(shape = SautiShape.Card, color = MaterialTheme.colorScheme.surfaceContainer) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, fontWeight = FontWeight.SemiBold)
            Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                choices.forEach { (value, label) ->
                    FilterChip(selected = selected == value, onClick = { onSelect(value) },
                        enabled = enabled, label = { Text(label) })
                }
            }
        }
    }
}
