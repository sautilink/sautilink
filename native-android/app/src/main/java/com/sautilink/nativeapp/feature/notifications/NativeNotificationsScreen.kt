package com.sautilink.nativeapp.feature.notifications

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.auth.StagingSessionState
import com.sautilink.nativeapp.ui.components.SautiVerificationBadge
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@Composable
fun NativeNotificationsScreen(auth: StagingAuthClient, onBack: () -> Unit, onSignIn: () -> Unit,
    onOpenProfile: (String) -> Unit, onOpenRoom: (String) -> Unit,
    onOpenPost: (String) -> Unit, onOpenInbox: () -> Unit) {
    val client = remember(auth) { NativeNotificationsClient(auth) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var pushReady by remember { mutableStateOf(false) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) scope.launch { pushReady = NativePushManager.sync(context, auth) }
    }
    var items by remember { mutableStateOf<List<NativeNotification>>(emptyList()) }
    var unreadOnly by rememberSaveable { mutableStateOf(false) }
    var refresh by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(auth.account?.id, refresh) {
        if (auth.account == null) { items = emptyList(); return@LaunchedEffect }
        loading = true; error = null
        try { items = client.load() }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) { error = e.message ?: "Could not load notifications." }
        finally { loading = false }
    }
    LaunchedEffect(auth.account?.id) {
        pushReady = auth.account != null && NativePushManager.sync(context, auth)
    }
    val unread = items.count { !it.isRead }
    val shown = if (unreadOnly) items.filterNot { it.isRead } else items
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 12.dp, top = 8.dp),
            verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") }
            Text("Notifications", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
            IconButton(onClick = { refresh++ }, enabled = !loading && !busy) {
                Icon(Icons.Rounded.Refresh, "Refresh notifications")
            }
        }
        Row(Modifier.padding(horizontal = 18.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            FilterChip(selected = !unreadOnly, onClick = { unreadOnly = false }, label = { Text("All") })
            FilterChip(selected = unreadOnly, onClick = { unreadOnly = true },
                label = { Text("Unread" + if (unread > 0) " ($unread)" else "") })
            Spacer(Modifier.weight(1f))
            if (unread > 0) TextButton(onClick = {
                busy = true; error = null
                scope.launch {
                    try { client.markAllRead(); items = items.map { it.copy(isRead = true) } }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (e: Exception) { error = e.message ?: "Could not mark notifications as read." }
                    finally { busy = false }
                }
            }, enabled = !busy) { Text("Mark all read") }
        }
        if (loading || busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (auth.account != null && NativePushManager.configured(context)) {
            when {
                !NativePushManager.permissionGranted(context) && Build.VERSION.SDK_INT >= 33 ->
                    TextButton(onClick = { permission.launch(Manifest.permission.POST_NOTIFICATIONS) },
                        modifier = Modifier.padding(horizontal = 12.dp)) { Text("Enable device alerts") }
                pushReady -> Text("Device alerts on", Modifier.padding(horizontal = 18.dp, vertical = 4.dp),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                else -> TextButton(onClick = {
                    scope.launch { pushReady = NativePushManager.sync(context, auth) }
                }, modifier = Modifier.padding(horizontal = 12.dp)) { Text("Retry device alerts") }
            }
        }
        if (error != null) Text(error.orEmpty(), Modifier.padding(18.dp), color = MaterialTheme.colorScheme.error)
        if (auth.account == null) {
            Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(if (auth.sessionState == StagingSessionState.CHECKING) "Restoring session…"
                    else "Sign in to see notifications.")
                Spacer(Modifier.height(12.dp))
                if (auth.sessionState != StagingSessionState.CHECKING)
                    Button(onClick = onSignIn) { Text("Sign in") }
            }
        } else LazyColumn(contentPadding = PaddingValues(bottom = 20.dp)) {
            if (!loading && shown.isEmpty()) item {
                Text(if (unreadOnly) "No unread notifications." else "No notifications yet.",
                    Modifier.padding(22.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            items(shown, key = { it.id }) { item ->
                Column(Modifier.fillMaxWidth().clickable(enabled = !busy) {
                    busy = true; error = null
                    scope.launch {
                        try {
                            if (!item.isRead) client.markRead(item.id)
                            items = items.map { if (it.id == item.id) it.copy(isRead = true) else it }
                            when {
                                item.type == "circle" && item.circleSlug.isNotBlank() -> onOpenRoom(item.circleSlug)
                                item.postId.isNotBlank() -> onOpenPost(item.postId)
                                item.circleSlug.isNotBlank() -> onOpenRoom(item.circleSlug)
                                item.type == "message" -> onOpenInbox()
                                item.actorHandle.isNotBlank() -> onOpenProfile(item.actorHandle)
                            }
                        } catch (cancelled: CancellationException) { throw cancelled }
                        catch (e: Exception) { error = e.message ?: "Could not open notification." }
                        finally { busy = false }
                    }
                }.padding(horizontal = 18.dp, vertical = 15.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(notificationCopy(item), fontWeight = if (item.isRead) FontWeight.Normal else FontWeight.SemiBold)
                        SautiVerificationBadge(item.actorVerified, item.actorBadgeType,
                            item.actorName, size = 15.dp)
                    }
                    Text(item.createdAt.take(16).replace('T', ' '),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                HorizontalDivider()
            }
        }
    }
}

private fun notificationCopy(item: NativeNotification): String {
    val actor = if (item.actorHandle.isNotBlank()) "@${item.actorHandle}" else item.actorName
    val room = item.circleName.ifBlank { "your Room" }
    return when (item.type) {
        "follow" -> "$actor followed you."
        "like" -> "$actor liked your post."
        "reply" -> "$actor commented on your post."
        "mention" -> "$actor mentioned you."
        "reshare" -> "$actor reposted your post."
        "circle" -> when (item.circleEvent) {
            "join_request" -> "$actor requested to join $room."
            "request_approved" -> "$actor approved your request to join $room."
            "request_declined" -> "$actor declined your request to join $room."
            "member_removed" -> "$actor removed you from $room."
            else -> "SautiLink sent you a Room update."
        }
        "message" -> "$actor sent you a message."
        "safety" -> "SautiLink updated a moderation decision."
        else -> "SautiLink sent you an update."
    }
}
