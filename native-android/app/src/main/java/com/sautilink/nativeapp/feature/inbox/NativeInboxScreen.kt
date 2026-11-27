package com.sautilink.nativeapp.feature.inbox

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.text.font.FontWeight
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
import com.sautilink.nativeapp.ui.components.SautiVerificationBadge
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.awaitCancellation

@Composable
fun NativeInboxScreen(auth: StagingAuthClient, onSignIn: () -> Unit, onOpenProfile: (String) -> Unit,
    initialConversationId: String? = null, onDeepLinkConsumed: () -> Unit = {}) {
    val client = remember(auth) { NativeMessagesClient(auth) }
    val safety = remember(auth) { NativeSafetyClient(auth) }
    var conversations by remember { mutableStateOf<List<NativeConversation>>(emptyList()) }
    var selectedId by rememberSaveable { mutableStateOf<String?>(null) }
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
    val lifecycleOwner = LocalLifecycleOwner.current
    var foreground by remember { mutableStateOf(lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) }
    LaunchedEffect(initialConversationId) {
        if (initialConversationId?.matches(Regex("^[0-9a-fA-F-]{36}$")) == true) {
            selectedId = initialConversationId
            onDeepLinkConsumed()
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
    BackHandler(selectedId != null) { selectedId = null; thread = null; refresh++ }
    BackHandler(newConversation) { newConversation = false; newQuery = ""; accounts = emptyList() }
    LaunchedEffect(auth.account?.id, refresh) {
        if (auth.account == null) { conversations = emptyList(); selectedId = null; return@LaunchedEffect }
        loading = true; error = null
        try { conversations = client.inbox() }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) { error = e.message ?: "Could not load messages." }
        finally { loading = false }
    }
    LaunchedEffect(selectedId, refresh) {
        val id = selectedId ?: return@LaunchedEffect
        loading = true; error = null; thread = null
        try {
            thread = client.thread(id)
            runCatching { client.markRead(id) }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) { error = e.message ?: "Could not open conversation." }
        finally { loading = false }
    }
    LaunchedEffect(selectedId, foreground) {
        val id = selectedId?.takeIf { foreground } ?: return@LaunchedEffect
        while (true) {
            delay(15000)
            try {
                val updated = client.thread(id)
                if (selectedId == id && updated.messages != thread?.messages) {
                    thread = updated
                    client.markRead(id)
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { /* Manual refresh shows any persistent error. */ }
        }
    }
    LaunchedEffect(auth.account?.id, selectedId, foreground) {
        if (auth.account == null || selectedId != null || !foreground) return@LaunchedEffect
        while (true) {
            delay(30000)
            try { conversations = client.inbox() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { /* The refresh action exposes persistent failures. */ }
        }
    }
    val livePeerId = conversations.firstOrNull { it.id == selectedId }?.peerId ?: thread?.conversation?.peerId
    LaunchedEffect(auth.account?.id, selectedId, livePeerId, foreground) {
        if (auth.account == null || !foreground) return@LaunchedEffect
        val selected = selectedId
        val live = NativeDmRealtime(auth, selected, livePeerId,
            onChanged = { refresh++ },
            onPeerOnline = { peerOnline = it },
            onPeerTyping = { peerTyping = it })
        realtime = live
        try {
            live.start(this, selected != null && livePeerId != null &&
                runCatching { client.activityStatusEnabled() }.getOrDefault(false))
            awaitCancellation()
        } finally {
            live.close()
            if (realtime === live) realtime = null
            peerOnline = false; peerTyping = false
        }
    }
    LaunchedEffect(draft, selectedId, realtime) {
        val live = realtime ?: return@LaunchedEffect
        if (selectedId == null) return@LaunchedEffect
        if (draft.isBlank()) { live.typing(false); return@LaunchedEffect }
        delay(250)
        live.typing(true)
        delay(1400)
        live.typing(false)
    }
    LaunchedEffect(newConversation, newQuery) {
        if (!newConversation || newQuery.trim().length < 2) { accounts = emptyList(); return@LaunchedEffect }
        delay(350)
        try { accounts = client.searchAccounts(newQuery) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) { error = e.message ?: "Could not search members." }
    }
    val active = thread
    if (selectedId != null) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { selectedId = null; thread = null; refresh++ }) {
                    Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back to inbox")
                }
                Column(Modifier.weight(1f).clickable(enabled = active?.conversation?.handle?.isNotBlank() == true) {
                    active?.conversation?.handle?.let(onOpenProfile)
                }) {
                    Row(verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(active?.conversation?.name ?: "Conversation", style = MaterialTheme.typography.titleLarge)
                        active?.conversation?.let { peer ->
                            SautiVerificationBadge(peer.verified, peer.badgeType, peer.name, size = 17.dp)
                        }
                    }
                    if (peerTyping || peerOnline) Text(if (peerTyping) "Typing…" else "Online",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = { refresh++ }, enabled = !loading) { Icon(Icons.Rounded.Refresh, "Refresh conversation") }
            }
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (active != null) {
                val ownId = auth.account?.id
                val listState = rememberLazyListState()
                LaunchedEffect(active.messages.size) {
                    if (active.messages.isNotEmpty()) listState.scrollToItem(active.messages.lastIndex)
                }
                LazyColumn(state = listState, modifier = Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (active.messages.isEmpty()) item { Text("No messages yet.") }
                    items(active.messages, key = { it.id }) { message ->
                        val own = message.senderId == ownId
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = if (own) Arrangement.End else Arrangement.Start) {
                            Surface(shape = SautiShape.Card,
                                color = if (own) MaterialTheme.colorScheme.primaryContainer
                                    else MaterialTheme.colorScheme.surfaceContainer,
                                modifier = Modifier.widthIn(max = 300.dp)) {
                                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                    Text(if (message.deleted) "Message deleted." else message.body)
                                    Text(message.sentAt.take(16).replace('T', ' '),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    if (!own && !message.deleted) TextButton(onClick = {
                                        reportMessageId = message.id; reportNote = null
                                    }, contentPadding = PaddingValues(0.dp)) { Text("Report") }
                                }
                            }
                        }
                    }
                }
                if (error != null) Text(error.orEmpty(), Modifier.padding(horizontal = 16.dp),
                    color = MaterialTheme.colorScheme.error)
                if (reportNote != null) Text(reportNote.orEmpty(), Modifier.padding(horizontal = 16.dp),
                    color = if (reportNote == "Report submitted.") MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.error)
                Row(Modifier.fillMaxWidth().imePadding().padding(12.dp),
                    verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(draft, { draft = it.take(4000) },
                        modifier = Modifier.weight(1f), placeholder = { Text("Message") },
                        maxLines = 5, shape = SautiShape.Card)
                    Button(onClick = {
                        if (sending) return@Button
                        val body = draft.trim()
                        if (body.isEmpty()) return@Button
                        sending = true; error = null
                        scope.launch {
                            try {
                                client.send(active.conversation.id, body)
                                realtime?.typing(false)
                                if (selectedId == active.conversation.id) {
                                    if (draft.trim() == body) draft = ""
                                    thread = client.thread(active.conversation.id)
                                }
                            } catch (cancelled: CancellationException) { throw cancelled }
                            catch (e: Exception) { error = e.message ?: "Message could not be sent." }
                            finally { sending = false }
                        }
                    }, enabled = draft.isNotBlank() && !sending) { Text(if (sending) "..." else "Send") }
                }
            }
        }
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
            Text("Messages", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.weight(1f))
            TextButton(onClick = { error = null; newConversation = true }, enabled = auth.account != null) { Text("New") }
            IconButton(onClick = { refresh++ }, enabled = !loading) { Icon(Icons.Rounded.Refresh, "Refresh inbox") }
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
                if (!loading && shown.isEmpty()) item {
                    Text(if (query.isBlank() && !unreadOnly) "No conversations yet."
                        else "No matching conversations.", Modifier.padding(22.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                items(shown, key = { it.id }) { item ->
                    Row(Modifier.fillMaxWidth().clickable { selectedId = item.id }.padding(horizontal = 18.dp, vertical = 13.dp),
                        verticalAlignment = Alignment.CenterVertically) {
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
