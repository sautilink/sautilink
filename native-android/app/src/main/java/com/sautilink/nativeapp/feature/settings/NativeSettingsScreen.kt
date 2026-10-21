package com.sautilink.nativeapp.feature.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.sp
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.NativePlaybackPreferences
import androidx.compose.ui.platform.LocalContext
import com.sautilink.nativeapp.feature.auth.StagingSessionState
import com.sautilink.nativeapp.ui.components.SautiExploreSkeleton
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NativeSettingsScreen(auth: StagingAuthClient, isDark: Boolean, onToggleTheme: () -> Unit,
    focusPrivacy: Boolean = false,
    onBack: () -> Unit, onSignIn: () -> Unit, onOpenAuth: () -> Unit,
    onOpenRecovery: () -> Unit, onOpenProfile: () -> Unit,
    onOpenNotifications: () -> Unit,
    onVerificationRemoved: (String) -> Unit = {}) {
    val client = remember(auth) { NativeSettingsClient(auth) }
    val context = LocalContext.current
    var autoplay by remember { mutableStateOf(NativePlaybackPreferences.autoplayEnabled) }
    val scope = rememberCoroutineScope()
    val settingsListState = rememberLazyListState()
    val accountId = auth.account?.id
    var settings by remember(auth, accountId) { mutableStateOf<NativeAccountSettings?>(null) }
    var refresh by remember(auth, accountId) { mutableIntStateOf(0) }
    var loading by remember(auth, accountId) { mutableStateOf(accountId != null) }
    var actionBusy by remember(auth, accountId) { mutableStateOf(false) }
    var removalBusy by remember(auth, accountId) { mutableStateOf(false) }
    val busy = actionBusy || removalBusy
    var error by remember(auth, accountId) { mutableStateOf<String?>(null) }
    var note by remember(auth, accountId) { mutableStateOf<String?>(null) }
    var deleteDialog by remember(auth, accountId) { mutableStateOf(false) }
    var deleteText by remember(auth, accountId) { mutableStateOf("") }

    LaunchedEffect(auth, accountId, refresh) {
        if (accountId == null) { settings = null; loading = false; return@LaunchedEffect }
        loading = true; error = null
        try {
            val loaded = client.load()
            if (auth.account?.id == accountId && loaded.ownerId == accountId) settings = loaded
        }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) { error = e.message ?: "Could not load account settings." }
        finally { loading = false }
    }
    fun perform(success: String, action: suspend () -> Unit) {
        if (busy) return
        val owner = accountId ?: return
        actionBusy = true; error = null; note = null
        scope.launch {
            try {
                action()
                if (auth.account?.id == owner) { note = success; refresh++ }
            }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { error = e.message ?: "Could not save this setting." }
            finally { actionBusy = false }
        }
    }

    val state = settings?.takeIf { it.ownerId == accountId }
    LaunchedEffect(focusPrivacy, state != null) {
        if (focusPrivacy && state != null) settingsListState.scrollToItem(3)
    }
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") }
            Text("Settings", style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
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
            verticalArrangement = Arrangement.spacedBy(9.dp)) {
            item {
                Surface(shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surface) {
                    Row(Modifier.fillMaxWidth().clickable(onClick = onOpenProfile).padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(13.dp)) {
                        Surface(Modifier.size(52.dp), shape = CircleShape,
                            color = MaterialTheme.colorScheme.primaryContainer) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(Icons.Rounded.PersonOutline, null, Modifier.size(25.dp),
                                    tint = MaterialTheme.colorScheme.primary)
                            }
                        }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(state.displayName.ifBlank { "SautiLink member" },
                                style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                            Text("@${state.handle}", style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(auth.account?.email.orEmpty(), style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Icon(Icons.Rounded.ChevronRight, "View profile", Modifier.size(21.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            item { SectionTitle("Appearance") }
            item { SettingSwitch("Dark appearance", "Use the dark native theme", isDark, !busy) {
                onToggleTheme()
            } }
            item { SectionTitle("Privacy") }
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
            item { SectionTitle("Media playback") }
            item {
                SettingSwitch("Auto-play videos", "Play Home videos automatically, muted. Pause off-screen.",
                    autoplay, !busy) { enabled ->
                    NativePlaybackPreferences.setAutoplay(context, enabled)
                    autoplay = enabled
                }
            }
            item { SectionTitle("Notifications") }
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
            item { SettingSwitch("Rooms updates", "Updates from SautiLink",
                state.notifySautify, !busy) {
                perform("Notification preference saved") { client.setPreferenceBoolean("notify_sautify", it) }
            } }
            item {
                ChoiceSetting("Email digest", state.emailDigest,
                    listOf("off" to "Off", "daily" to "Daily", "weekly" to "Weekly"), !busy) {
                    perform("Email digest saved") { client.setEmailDigest(it) }
                }
            }
            item { SettingNavigationRow("Notifications & device alerts", Icons.Rounded.NotificationsNone,
                onOpenNotifications) }
            item { SectionTitle("Safety") }
            item { SettingLabel("Blocked accounts", Icons.Rounded.Block) }
            if (state.blocked.isEmpty()) item { Text("No blocked accounts.",
                color = MaterialTheme.colorScheme.onSurfaceVariant) }
            state.blocked.forEach { account -> item(key = "block-${account.id}") {
                SafetyAccountRow(account, "Unblock", !busy) {
                    perform("Account unblocked") { client.removeSafetyTarget(true, account.id) }
                }
            } }
            item { SettingLabel("Muted accounts", Icons.Rounded.VolumeOff) }
            if (state.muted.isEmpty()) item { Text("No muted accounts.",
                color = MaterialTheme.colorScheme.onSurfaceVariant) }
            state.muted.forEach { account -> item(key = "mute-${account.id}") {
                SafetyAccountRow(account, "Unmute", !busy) {
                    perform("Account unmuted") { client.removeSafetyTarget(false, account.id) }
                }
            } }
            item { SectionTitle("Security") }
            item { Text("Your sign-in is protected by an encrypted device session.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant) }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    SettingNavigationRow("Sign-in & phone", Icons.Rounded.Lock, onOpenAuth)
                    SettingNavigationRow("Password recovery", Icons.Rounded.LockReset, onOpenRecovery)
                }
            }
            item {
                VerificationRemovalSetting(
                    ownerId = accountId,
                    verified = state.ownerId == accountId && state.verified,
                    loading = loading || error != null,
                    enabled = !busy && !loading,
                    gateway = client.verificationRemovalGateway,
                    onBusyChange = { removalBusy = it },
                    onRemoved = { owner ->
                        if (auth.account?.id == owner && settings?.ownerId == owner) {
                            settings = settings?.copy(verified = false)
                            note = NativeVerificationRemovalPolicy.success
                            error = null
                            onVerificationRemoved(owner)
                            refresh++
                        }
                    }
                )
            }
            item { SectionTitle("Your data") }
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
            item { SectionTitle("Account deletion") }
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
    Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surface) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(account.label, modifier = Modifier.weight(1f))
            TextButton(onClick = onAction, enabled = enabled) { Text(action) }
        }
    }
}

@Composable
private fun SectionTitle(value: String) {
    val icon = when (value) {
        "Appearance" -> Icons.Rounded.Palette
        "Privacy" -> Icons.Rounded.Shield
        "Media playback" -> Icons.Rounded.PlayCircleOutline
        "Notifications" -> Icons.Rounded.NotificationsNone
        "Safety" -> Icons.Rounded.HealthAndSafety
        "Security" -> Icons.Rounded.Lock
        "Your data" -> Icons.Rounded.FolderOpen
        else -> Icons.Rounded.PersonRemove
    }
    Row(Modifier.padding(top = 16.dp, bottom = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(icon, null, Modifier.size(21.dp), tint = MaterialTheme.colorScheme.primary)
        Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    }
}

private fun settingIcon(title: String): ImageVector = when (title) {
    "Dark appearance" -> Icons.Rounded.DarkMode
    "Discoverable profile" -> Icons.Rounded.PersonSearch
    "External search indexing" -> Icons.Rounded.Public
    "Who can message you", "Messages" -> Icons.Rounded.ChatBubbleOutline
    "Read receipts" -> Icons.Rounded.DoneAll
    "Online status" -> Icons.Rounded.Circle
    "Auto-play videos" -> Icons.Rounded.PlayCircleOutline
    "Post activity" -> Icons.Rounded.FavoriteBorder
    "Followers" -> Icons.Rounded.PeopleOutline
    "Rooms updates" -> Icons.Rounded.Forum
    "Email digest" -> Icons.Rounded.AlternateEmail
    else -> Icons.Rounded.Settings
}

@Composable
private fun SettingLabel(title: String, icon: ImageVector) {
    Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(icon, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(title, style = MaterialTheme.typography.titleSmall)
    }
}

@Composable
private fun SettingNavigationRow(title: String, icon: ImageVector, onClick: () -> Unit) {
    Surface(onClick = onClick, shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surface) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(icon, null, Modifier.size(22.dp), tint = MaterialTheme.colorScheme.primary)
            Text(title, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            Icon(Icons.Rounded.ChevronRight, null, Modifier.size(19.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun SettingSwitch(title: String, description: String, checked: Boolean,
    enabled: Boolean, onChange: (Boolean) -> Unit) {
    Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surface) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(settingIcon(title), null, Modifier.size(22.dp),
                tint = MaterialTheme.colorScheme.primary, selected = checked)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                Text(description, style = MaterialTheme.typography.bodySmall.copy(lineHeight = 17.sp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Switch(checked = checked, onCheckedChange = onChange, enabled = enabled)
        }
    }
}

@Composable
private fun ChoiceSetting(title: String, selected: String, choices: List<Pair<String, String>>,
    enabled: Boolean, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surface) {
        Row(Modifier.fillMaxWidth().padding(start = 14.dp, end = 6.dp, top = 9.dp, bottom = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(settingIcon(title), null, Modifier.size(22.dp), tint = MaterialTheme.colorScheme.primary)
            Text(title, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            Box {
                TextButton(onClick = { expanded = true }, enabled = enabled) {
                    Text(choices.firstOrNull { it.first == selected }?.second.orEmpty(),
                        style = MaterialTheme.typography.labelLarge)
                    Spacer(Modifier.width(4.dp))
                    Icon(Icons.Rounded.KeyboardArrowDown, null, Modifier.size(18.dp))
                }
                DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                    choices.forEach { (value, label) ->
                        DropdownMenuItem(text = { Text(label) }, enabled = enabled,
                            leadingIcon = {
                                Icon(if (selected == value) Icons.Rounded.CheckCircle else Icons.Rounded.RadioButtonUnchecked,
                                    null, Modifier.size(20.dp), selected = selected == value)
                            }, onClick = { onSelect(value); expanded = false })
                    }
                }
            }
        }
    }
}
