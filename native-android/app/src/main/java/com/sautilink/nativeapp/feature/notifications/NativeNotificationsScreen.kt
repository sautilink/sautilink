package com.sautilink.nativeapp.feature.notifications

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.auth.StagingSessionState
import com.sautilink.nativeapp.feature.home.AuthorizedImage
import com.sautilink.nativeapp.feature.home.relativePostTime
import com.sautilink.nativeapp.ui.components.SautiAvatar
import com.sautilink.nativeapp.ui.components.SautiNotificationSkeleton
import com.sautilink.nativeapp.ui.components.SautiVerificationBadge
import com.sautilink.nativeapp.ui.theme.SautiColors
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@Composable
fun NativeNotificationsScreen(
    auth: StagingAuthClient, onBack: () -> Unit, onSignIn: () -> Unit,
    onOpenProfile: (String) -> Unit, onOpenRoom: (String) -> Unit,
    onOpenPost: (String) -> Unit, onOpenInbox: () -> Unit,
    onUnreadChanged: (Int) -> Unit = {}
) {
    val client = remember(auth) { NativeNotificationsClient(auth) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        if (it) scope.launch { NativePushManager.sync(context, auth) }
    }
    var items by remember(auth.account?.id) { mutableStateOf<List<NativeNotification>>(emptyList()) }
    var unreadOnly by rememberSaveable { mutableStateOf(false) }
    var refresh by remember { mutableIntStateOf(0) }
    var loading by remember(auth.account?.id) { mutableStateOf(auth.account != null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(auth.account?.id, refresh) {
        if (auth.account == null) { items = emptyList(); return@LaunchedEffect }
        loading = true; error = null
        try { items = client.load(); onUnreadChanged(items.count { !it.isRead }) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) { error = e.message ?: "Could not load notifications." }
        finally { loading = false }
    }
    val unread = items.count { !it.isRead }
    val shown = if (unreadOnly) items.filterNot { it.isRead } else items
    val bodyTextColor = MaterialTheme.colorScheme.onSurface
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)) {
        Row(
            Modifier.fillMaxWidth().padding(start = 7.dp, end = 11.dp, top = 9.dp, bottom = 7.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack, modifier = Modifier.size(48.dp)) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back")
            }
            Text("Notifications", style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            TextButton(onClick = {
                busy = true; error = null
                scope.launch {
                    try {
                        client.markAllRead()
                        items = items.map { it.copy(isRead = true) }
                        onUnreadChanged(0)
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (e: Exception) { error = e.message ?: "Could not mark notifications as read." }
                    finally { busy = false }
                }
            }, enabled = unread > 0 && !busy,
                colors = ButtonDefaults.textButtonColors(
                    contentColor = SautiColors.Red
                )) { Text("Mark all read", style = MaterialTheme.typography.labelMedium) }
        }
        Row(
            Modifier.fillMaxWidth().padding(start = 18.dp, end = 12.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            FilterChip(selected = !unreadOnly, onClick = { unreadOnly = false },
                label = { Text("All") })
            FilterChip(selected = unreadOnly, onClick = { unreadOnly = true },
                label = { Text(if (unread > 0) "Unread ($unread)" else "Unread") })
            Spacer(Modifier.weight(1f))
            IconButton(onClick = { refresh++ }, enabled = !loading && !busy,
                modifier = Modifier.size(48.dp)) {
                Icon(Icons.Rounded.Refresh, "Refresh notifications", Modifier.size(22.dp))
            }
        }
        if (auth.account != null && NativePushManager.configured(context) &&
            Build.VERSION.SDK_INT >= 33 && !NativePushManager.permissionGranted(context)) {
            TextButton(
                onClick = { permission.launch(Manifest.permission.POST_NOTIFICATIONS) },
                modifier = Modifier.padding(horizontal = 12.dp)
            ) { Text("Enable device alerts") }
        }
        if (error != null) {
            Text(error.orEmpty(), Modifier.padding(18.dp), color = MaterialTheme.colorScheme.error)
            TextButton(onClick = { refresh++ }) { Text("Try again") }
        }
        if (auth.account == null) {
            Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(if (auth.sessionState == StagingSessionState.CHECKING) "Restoring session…"
                    else "Sign in to see notifications.")
                if (auth.sessionState != StagingSessionState.CHECKING) {
                    Spacer(Modifier.height(12.dp))
                    Button(onClick = onSignIn) { Text("Sign in") }
                }
            }
        } else LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
            if (loading && items.isEmpty()) {
                items(6) { SautiNotificationSkeleton(); HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant) }
            }
            if (!loading && error == null && shown.isEmpty()) {
                item {
                    Text(if (unreadOnly) "No unread notifications." else "No notifications yet.",
                        Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            items(shown, key = { it.id }) { item ->
                val actor = if (item.actorHandle.isNotBlank()) "@${item.actorHandle}" else item.actorName
                val allowedHandle = Regex("^[a-z0-9][a-z0-9._]{2,29}$").matches(item.actorHandle)
                val initials = item.actorName.split(" ").filter { it.isNotBlank() }
                    .take(2).map { it.first().uppercaseChar() }.joinToString("").ifBlank { "SL" }
                val highlight = if (!item.isRead) SautiColors.Red.copy(alpha = .065f)
                    else MaterialTheme.colorScheme.surface
                Row(
                    Modifier.fillMaxWidth().background(highlight)
                        .clickable(enabled = !busy) {
                            busy = true; error = null
                            scope.launch {
                                try {
                                    if (!item.isRead) client.markRead(item.id)
                                    items = items.map { if (it.id == item.id) it.copy(isRead = true) else it }
                                    onUnreadChanged(items.count { !it.isRead })
                                    when {
                                        item.type == "circle" && item.circleSlug.isNotBlank() ->
                                            onOpenRoom(item.circleSlug)
                                        item.postId.isNotBlank() -> onOpenPost(item.postId)
                                        item.circleSlug.isNotBlank() -> onOpenRoom(item.circleSlug)
                                        item.type == "message" -> onOpenInbox()
                                        allowedHandle -> onOpenProfile(item.actorHandle)
                                    }
                                } catch (cancelled: CancellationException) { throw cancelled }
                                catch (e: Exception) {
                                    error = e.message ?: "Could not open notification."
                                } finally { busy = false }
                            }
                        }.padding(horizontal = 18.dp, vertical = 18.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(13.dp)
                ) {
                    if (item.actorHasAvatar && allowedHandle) {
                        AuthorizedImage(auth,
                            route = "/api/profile-media/${item.actorHandle}/avatar",
                            description = "${item.actorName} profile picture",
                            modifier = Modifier.size(58.dp).clip(CircleShape),
                            fallback = { SautiAvatar(initials, Modifier.size(58.dp), SautiColors.Blue) })
                    } else SautiAvatar(initials, Modifier.size(58.dp), SautiColors.Blue)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(actor, style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = bodyTextColor, maxLines = 1)
                            SautiVerificationBadge(item.actorVerified, item.actorBadgeType,
                                item.actorName, size = 16.dp)
                            Text(notificationActionCopy(item),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.weight(1f, fill = false))
                        }
                        Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (!item.isRead) {
                                Box(Modifier.size(9.dp).clip(CircleShape)
                                    .background(SautiColors.Red))
                            }
                            Text(relativePostTime(item.createdAt),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .65f))
            }
        }
    }
}

private fun notificationActionCopy(item: NativeNotification): String {
    val room = item.circleName.ifBlank { "your Room" }
    return when (item.type) {
        "follow" -> "followed you."
        "like" -> "liked your post."
        "reply" -> "commented on your post."
        "mention" -> "mentioned you."
        "reshare" -> "reposted your post."
        "circle" -> when (item.circleEvent) {
            "join_request" -> "requested to join $room."
            "request_approved" -> "approved your request to join $room."
            "request_declined" -> "declined your request to join $room."
            "member_removed" -> "removed you from $room."
            else -> "sent you a Room update."
        }
        "message" -> "sent you a message."
        "safety" -> "updated a moderation decision."
        else -> "sent you an update."
    }
}
