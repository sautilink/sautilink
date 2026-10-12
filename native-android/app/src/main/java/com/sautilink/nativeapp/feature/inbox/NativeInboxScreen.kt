package com.sautilink.nativeapp.feature.inbox

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.material.icons.rounded.Phone
import androidx.compose.material.icons.rounded.Videocam
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.animation.core.*
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import com.sautilink.nativeapp.feature.home.AuthorizedImage
import com.sautilink.nativeapp.ui.components.SautiAvatar
import com.sautilink.nativeapp.ui.theme.SautiColors
import androidx.compose.material.icons.rounded.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.auth.StagingSessionState
import com.sautilink.nativeapp.feature.safety.NativeReportDialog
import com.sautilink.nativeapp.feature.safety.NativeSafetyClient
import com.sautilink.nativeapp.ui.theme.SautiShape
import com.sautilink.nativeapp.ui.components.SautiExploreSkeleton
import com.sautilink.nativeapp.ui.components.SautiVerificationBadge
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.awaitCancellation

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun NativeInboxScreen(auth: StagingAuthClient, onSignIn: () -> Unit, onOpenProfile: (String) -> Unit,
    initialConversationId: String? = null, onDeepLinkConsumed: () -> Unit = {},
    initialPeerId: String? = null, onPeerConsumed: () -> Unit = {},
    onOpenPrivacy: () -> Unit = {},
    onActivityVisibilityChanged: () -> Unit = {}) {
    val client = remember(auth) { NativeMessagesClient(auth) }
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    var selectedMessage by remember { mutableStateOf<NativeMessage?>(null) }
    var deleteConfirm by remember { mutableStateOf(false) }
    var deleteEverywhere by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf(false) }
    var editedText by remember { mutableStateOf("") }
    var forwarding by remember { mutableStateOf(false) }
    var clearConfirm by remember { mutableStateOf(false) }
    var clearEveryone by remember { mutableStateOf(false) }
    var chatMenu by remember { mutableStateOf(false) }
    var searchingThread by remember { mutableStateOf(false) }
    var threadQuery by remember { mutableStateOf("") }
    var replyTo by remember { mutableStateOf<NativeMessage?>(null) }
    var statusBucket by remember { mutableStateOf("hidden") }
    var visibilityRevision by remember { mutableIntStateOf(0) }
    var mediaByMessage by remember { mutableStateOf<Map<String, DmMedia>>(emptyMap()) }
    val mediaClient = remember(auth) { NativeDmMediaClient(auth) }
    val appearance = remember(context, auth.account?.id) {
        MessageAppearancePrefs(context, auth.account?.id)
    }
    var chatSettings by remember { mutableStateOf(false) }
    var wallpaper by remember { mutableStateOf(appearance.wallpaper) }
    var bubble by remember { mutableStateOf(appearance.bubble) }
    var compact by remember { mutableStateOf(appearance.compact) }
    var autoPhotos by remember { mutableStateOf(appearance.autoPhotos && !appearance.dataSaver) }
    val safety = remember(auth) { NativeSafetyClient(auth) }
    var conversations by remember { mutableStateOf<List<NativeConversation>>(emptyList()) }
    var selectedId by rememberSaveable { mutableStateOf<String?>(null) }
    var peerReceipts by remember(selectedId) {
        mutableStateOf(NativePeerReceipts(null, null))
    }
    var receiptIssue by remember(selectedId) { mutableStateOf(false) }
    LaunchedEffect(selectedId, appearance) {
        wallpaper = appearance.wallpaperFor(selectedId)
        bubble = appearance.bubbleFor(selectedId)
        autoPhotos = appearance.autoPhotos && !appearance.dataSaver
    }
    var thread by remember { mutableStateOf<NativeThread?>(null) }
    var query by rememberSaveable { mutableStateOf("") }
    var unreadOnly by rememberSaveable { mutableStateOf(false) }
    var newConversation by rememberSaveable { mutableStateOf(false) }
    var newQuery by rememberSaveable { mutableStateOf("") }
    var accounts by remember { mutableStateOf<List<NativeMessageAccount>>(emptyList()) }
    var newLoading by remember { mutableStateOf(false) }
    var refresh by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var draft by rememberSaveable { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var reportMessageId by remember { mutableStateOf<String?>(null) }
    var reportBusy by remember { mutableStateOf(false) }
    var reportNote by remember { mutableStateOf<String?>(null) }
    var peerOnline by remember { mutableStateOf(false) }
    var peerTyping by remember { mutableStateOf(false) }
    var realtime by remember { mutableStateOf<NativeDmRealtime?>(null) }
    var durableRealtime by remember { mutableStateOf<NativeDmDurableRealtime?>(null) }
    var activityAllowed by remember { mutableStateOf(false) }
    val lifecycleOwner = LocalLifecycleOwner.current
    var foreground by remember { mutableStateOf(lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) }
    LaunchedEffect(initialConversationId) {
        if (initialConversationId?.matches(Regex("^[0-9a-fA-F-]{36}$")) == true) {
            selectedId = initialConversationId
            onDeepLinkConsumed()
        }
    }
    LaunchedEffect(initialPeerId) {
        val id = initialPeerId ?: return@LaunchedEffect
        if (id.matches(Regex("^[0-9a-fA-F-]{36}$"))) {
            try {
                selectedId = client.openConversation(id)
                refresh++
                onPeerConsumed()
            } catch (e: Exception) {
                error = e.message ?: "This member cannot receive your messages."
                onPeerConsumed()
            }
        }
    }
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START) foreground = true
            if (event == Lifecycle.Event.ON_STOP) foreground = false
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    val scope = rememberCoroutineScope()
    BackHandler(chatSettings) {
        wallpaper = appearance.wallpaperFor(selectedId)
        bubble = appearance.bubbleFor(selectedId)
        autoPhotos = appearance.autoPhotos && !appearance.dataSaver
        chatSettings = false
    }
    BackHandler(selectedId != null && !chatSettings) {
        if (selectedMessage != null) selectedMessage = null
        else {
            selectedId = null; thread = null; replyTo = null
            mediaByMessage = emptyMap(); refresh++
        }
    }
    BackHandler(newConversation) { newConversation = false; newQuery = ""; accounts = emptyList() }
    LaunchedEffect(auth.account?.id, refresh) {
        if (auth.account == null) { conversations = emptyList(); selectedId = null; return@LaunchedEffect }
        loading = conversations.isEmpty() && selectedId == null
        try {
            conversations = client.inbox()
            conversations.filter { it.unread > 0 }.take(15).forEach { c ->
                runCatching { client.acknowledgeDelivery(c.id) }
            }
        }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) { error = e.message ?: "Could not load messages." }
        finally { loading = false }
    }
    LaunchedEffect(selectedId, refresh) {
        val id = selectedId ?: return@LaunchedEffect
        val firstOpen = thread?.conversation?.id != id
        loading = firstOpen
        if (firstOpen) { thread = null; mediaByMessage = emptyMap() }
        try {
            val updated = client.thread(id)
            if (firstOpen || updated.messages != thread?.messages) {
                thread = updated
                mediaByMessage = runCatching { mediaClient.attachments(updated.messages) }
                    .getOrDefault(mediaByMessage)
            }
            val delivery = runCatching { client.acknowledgeDelivery(id) }
            val reading = runCatching { client.markRead(id) }
            val receipts = runCatching { client.peerReceipts(id) }
            if (receipts.isSuccess) peerReceipts = receipts.getOrThrow()
            // Do not treat optional ACK/read errors as a broken receipt display.
            // The status-specific retry UI represents peer status loading only.
            receiptIssue = receipts.isFailure
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) { error = e.message ?: "Could not open conversation." }
        finally { loading = false }
    }
    LaunchedEffect(selectedId, foreground) {
        val id = selectedId?.takeIf { foreground } ?: return@LaunchedEffect
        while (true) {
            delay(25_000)
            try {
                val updated = client.thread(id)
                if (selectedId == id && updated.messages != thread?.messages) {
                    thread = updated
                    mediaByMessage = runCatching { mediaClient.attachments(updated.messages) }
                        .getOrDefault(mediaByMessage)
                    client.acknowledgeDelivery(id)
                    client.markRead(id)
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { /* Manual refresh shows any persistent error. */ }
        }
    }
    // Read status is recipient-owned; poll only while the conversation is visible.
    // Unlike text messages, a remote browser read does not emit a Native chat event.
    LaunchedEffect(auth.account?.id, selectedId, foreground) {
        val id = selectedId?.takeIf { foreground && auth.account != null }
            ?: return@LaunchedEffect
        while (true) {
            delay(10_000)
            try {
                peerReceipts = client.peerReceipts(id)
                receiptIssue = false
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { receiptIssue = true }
        }
    }
    LaunchedEffect(auth.account?.id, selectedId, foreground) {
        if (auth.account == null || selectedId != null || !foreground) return@LaunchedEffect
        while (true) {
            delay(30000)
            try {
                conversations = client.inbox()
                conversations.filter { it.unread > 0 }.take(15).forEach { c ->
                    runCatching { client.acknowledgeDelivery(c.id) }
                }
            }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { /* The refresh action exposes persistent failures. */ }
        }
    }
    val livePeerId = conversations.firstOrNull { it.id == selectedId }?.peerId ?: thread?.conversation?.peerId
    LaunchedEffect(auth.account?.id, selectedId, livePeerId, foreground, visibilityRevision) {
        if (auth.account == null || !foreground) return@LaunchedEffect
        val selected = selectedId
        val enabled = runCatching { client.activityStatusEnabled() }.getOrDefault(false)
        activityAllowed = enabled
        val live = NativeDmRealtime(auth, selected, livePeerId,
            onChanged = { refresh++ },
            // The web currently uses Cloudflare Durable Objects for activity and typing.
            // Keep Supabase Realtime only for durable message change notifications.
            onPeerOnline = {},
            onPeerTyping = {})
        realtime = live
        try {
            live.start(this, selected != null && livePeerId != null && enabled)
            awaitCancellation()
        } finally {
            live.close()
            if (realtime === live) realtime = null
            peerOnline = false; peerTyping = false
        }
    }
    LaunchedEffect(auth.account?.id, selectedId, livePeerId, foreground, visibilityRevision) {
        val conversationId = selectedId ?: return@LaunchedEffect
        if (!foreground || auth.account == null) return@LaunchedEffect
        if (!runCatching { client.activityStatusEnabled() }.getOrDefault(false)) {
            peerOnline = false; peerTyping = false
            return@LaunchedEffect
        }
        val durable = NativeDmDurableRealtime(auth, conversationId,
            onOnline = { peerOnline = it },
            onTyping = { peerTyping = it })
        durableRealtime = durable
        try { durable.start(this) }
        finally {
            durable.close()
            if (durableRealtime === durable) durableRealtime = null
            peerOnline = false; peerTyping = false
        }
    }
    LaunchedEffect(draft, selectedId, realtime, durableRealtime, activityAllowed) {
        if (selectedId == null || !activityAllowed) return@LaunchedEffect
        val live = realtime
        val durable = durableRealtime
        try {
            if (draft.isBlank()) {
                live?.typing(false); durable?.typing(false)
                return@LaunchedEffect
            }
            delay(220)
            live?.typing(true); durable?.typing(true)
            // Keep typing visible while the other user is actively composing.
            delay(2000)
        } finally {
            live?.typing(false); durable?.typing(false)
        }
    }
    LaunchedEffect(auth.account?.id, foreground, visibilityRevision) {
        if (auth.account == null || !foreground) return@LaunchedEffect
        while (true) {
            runCatching { if (client.activityStatusEnabled()) client.touchActivity() }
            delay(180_000)
        }
    }
    LaunchedEffect(livePeerId, foreground, visibilityRevision) {
        val peer = livePeerId ?: return@LaunchedEffect
        if (!foreground) return@LaunchedEffect
        statusBucket = "hidden"
        while (true) {
            statusBucket = runCatching { client.peerActivityBucket(peer) }.getOrDefault("hidden")
            delay(45_000)
        }
    }
    LaunchedEffect(newConversation, newQuery) {
        if (!newConversation || newQuery.trim().length < 2) { accounts = emptyList(); return@LaunchedEffect }
        delay(350)
        try { accounts = client.searchAccounts(newQuery) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) { error = e.message ?: "Could not search members." }
    }
    if (chatSettings) {
        NativeMessageSettingsScreen(
            preferences = appearance,
            auth = auth,
            conversationId = selectedId,
            onBack = {
                wallpaper = appearance.wallpaperFor(selectedId)
                bubble = appearance.bubbleFor(selectedId)
                compact = appearance.compact
                autoPhotos = appearance.autoPhotos && !appearance.dataSaver
                chatSettings = false
            },
            onPrivacy = onOpenPrivacy,
            onBlocked = onOpenPrivacy,
            onVisibilityChanged = {
                peerOnline = false
                peerTyping = false
                statusBucket = "hidden"
                visibilityRevision++
                onActivityVisibilityChanged()
            }
        )
        return
    }
    val active = thread
    if (selectedId != null) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp)
                .background(MaterialTheme.colorScheme.surface),
                verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = {
                    if (selectedMessage != null) selectedMessage = null
                    else { selectedId = null; thread = null; refresh++ }
                }, Modifier.size(44.dp)) {
                    Icon(if (selectedMessage != null) Icons.Rounded.Close
                        else Icons.AutoMirrored.Rounded.ArrowBack,
                        if (selectedMessage != null) "Cancel selection" else "Back to inbox")
                }
                if (selectedMessage != null) {
                    Text("1 Selected", style = MaterialTheme.typography.titleSmall,
                        modifier = Modifier.weight(1f), maxLines = 1)
                } else {
                active?.conversation?.let { peer ->
                    val initials = peer.name.split(" ").filter { it.isNotBlank() }
                        .take(2).joinToString("") { it.take(1).uppercase() }.ifBlank { "SL" }
                    if (peer.hasAvatar && peer.handle.isNotBlank()) {
                        AuthorizedImage(auth, "/api/profile-media/${peer.handle}/avatar",
                            "Chat avatar", Modifier.size(41.dp).clip(CircleShape),
                            fallback = { SautiAvatar(initials, Modifier.size(41.dp), SautiColors.Blue) })
                    } else SautiAvatar(initials, Modifier.size(41.dp), SautiColors.Blue)
                }
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f).clickable(enabled = active?.conversation?.handle?.isNotBlank() == true) {
                    active?.conversation?.handle?.let(onOpenProfile)
                }) {
                    Row(verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(active?.conversation?.name ?: "Conversation",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.weight(1f, fill = false),
                            maxLines = 1, softWrap = false,
                            overflow = TextOverflow.Ellipsis)
                        active?.conversation?.let { peer ->
                            SautiVerificationBadge(peer.verified, peer.badgeType, peer.name, size = 17.dp)
                        }
                    }
                    val status = when {
                        peerTyping -> "typing…"
                        peerOnline -> "online"
                        statusBucket == "recently" -> "Active recently"
                        statusBucket == "week" -> "Last seen within a week"
                        statusBucket == "month" -> "Last seen within a month"
                        statusBucket == "long_ago" -> "Last seen long time ago"
                        else -> ""
                    }
                    if (status.isNotEmpty()) Text(status, style = MaterialTheme.typography.bodySmall,
                        color = if (peerOnline || peerTyping) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.onSurfaceVariant)
                }
                }
                if (selectedMessage != null) {
                    IconButton(onClick = {
                        val message = selectedMessage
                        if (message != null && message.senderId == auth.account?.id && message.kind == "text") {
                            editing = true; editedText = message.body
                        }
                    }, enabled = selectedMessage?.senderId == auth.account?.id &&
                            selectedMessage?.kind == "text") {
                        Icon(Icons.Rounded.Edit, "Edit selected message")
                    }
                    IconButton(onClick = {
                        selectedMessage?.let { clipboard.setText(AnnotatedString(it.body)) }
                        selectedMessage = null
                    }) { Icon(Icons.Rounded.ContentCopy, "Copy selected message") }
                    IconButton(onClick = { forwarding = true }) {
                        Icon(Icons.Rounded.Forward, "Forward selected message")
                    }
                    IconButton(onClick = { deleteEverywhere = false; deleteConfirm = true }) {
                        Icon(Icons.Rounded.DeleteOutline, "Delete selected message")
                    }
                } else {
                    IconButton(onClick = {
                        android.widget.Toast.makeText(context, "Audio calls rolling out soon", android.widget.Toast.LENGTH_SHORT).show()
                    }) { Icon(Icons.Rounded.Phone, "Audio call") }
                    IconButton(onClick = {
                        android.widget.Toast.makeText(context, "Video calls rolling out soon", android.widget.Toast.LENGTH_SHORT).show()
                    }) { Icon(Icons.Rounded.Videocam, "Video call") }
                    Box {
                        IconButton(onClick = { chatMenu = true }) {
                            Icon(Icons.Rounded.MoreHoriz, "Conversation options")
                        }
                        DropdownMenu(expanded = chatMenu, onDismissRequest = { chatMenu = false }) {
                            DropdownMenuItem(text = { Text("Search in chat") }, onClick = {
                                searchingThread = true; chatMenu = false
                            })
                            DropdownMenuItem(text = { Text("Chat theme") }, onClick = {
                                chatSettings = true; chatMenu = false
                            })
                            DropdownMenuItem(text = { Text("Block account") }, onClick = {
                                chatMenu = false
                                val handle = active?.conversation?.handle
                                if (!handle.isNullOrBlank()) scope.launch {
                                    try { safety.setBlocked(handle, true); error = "Account blocked." }
                                    catch (e: Exception) { error = e.message }
                                }
                            })
                            DropdownMenuItem(text = { Text("Clear chat for me") }, onClick = {
                                clearEveryone = false
                                clearConfirm = true; chatMenu = false
                            })
                        }
                    }
                }
            }
            if (searchingThread) {
                OutlinedTextField(threadQuery, { threadQuery = it.take(120) },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                    placeholder = { Text("Search in this conversation") },
                    leadingIcon = { Icon(Icons.Rounded.Search, null) },
                    trailingIcon = {
                        IconButton(onClick = { searchingThread = false; threadQuery = "" }) {
                            Icon(Icons.Rounded.Close, "Close chat search")
                        }
                    }, singleLine = true, shape = RoundedCornerShape(18.dp))
            }
            if (loading && active == null) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (active != null) {
                val ownId = auth.account?.id
                val bubbleLimit = minOf(LocalConfiguration.current.screenWidthDp.dp * .79f, 320.dp)
                val shownMessages = if (threadQuery.isBlank()) active.messages
                    else active.messages.filter { it.body.contains(threadQuery, ignoreCase = true) }
                val listState = rememberLazyListState()
                LaunchedEffect(shownMessages.size, searchingThread, peerTyping) {
                    if (shownMessages.isNotEmpty()) {
                        listState.animateScrollToItem(shownMessages.lastIndex + if (peerTyping) 1 else 0)
                    }
                }
                LazyColumn(state = listState, modifier = Modifier.weight(1f).fillMaxWidth()
                    .background(messageWallpaper(wallpaper)),
                    contentPadding = PaddingValues(12.dp),
                    verticalArrangement = Arrangement.spacedBy(if (compact) 2.dp else 5.dp)) {
                    if (shownMessages.isEmpty()) item {
                        Text(if (threadQuery.isBlank()) "No messages yet." else "No matching messages.")
                    }
                    itemsIndexed(shownMessages, key = { _, entry -> entry.id }) { index, message ->
                        val own = message.senderId == ownId
                        Column(Modifier.animateItem()) {
                        if (index == 0 || shownMessages[index - 1].sentAt.take(10) != message.sentAt.take(10)) {
                            Box(Modifier.fillMaxWidth().padding(vertical = 9.dp),
                                contentAlignment = Alignment.Center) {
                                Surface(color = MaterialTheme.colorScheme.surface.copy(alpha = .86f),
                                    shape = RoundedCornerShape(15.dp)) {
                                    Text(chatDay(message.sentAt),
                                        style = MaterialTheme.typography.labelSmall,
                                        modifier = Modifier.padding(horizontal = 13.dp, vertical = 5.dp))
                                }
                            }
                        }
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = if (own) Arrangement.End else Arrangement.Start) {
                            Surface(
                                shape = if (own) RoundedCornerShape(17.dp, 17.dp, 5.dp, 17.dp)
                                    else RoundedCornerShape(17.dp, 17.dp, 17.dp, 5.dp),
                                color = if (own) outgoingBubble(bubble)
                                    else MaterialTheme.colorScheme.surface,
                                tonalElevation = if (own) 0.dp else 1.dp,
                                shadowElevation = 1.dp,
                                modifier = Modifier.widthIn(max = bubbleLimit)
                                    .pointerInput(message.id) {
                                        var movement = 0f
                                        detectHorizontalDragGestures(
                                            onHorizontalDrag = { _, distance ->
                                                if (distance > 0f) movement += distance
                                            }, onDragEnd = {
                                                if (movement >= 75f) {
                                                    replyTo = message
                                                    draft = ""
                                                }
                                                movement = 0f
                                            }
                                        )
                                    }
                                    .combinedClickable(
                                        onClick = { if (selectedMessage != null) selectedMessage = message },
                                        onLongClick = { selectedMessage = message })
                            ) {
                                Column(Modifier.padding(horizontal = 11.dp, vertical = 7.dp),
                                    verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    if (message.replyTo != null) {
                                        val quoted = active.messages.firstOrNull { it.id == message.replyTo }
                                        val author = if (quoted?.senderId == ownId) "You" else active.conversation.name
                                        val quoteColor = if (own && bubble != "neutral") Color.White
                                            else MaterialTheme.colorScheme.primary
                                        Row(
                                            Modifier.clickable {
                                                val at = shownMessages.indexOfFirst { it.id == message.replyTo }
                                                if (at >= 0) scope.launch { listState.animateScrollToItem(at) }
                                            }.background(
                                                if (own && bubble != "neutral") Color.White.copy(alpha = .12f)
                                                else MaterialTheme.colorScheme.primary.copy(alpha = .08f),
                                                RoundedCornerShape(8.dp))
                                                .padding(horizontal = 7.dp, vertical = 6.dp),
                                            horizontalArrangement = Arrangement.spacedBy(7.dp),
                                            verticalAlignment = Alignment.CenterVertically
                                        ) {
                                            Box(Modifier.width(3.dp).height(34.dp)
                                                .background(quoteColor, RoundedCornerShape(2.dp)))
                                            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                                Text(author, color = quoteColor,
                                                    fontWeight = FontWeight.SemiBold,
                                                    style = MaterialTheme.typography.labelSmall,
                                                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                                                Text(quoted?.body?.ifBlank { "Attachment" } ?: "Original message",
                                                    color = quoteColor.copy(alpha = .82f),
                                                    style = MaterialTheme.typography.labelSmall,
                                                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                                            }
                                        }
                                    }
                                    if (message.kind != "text") {
                                        val media = mediaByMessage[message.id]
                                        if (media != null) NativeDmAttachmentBubble(
                                            auth, media, autoLoadPhotos = autoPhotos,
                                            isOutgoing = own,
                                            onError = { error = it })
                                        else Text("Attachment unavailable",
                                            style = MaterialTheme.typography.bodySmall)
                                    }
                                    if (message.body.isNotBlank()) {
                                        Text(message.body,
                                            color = if (own && bubble != "neutral") Color.White
                                                else MaterialTheme.colorScheme.onSurface)
                                    }
                                    Row(
                                        modifier = Modifier.align(Alignment.End),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(3.dp)
                                    ) {
                                        Text(chatClock(message.sentAt) +
                                            if (message.editedAt != null) " · edited" else "",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = if (own && bubble != "neutral") Color.White.copy(alpha = .78f)
                                                else MaterialTheme.colorScheme.onSurfaceVariant)
                                        if (own) NativeDmReceiptTicks(
                                            message.sentAt, peerReceipts,
                                            color = if (bubble != "neutral") Color.White.copy(alpha = .8f)
                                                else MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
 
                                }
                            }
                        }
                        }
                    }
                    if (peerTyping) item(key = "peer-typing") {
                        NativeDmTypingBubble()
                    }
                }
                if (receiptIssue) {
                    TextButton(
                        onClick = { refresh++ },
                        modifier = Modifier.padding(horizontal = 10.dp)
                    ) {
                        Icon(Icons.Rounded.Refresh, null, Modifier.size(15.dp))
                        Spacer(Modifier.width(7.dp))
                        Text("Message status unavailable · Retry",
                            style = MaterialTheme.typography.labelSmall)
                    }
                }
                if (error != null) Text(error.orEmpty(), Modifier.padding(horizontal = 16.dp),
                    color = MaterialTheme.colorScheme.error)
                if (reportNote != null) Text(reportNote.orEmpty(), Modifier.padding(horizontal = 16.dp),
                    color = if (reportNote == "Report submitted.") MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.error)
                if (replyTo != null) {
                    Surface(shape = RoundedCornerShape(14.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .55f),
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 5.dp)) {
                        Row(Modifier.padding(start = 10.dp, end = 2.dp, top = 7.dp, bottom = 7.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.width(3.dp).height(35.dp)
                                .background(MaterialTheme.colorScheme.primary,
                                    RoundedCornerShape(3.dp)))
                            Spacer(Modifier.width(9.dp))
                            Column(Modifier.weight(1f)) {
                                Text(if (replyTo?.senderId == ownId) "Reply to yourself"
                                    else "Reply to ${active.conversation.name}",
                                    color = MaterialTheme.colorScheme.primary,
                                    fontWeight = FontWeight.SemiBold,
                                    style = MaterialTheme.typography.labelMedium)
                                Text(replyTo?.body?.take(85) ?: "",
                                    style = MaterialTheme.typography.bodySmall,
                                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            IconButton(onClick = { replyTo = null }) {
                                Icon(Icons.Rounded.Close, "Cancel reply", Modifier.size(19.dp))
                            }
                        }
                    }
                }
                Row(Modifier.fillMaxWidth().imePadding()
                    .background(MaterialTheme.colorScheme.surface).padding(6.dp),
                    verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                    NativeDmMediaControls(auth, active.conversation.id,
                        onSent = { refresh++ }, onError = { error = it })
                    OutlinedTextField(draft, { draft = it.take(4000) },
                        modifier = Modifier.weight(1f), placeholder = { Text("Message") },
                        shape = RoundedCornerShape(25.dp),
                        maxLines = 5)
                    Button(onClick = {
                        if (sending) return@Button
                        val body = draft.trim()
                        if (body.isEmpty()) return@Button
                        sending = true; error = null
                        scope.launch {
                            try {
                                client.send(active.conversation.id, body, replyTo?.id)
                                replyTo = null
                                realtime?.typing(false)
                                durableRealtime?.typing(false)
                                if (selectedId == active.conversation.id) {
                                    if (draft.trim() == body) draft = ""
                                    thread = client.thread(active.conversation.id)
                                }
                            } catch (cancelled: CancellationException) { throw cancelled }
                            catch (e: Exception) { error = e.message ?: "Message could not be sent." }
                            finally { sending = false }
                        }
                    }, enabled = draft.isNotBlank() && !sending,
                        contentPadding = PaddingValues(horizontal = 12.dp),
                        shape = CircleShape) {
                        Icon(Icons.Rounded.Send, "Send message")
                    }
                }
            }
        }
        if (deleteConfirm && selectedMessage != null) {
            val target = selectedMessage!!
            val owner = target.senderId == auth.account?.id
            AlertDialog(
                onDismissRequest = { if (!sending) deleteConfirm = false },
                title = { Text("Delete message") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("Are you sure you want to delete this message?")
                        if (owner) Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = deleteEverywhere, onCheckedChange = {
                                deleteEverywhere = it
                            })
                            Text("Also delete for " +
                                (active?.conversation?.name ?: "recipient"),
                                style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                },
                confirmButton = {
                    TextButton(enabled = !sending, onClick = {
                        sending = true
                        scope.launch {
                            try {
                                if (deleteEverywhere && owner) client.deleteOwnForEveryone(target.id)
                                else client.deleteForMe(target, active!!.conversation.id)
                                thread = thread?.copy(messages =
                                    thread?.messages.orEmpty().filterNot { it.id == target.id })
                                selectedMessage = null
                                deleteConfirm = false
                            } catch (e: Exception) { error = e.message ?: "Delete failed." }
                            finally { sending = false }
                        }
                    }) {
                        Text("Delete", color = MaterialTheme.colorScheme.error)
                    }
                },
                dismissButton = { TextButton(onClick = { deleteConfirm = false }) {
                    Text("Cancel")
                } }
            )
        }
        if (editing && selectedMessage != null) {
            val target = selectedMessage!!
            AlertDialog(onDismissRequest = { editing = false },
                title = { Text("Edit message") },
                text = {
                    OutlinedTextField(editedText, { editedText = it.take(4000) },
                        label = { Text("Message") }, minLines = 2, maxLines = 5)
                },
                confirmButton = {
                    TextButton(enabled = !sending && editedText.isNotBlank(), onClick = {
                        sending = true
                        scope.launch {
                            try {
                                val value = editedText.trim()
                                client.editOwnMessage(target.id, value)
                                thread = thread?.copy(messages = thread?.messages.orEmpty().map {
                                    if (it.id == target.id) it.copy(body = value,
                                        editedAt = java.time.Instant.now().toString()) else it
                                })
                                editing = false
                                selectedMessage = null
                            } catch (e: Exception) { error = e.message ?: "Edit failed." }
                            finally { sending = false }
                        }
                    }) { Text("Save") }
                },
                dismissButton = { TextButton(onClick = { editing = false }) { Text("Cancel") } }
            )
        }
        if (forwarding && selectedMessage != null) {
            val target = selectedMessage!!
            AlertDialog(onDismissRequest = { forwarding = false },
                title = { Text("Forward to") },
                text = {
                    Column(Modifier.heightIn(max = 320.dp)) {
                        if (target.kind != "text") Text(
                            "Forwarding attachments is not yet available.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        else {
                            conversations.filter { it.id != selectedId }.forEach { conv ->
                                TextButton(enabled = !sending, onClick = {
                                    sending = true
                                    scope.launch {
                                        try {
                                            client.send(conv.id, target.body)
                                            forwarding = false; selectedMessage = null
                                        } catch (e: Exception) { error = e.message }
                                        finally { sending = false }
                                    }
                                }) { Text(conv.name) }
                            }
                        }
                    }
                },
                confirmButton = { TextButton(onClick = { forwarding = false }) { Text("Done") } }
            )
        }
        if (clearConfirm) AlertDialog(onDismissRequest = { clearConfirm = false },
            title = { Text("Clear chat for you?") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("All messages will disappear from your view.")
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = clearEveryone, onCheckedChange = { clearEveryone = it })
                        Text("Also delete messages you sent for the recipient.",
                            style = MaterialTheme.typography.bodySmall)
                    }
                    Text("You cannot erase messages the other person wrote from their account.",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    val id = active?.conversation?.id ?: return@TextButton
                    sending = true
                    scope.launch {
                        try {
                            if (clearEveryone) client.clearMySentForEveryone(id)
                            client.clearForMe(id)
                            thread = thread?.copy(messages = emptyList())
                            clearConfirm = false
                        } catch (e: Exception) { error = e.message }
                        finally { sending = false }
                    }
                }, enabled = !sending) { Text("Clear", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { clearConfirm = false }) { Text("Cancel") } }
        )
        if (reportMessageId != null) NativeReportDialog("message", reportBusy, error = reportNote,
            onDismiss = { reportMessageId = null }) { reason, details ->
            val id = reportMessageId ?: return@NativeReportDialog
            reportBusy = true; reportNote = null
            scope.launch {
                try { safety.report("message", id, reason, details); reportMessageId = null; reportNote = "Report submitted." }
                catch (e: Exception) { reportNote = e.message ?: "Could not send report." }
                finally { reportBusy = false }
            }
        }
        return
    }
    if (newConversation) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { newConversation = false; newQuery = ""; accounts = emptyList() }) {
                    Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back to inbox")
                }
                Text("New message", style = MaterialTheme.typography.titleLarge)
            }
            OutlinedTextField(newQuery, { newQuery = it.take(64) },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp),
                placeholder = { Text("Search member") }, singleLine = true,
                leadingIcon = { Icon(Icons.Rounded.Search, null) })
            if (newLoading) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (error != null) Text(error.orEmpty(), Modifier.padding(18.dp), color = MaterialTheme.colorScheme.error)
            LazyColumn {
                items(accounts, key = { it.id }) { account ->
                    Column(Modifier.fillMaxWidth().clickable(enabled = !newLoading) {
                        newLoading = true; error = null
                        scope.launch {
                            try {
                                val id = client.openConversation(account.id)
                                conversations = client.inbox()
                                selectedId = id
                                newConversation = false; newQuery = ""; accounts = emptyList()
                            } catch (cancelled: CancellationException) { throw cancelled }
                            catch (e: Exception) { error = e.message ?: "Could not open conversation." }
                            finally { newLoading = false }
                        }
                    }.padding(horizontal = 18.dp, vertical = 14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(account.name, fontWeight = FontWeight.SemiBold)
                            SautiVerificationBadge(account.verified, account.badgeType,
                                account.name, size = 15.dp)
                        }
                        Text("@${account.handle}", style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    HorizontalDivider()
                }
            }
        }
        return
    }
    val shown = conversations.filter { item ->
        (!unreadOnly || item.unread > 0) && (query.isBlank() || item.name.contains(query, true)
            || item.handle.contains(query.removePrefix("@"), true) || item.latestBody.contains(query, true))
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 8.dp, top = 12.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Text("Chats", style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            IconButton(onClick = { chatSettings = true }) {
                Icon(Icons.Rounded.Settings, "Chat settings")
            }
            IconButton(onClick = { error = null; newConversation = true },
                enabled = auth.account != null) {
                Icon(Icons.Rounded.Edit, "New message")
            }
        }
        OutlinedTextField(query, { query = it.take(80) }, modifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp),
            placeholder = { Text("Search conversations") }, leadingIcon = { Icon(Icons.Rounded.Search, null) },
            singleLine = true, shape = SautiShape.Pill)
        Row(Modifier.padding(horizontal = 18.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = !unreadOnly, onClick = { unreadOnly = false }, label = { Text("All") })
            FilterChip(selected = unreadOnly, onClick = { unreadOnly = true }, label = { Text("Unread") })
        }
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (auth.account == null) {
            Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(if (auth.sessionState == StagingSessionState.CHECKING) "Restoring session…"
                    else "Sign in to see your conversations.")
                Spacer(Modifier.height(12.dp))
                if (auth.sessionState != StagingSessionState.CHECKING)
                    Button(onClick = onSignIn) { Text("Sign in") }
            }
        } else {
            if (error != null) Text(error.orEmpty(), Modifier.padding(18.dp), color = MaterialTheme.colorScheme.error)
            LazyColumn(contentPadding = PaddingValues(bottom = 20.dp)) {
                if (loading && conversations.isEmpty()) items(5) { SautiExploreSkeleton() }
                if (!loading && shown.isEmpty()) item {
                    Text(if (query.isBlank() && !unreadOnly) "No conversations yet."
                        else "No matching conversations.", Modifier.padding(22.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                items(shown, key = { it.id }) { item ->
                    Row(Modifier.fillMaxWidth().clickable { selectedId = item.id }.padding(horizontal = 18.dp, vertical = 13.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        val initials = item.name.split(" ").filter { it.isNotBlank() }
                            .take(2).joinToString("") { it.take(1).uppercase() }.ifBlank { "SL" }
                        if (item.hasAvatar && item.handle.isNotBlank()) {
                            AuthorizedImage(auth, "/api/profile-media/${item.handle}/avatar",
                                "Profile picture", Modifier.size(54.dp).clip(CircleShape),
                                fallback = { SautiAvatar(initials, Modifier.size(54.dp), SautiColors.Blue) })
                        } else SautiAvatar(initials, Modifier.size(54.dp), SautiColors.Blue)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                                Text(item.name, fontWeight = if (item.unread > 0) FontWeight.Bold else FontWeight.SemiBold)
                                SautiVerificationBadge(item.verified, item.badgeType,
                                    item.name, size = 15.dp)
                            }
                            Text("@${item.handle}" + if (item.muted) " · Muted" else "",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(item.latestBody.ifBlank { "Conversation" }, maxLines = 1,
                                overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (item.unread > 0) Badge { Text(item.unread.coerceAtMost(99).toString()) }
                    }
                    HorizontalDivider()
                }
            }
        }
    }
}

private fun chatDay(timestamp: String): String = runCatching {
    java.time.OffsetDateTime.parse(timestamp)
        .atZoneSameInstant(java.time.ZoneId.systemDefault())
        .format(java.time.format.DateTimeFormatter.ofPattern("MMMM d"))
}.getOrDefault(timestamp.take(10))

private fun chatClock(timestamp: String): String = runCatching {
    java.time.OffsetDateTime.parse(timestamp)
        .atZoneSameInstant(java.time.ZoneId.systemDefault())
        .format(java.time.format.DateTimeFormatter.ofPattern("h:mm a"))
}.getOrDefault(timestamp.take(16).takeLast(5))
