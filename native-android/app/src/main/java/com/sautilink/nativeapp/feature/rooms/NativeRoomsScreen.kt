package com.sautilink.nativeapp.feature.rooms

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.ui.components.SautiPostSkeleton
import com.sautilink.nativeapp.ui.state.rememberSessionScreenPresentationAccess
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

private enum class RoomsSheet { CREATE, SETTINGS, MANAGE, INVITE, PEOPLE, OUTGOING, POST, MEMBERSHIP }

@Composable
fun NativeRoomsScreen(auth: StagingAuthClient, onBack: () -> Unit, onSignIn: () -> Unit,
    onOpenProfile: (String) -> Unit, initialRoomSlug: String? = null) {
    val accountId = auth.account?.id
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val presentations = rememberSessionScreenPresentationAccess()
    val returnInitial = remember(presentations, accountId) { readRoomsReturnPresentation(presentations.store) }
    val anchors = remember(presentations) { LinkedHashMap<String, RoomReturnAnchor>(returnInitial.snapshot.anchors) }
    val state = remember(auth, accountId) { RoomsState(auth, accountId, context, scope).apply {
        tab = returnInitial.snapshot.tab
        search = returnInitial.snapshot.search
        category = returnInitial.snapshot.category
    } }
    val community = remember(auth, accountId) { RoomManagementState(auth, accountId, scope) }
    val entry = remember(state, initialRoomSlug) { state.restoreEntry(initialRoomSlug) }
    var sheet by remember(accountId) { mutableStateOf<RoomsSheet?>(null) }
    var jumpTarget by remember(accountId) { mutableStateOf(entry.postId) }
    var confirmation by remember(accountId, state.selected?.id) { mutableStateOf<String?>(null) }
    val room = state.selected
    var pendingMembership by remember(accountId) { mutableStateOf<Pair<String, String>?>(null) }
    var membershipAction by remember(accountId) { mutableStateOf("join") }
    var managedPost by remember(accountId, room?.id) { mutableStateOf<NativeRoomPost?>(null) }
    val listKey = room?.let { "group-${it.id}-${state.roomTab.name}" } ?: "landing-${state.tab.name}"
    val listState = key(accountId, listKey) {
        val anchor = readRoomReturnAnchor(anchors, listKey)
        rememberLazyListState(anchor.index, anchor.offset)
    }
    DisposableEffect(presentations, listKey, listState) {
        onDispose {
            anchors.remove(listKey)
            anchors[listKey] = RoomReturnAnchor(listState.firstVisibleItemIndex, listState.firstVisibleItemScrollOffset)
            while (anchors.size > 5) anchors.remove(anchors.keys.first())
            presentations.save("rooms-navigation", returnInitial.revision,
                RoomsReturnPresentation(state.tab, state.search.take(200), state.category, anchors.toMap()))
        }
    }
    DisposableEffect(state, community) { onDispose { state.dispose(); community.dispose() } }
    LaunchedEffect(community, room?.id, room?.role, room?.privacy, room?.viewerId) { community.open(room) }
    val beginMembership: (NativeRoom, String) -> Unit = { target, action ->
        pendingMembership = target.id to action
        if (room?.id != target.id) state.openRoom(target)
    }
    fun refreshMembership() {
        state.loadLanding()
        state.refreshRoom()
    }
    LaunchedEffect(pendingMembership, room?.id, community.capabilityLoading, community.capabilityResolved,
        community.capabilityError, community.configuration, community.configurationLoading, community.configurationError) {
        val pending = pendingMembership ?: return@LaunchedEffect
        if (room?.id != pending.first || community.capabilityLoading || community.configurationLoading ||
            (!community.capabilityResolved && community.capabilityError == null)) return@LaunchedEffect
        pendingMembership = null
        membershipAction = pending.second
        val configuration = community.configuration?.takeIf { community.available && it.roomId == room.id }
        if (configuration != null) {
            if (configuration.questions.isNotEmpty()) sheet = RoomsSheet.MEMBERSHIP
            else community.requestMembership(room, configuration, emptyList(), pending.second) { refreshMembership() }
        } else when (pending.second) {
            "accept_invitation" -> {
                val invitation = state.invitations.firstOrNull { it.room.id == room.id }
                if (invitation != null) state.respond(invitation, true)
                else state.reportError("This invitation changed. Refresh invitations and try again.")
            }
            "request" -> state.mutate("join", room, { state.client.requestJoin(room) })
            else -> state.mutate("join", room, { state.client.join(room) })
        }
    }
    LaunchedEffect(state, initialRoomSlug) {
        if (accountId != null) {
            // A profile round trip opens the canonical Room directly; hidden landing queries wait until Back.
            if (entry.slug != null) state.openSlug(entry.slug) else state.loadLanding()
        }
    }
    val openProfile: (String) -> Unit = { handle ->
        state.rememberProfileReturn(initialRoomSlug, null)
        onOpenProfile(handle)
    }
    val openMessage: (String) -> Unit = { id ->
        sheet = null
        jumpTarget = id
        state.selectRoomTab(RoomTab.DISCUSSION)
    }
    val closeSheet = { sheet = null }
    if (sheet == RoomsSheet.CREATE || (sheet == RoomsSheet.SETTINGS && room?.canManageSettings == true)) {
        val editing = room.takeIf { sheet == RoomsSheet.SETTINGS }
        RoomSettingsScreen(auth, accountId, editing, state.busy(if (editing == null) "create" else "settings"),
            state.roomError, closeSheet,
            memberPrivacyAvailable = editing?.memberPrivacyAvailable ?: state.memberPrivacyAvailable) { snapshot, settings, cover ->
            if (snapshot == null) state.create(settings, cover, closeSheet)
            else state.saveSettings(snapshot, settings, cover, closeSheet)
        }
        return
    }
    val activity = rememberRoomChatActivity(state, room)
    BackHandler(room != null || state.openingSlug) { state.closeRoom(); sheet = null; pendingMembership = null; jumpTarget = null }
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface).imePadding()) {
        val back = {
            if (room != null || state.openingSlug) state.closeRoom() else onBack()
            pendingMembership = null
            sheet = null
            jumpTarget = null
        }
        if (room == null) RoomsTopBar(if (state.openingSlug) "Opening Room" else "Rooms", state.discoverLoading,
            onBack = back, onRefresh = state::loadLanding,
            onCreate = if (accountId != null) ({ sheet = RoomsSheet.CREATE }) else null)
        when {
            accountId == null -> RoomEmpty("Your communities on SautiLink", "Sign in to discover, join and create Rooms.",
                actionLabel = "Sign in", onAction = onSignIn)
            state.openingSlug && room == null -> Column { repeat(4) { RoomCardSkeleton() } }
            room == null -> RoomsLanding(state, listState, { sheet = RoomsSheet.CREATE }, { beginMembership(it.room, "accept_invitation") })
            else -> RoomDetail(state, community, room, activity, listState, openProfile, openMessage,
                jumpTarget = jumpTarget, onJumpHandled = { if (jumpTarget == it) jumpTarget = null },
                onBack = back, onEdit = { sheet = RoomsSheet.SETTINGS },
                onManage = { sheet = RoomsSheet.MANAGE }, onInvite = { sheet = RoomsSheet.INVITE },
                onLeave = { confirmation = "leave" },
                onMembership = { beginMembership(room, it) },
                onManagePost = { managedPost = it; sheet = RoomsSheet.POST })
        }
    }
    when (sheet) {
        RoomsSheet.CREATE, RoomsSheet.SETTINGS -> Unit
        RoomsSheet.MANAGE -> if (room != null) RoomManageSheet(room, state, closeSheet,
            { sheet = RoomsSheet.SETTINGS }, { state.loadPeople(); sheet = RoomsSheet.PEOPLE }, { sheet = RoomsSheet.INVITE },
            { sheet = null; confirmation = "delete" },
            onOutgoing = { sheet = RoomsSheet.OUTGOING })
        RoomsSheet.INVITE -> if (room?.canInvite == true) RoomInviteSheet(room, state, closeSheet, { sheet = RoomsSheet.OUTGOING })
        RoomsSheet.PEOPLE -> if (room?.canSeeMembers == true) RoomSheet("People in ${room.name}", closeSheet) {
            RoomPeopleContent(room, state, openProfile, onlineMemberIds = activity.onlineMemberIds)
        }
        RoomsSheet.OUTGOING -> if (room?.isMember == true)
            RoomOutgoingInvitationsSheet(room, community, closeSheet, openProfile)
        RoomsSheet.POST -> if (room?.isStaff == true && community.available && managedPost != null)
            RoomPublishedPostManagementSheet(room, community, managedPost!!, closeSheet, openMessage) {
                state.confirmedPostRemoval(room.id, it)
            }
        RoomsSheet.MEMBERSHIP -> if (room != null)
            RoomMembershipQuestionsSheet(room, community, closeSheet, membershipAction) { refreshMembership() }
        null -> Unit
    }
    if (confirmation != null && room != null) RoomDestructiveConfirmation(room, state,
        confirmation == "delete", { confirmation = null })
}

@Composable
private fun RoomsLanding(state: RoomsState, listState: LazyListState, onCreate: () -> Unit, onAccept: (NativeRoomInvitation) -> Unit) {
    RoomsTabs(state.tab, state.invitations.size) { state.tab = it }
    val loading = when (state.tab) { RoomsTab.DISCOVER -> state.discoverLoading
        RoomsTab.YOURS -> state.yoursLoading; RoomsTab.INVITES -> state.invitesLoading }
    val error = when (state.tab) { RoomsTab.DISCOVER -> state.discoverError
        RoomsTab.YOURS -> state.yoursError; RoomsTab.INVITES -> state.invitesError }
    val source = if (state.tab == RoomsTab.YOURS) state.yours else state.discover
    val query = state.search.trim()
    val changingQuery = state.tab == RoomsTab.DISCOVER && state.discoveryQuery != query
    val rooms = when (state.tab) {
        RoomsTab.INVITES -> emptyList()
        RoomsTab.DISCOVER -> if (changingQuery) emptyList() else source
        RoomsTab.YOURS -> source.filter {
            query.isBlank() || it.name.contains(query, true) || it.description.contains(query, true) || it.slug.contains(query, true)
        }
    }
    LaunchedEffect(state.tab, query) {
        if (state.tab == RoomsTab.DISCOVER && changingQuery) {
            delay(300)
            state.loadDiscover()
        }
    }
    if (state.tab != RoomsTab.INVITES) {
        RoomSearchField(state.search, { state.search = it.take(200) }, "Search Rooms",
            Modifier.padding(horizontal = 14.dp, vertical = 8.dp))
    }
    LazyColumn(state = listState, modifier = Modifier.fillMaxWidth(), contentPadding = PaddingValues(bottom = 18.dp)) {
        if (state.openError != null) item { RoomNotice(state.openError.orEmpty(), true) }
        if (state.notice != null && state.openError == null) item { RoomNotice(state.notice.orEmpty()) }
        if (state.tab == RoomsTab.DISCOVER) item {
            Box(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp)) {
                RoomSelectField("Category", state.category ?: "all",
                    listOf("all" to "All categories") + NativeRoomRules.categories.toList()) {
                    state.category = it.takeUnless { value -> value == "all" }; state.loadDiscover()
                }
            }
        }
        if (error != null && !changingQuery) item { RoomNotice(error, true, state::loadLanding) }
        if (state.tab == RoomsTab.INVITES) {
            items(state.invitations, key = { it.room.id }) { invitation ->
                RoomInvitationCard(state, invitation, { onAccept(invitation) })
            }
            if (!loading && error == null && state.invitations.isEmpty()) item {
                RoomEmpty("No invitations yet", "Invitations from your communities will appear here.", Icons.Rounded.MailOutline)
            }
        } else {
            items(rooms, key = { it.id }) { room -> RoomCard(state.auth, room) { state.openRoom(room) } }
            if (!loading && !changingQuery && error == null && rooms.isEmpty()) item {
                RoomEmpty(if (query.isNotBlank()) "No matching Rooms here" else if (state.tab == RoomsTab.YOURS) "Find your first Room" else "No Rooms here yet",
                    if (query.isNotBlank()) "Try another name or category." else "Find a community that interests you.",
                    actionLabel = if (query.isNotBlank()) null else if (state.tab == RoomsTab.YOURS) "Discover Rooms" else "Create Room",
                    onAction = if (state.tab == RoomsTab.YOURS) ({ state.tab = RoomsTab.DISCOVER }) else onCreate)
            }
            if (state.tab == RoomsTab.DISCOVER && !changingQuery && state.discoverMore) item {
                OutlinedButton(onClick = { state.loadDiscover(true) }, enabled = !loading,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) { Text("Load more Rooms") }
            }
        }
        if (loading || changingQuery) items(if (rooms.isEmpty()) 3 else 1) { RoomCardSkeleton() }
    }
}

@Composable
private fun RoomInvitationCard(state: RoomsState, invitation: NativeRoomInvitation, onAccept: () -> Unit) {
    Column(Modifier.padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        RoomCard(state.auth, invitation.room) { state.openRoom(invitation.room) }
        Text("Invited by ${invitation.invitedByName}", style = MaterialTheme.typography.bodySmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onAccept, enabled = !state.busy("invite:${invitation.room.id}"),
                modifier = Modifier.weight(1f)) { RoomActionLabel("Accept", Icons.Rounded.Check) }
            OutlinedButton(onClick = { state.respond(invitation, false) }, enabled = !state.busy("invite:${invitation.room.id}"),
                modifier = Modifier.weight(1f)) { RoomActionLabel("Decline", Icons.Rounded.Close) }
        }
        if (state.roomError != null) RoomNotice(state.roomError.orEmpty(), true)
    }
}

@Composable
private fun ColumnScope.RoomDetail(state: RoomsState, community: RoomManagementState, room: NativeRoom,
    activity: RoomChatActivity, listState: LazyListState,
    onOpenProfile: (String) -> Unit, onOpenMessage: (String) -> Unit,
    jumpTarget: String?, onJumpHandled: (String) -> Unit, onBack: () -> Unit,
    onEdit: () -> Unit, onManage: () -> Unit, onInvite: () -> Unit, onLeave: () -> Unit,
    onMembership: (String) -> Unit, onManagePost: (NativeRoomPost) -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val scope = rememberCoroutineScope()
    var searching by remember(room.id) { mutableStateOf(false) }
    var query by remember(room.id) { mutableStateOf("") }
    var highlighted by remember(room.id) { mutableStateOf<String?>(null) }
    var replyTo by remember(room.id, room.canPost) { mutableStateOf<NativeRoomPost?>(null) }
    val discussion = state.roomTab == RoomTab.DISCUSSION
    val searchTerm = query.trim().takeIf { searching && room.canReadPosts }.orEmpty()
    val searchListState = rememberLazyListState()
    LaunchedEffect(room.id, state.posts.firstOrNull()?.id, discussion, searching) {
        if (discussion && jumpTarget == null && highlighted == null && !searching && listState.firstVisibleItemIndex <= 1) listState.requestScrollToItem(0)
    }
    LaunchedEffect(room.id, jumpTarget, discussion) {
        val target = jumpTarget ?: return@LaunchedEffect
        if (!discussion) return@LaunchedEffect
        searching = false
        query = ""
        val index = state.findMessageInTimeline(target)
        if (index != null) {
            highlighted = target
            listState.requestScrollToItem(index)
        }
        onJumpHandled(target)
    }
    LaunchedEffect(highlighted) {
        if (highlighted != null) {
            delay(1800)
            highlighted = null
        }
    }
    LaunchedEffect(room.id, searchTerm) {
        if (searchTerm.isNotEmpty()) delay(300)
        state.loadPostSearch(searchTerm)
        if (searchTerm.isNotEmpty()) searchListState.scrollToItem(0)
    }
    LaunchedEffect(state, room.id, room.canReadPosts, discussion, lifecycle) {
        if (room.canReadPosts && discussion) lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (isActive && state.selected?.id == room.id) {
                delay(12_000)
                state.refreshLatestPosts()
            }
        }
    }
    fun share(url: String, title: String) {
        runCatching { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, url)
        }, title)) }.onFailure { state.reportError("No sharing app is available.") }
    }
    BackHandler(!discussion || searching || replyTo != null) {
        when {
            searching -> { searching = false; query = "" }
            !discussion -> state.selectRoomTab(RoomTab.DISCUSSION)
            else -> replyTo = null
        }
    }
    fun showSection(tab: RoomTab) {
        searching = false
        query = ""
        state.selectRoomTab(tab)
    }

    if (discussion) RoomGroupHeader(state.auth, room, status = activity.label(room.memberCount), onBack = {
        when {
            searching -> { searching = false; query = "" }
            !discussion -> state.selectRoomTab(RoomTab.DISCUSSION)
            else -> onBack()
        }
    }, onInfo = { showSection(if (room.canSeeMembers) RoomTab.PEOPLE else RoomTab.ABOUT) },
        onRefresh = { state.refreshRoom(); community.open(room, force = true) },
        onSearch = if (discussion && room.canReadPosts) ({ searching = !searching; query = "" }) else null,
        onManage = onManage.takeIf { room.isStaff },
        onMembers = if (room.canSeeMembers) ({ showSection(RoomTab.PEOPLE) }) else null,
        membersLabel = if (room.adminsOnlyRoster) "Admins" else "Members",
        onMedia = if (room.canReadPosts) ({ showSection(RoomTab.MEDIA) }) else null)

    if (!discussion) RoomInfoTopBar(onBack = { showSection(RoomTab.DISCUSSION) },
        onEdit = onEdit.takeIf { room.canManageSettings }, onManage = onManage.takeIf { room.isStaff })
    if (searching) {
        RoomSearchField(query, { query = it.take(200) }, "Search this discussion",
            Modifier.padding(horizontal = 12.dp, vertical = 6.dp), requestFocus = true)
        state.searchPostsError?.takeIf { state.postSearchQuery == searchTerm }?.let { failure ->
            RoomNotice(failure, true, { state.loadPostSearch(searchTerm) })
        }
    }

    val featured = community.pinnedPosts
    if (discussion && room.canReadPosts && featured.isNotEmpty() && !searching) {
        RoomPinnedStrip(featured.first(), featured.size, onOpenMessage)
    }

    val error = state.roomError ?: community.membershipError
    val notice = state.notice ?: community.notice
    if (error != null || notice != null) {
        val message = error ?: notice.orEmpty()
        var dismissed by remember(room.id, message) { mutableStateOf(false) }
        if (!dismissed) Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh) {
            Row(Modifier.fillMaxWidth().padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(message, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall,
                    color = if (error != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
                if (error != null) TextButton(onClick = state::refreshRoom) { Text("Retry") }
                IconButton(onClick = { dismissed = true }) { Icon(Icons.Rounded.Close, "Dismiss status") }
            }
        }
    }

    when (state.roomTab) {
        RoomTab.DISCUSSION -> {
            val hasSearch = searchTerm.isNotBlank()
            val changingSearch = hasSearch && state.postSearchQuery != searchTerm
            val rows = when {
                changingSearch -> emptyList()
                hasSearch -> state.searchPosts
                else -> state.posts
            }
            val loading = if (hasSearch) changingSearch || state.searchPostsLoading else state.postsLoading
            val hasMore = if (hasSearch) !changingSearch && state.searchPostsMore else state.postsMore
            val messagesState = if (hasSearch) searchListState else listState
            Box(Modifier.weight(1f).fillMaxWidth()) {
                RoomWallpaper()
                LazyColumn(state = messagesState, modifier = Modifier.fillMaxSize(), reverseLayout = discussion,
                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 10.dp)) {
                    if (!room.canReadPosts) {
                        item { RoomEmpty("Join the conversation", "Join this Room to read its discussion and media.") }
                    } else {
                        items(rows.size, key = { rows[it].id }) { index ->
                            val post = rows[index]
                            val day = roomPostDay(post.createdAt)
                            val previous = rows.getOrNull(index + 1)
                            val next = rows.getOrNull(index - 1)
                            val grouped = previous?.authorId == post.authorId && roomPostDay(previous.createdAt) == day
                            val startOfDay = day != roomPostDay((if (discussion) previous else next)?.createdAt.orEmpty())
                            val endOfGroup = next?.authorId != post.authorId || roomPostDay(next.createdAt) != day
                            Column {
                                if (day != null && startOfDay) RoomDayMarker(day)
                                RoomPostCard(state.auth, post, state.postUi(post.id), post.authorId == state.accountId, grouped,
                                    onOpenProfile = { onOpenProfile(post.authorHandle) },
                                    onLike = { only -> state.reactToMessage(post, only) },
                                    onRetry = { state.retryActions(post.id) },
                                    onJumpToReply = onOpenMessage,
                                    highlighted = highlighted == post.id,
                                    onManagePost = if (room.isStaff && community.available) ({ onManagePost(post) }) else null,
                                    endOfGroup = endOfGroup,
                                    onReply = if (discussion && room.canPost) ({
                                        searching = false
                                        query = ""
                                        replyTo = post
                                    }) else null)
                            }
                        }
                        if (loading) item { SautiPostSkeleton() }
                        if (!loading && rows.isEmpty() && state.roomError == null && (!hasSearch || state.searchPostsError == null)) item {
                            RoomEmpty(when {
                                query.isNotBlank() -> "No matching messages"
                                discussion -> "Start a conversation"
                                else -> "No media yet"
                            }, when {
                                query.isNotBlank() -> "Try another search."
                                else -> "Messages from this Room will appear here."
                            })
                        }
                        if (hasMore) item {
                            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                                FilledTonalButton(onClick = {
                                    if (hasSearch) state.loadPostSearch(searchTerm, append = true) else state.loadPosts(true)
                                }, enabled = !loading) {
                                    Text(if (hasSearch) "More results" else "Load earlier messages")
                                }
                            }
                        }
                    }
                }
                if ((listState.firstVisibleItemIndex > 2 || state.hasNewerHistory) && !searching) {
                    SmallFloatingActionButton(onClick = {
                        if (state.hasNewerHistory) state.loadPosts()
                        scope.launch { listState.animateScrollToItem(0) }
                    },
                        modifier = Modifier.align(Alignment.BottomEnd).padding(end = 12.dp, bottom = 12.dp),
                        shape = androidx.compose.foundation.shape.CircleShape) {
                        Icon(Icons.Rounded.KeyboardArrowDown, "Jump to latest")
                    }
                }
            }
            if (!room.isMember) Column(Modifier.fillMaxWidth().padding(12.dp)) {
                RoomMembershipActions(state, room, community.joining(room), onMembership)
            }
            if (discussion && room.canPost && !searching) {
                val replying = replyTo
                RoomInlineComposer(room, state, replyTo = replying, onCloseReply = {
                    if (replyTo?.id == replying?.id) replyTo = null
                }) {
                    scope.launch { listState.scrollToItem(0) }
                }
            }
            else if (discussion && room.isMember && !room.canPost) {
                Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
                    Text("Only admins and moderators can send messages", Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                        style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        RoomTab.ABOUT, RoomTab.PEOPLE, RoomTab.MEDIA, RoomTab.LINKS -> LazyColumn(state = listState, modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item {
                RoomInfoOverview(state.auth, room, activity, onMessage = { showSection(RoomTab.DISCUSSION) },
                    onInvite = onInvite.takeIf { room.canInvite }, onLeave = onLeave.takeIf { room.isMember && !room.isOwner },
                    onShare = { share("${state.auth.backend.siteOrigin}/rooms/${room.slug}", "Share Room link") })
            }
            if (!room.isMember) item { RoomMembershipActions(state, room, community.joining(room), onMembership) }
            if (room.canSeeMembers || room.canReadPosts) item {
                RoomInfoTabs(state.roomTab, state::selectRoomTab, room.canSeeMembers, room.canReadPosts, room.adminsOnlyRoster)
            }
            when (state.roomTab) {
                RoomTab.PEOPLE -> if (room.canSeeMembers) item {
                    Surface(color = MaterialTheme.colorScheme.surfaceContainerLow, shape = RoundedCornerShape(20.dp)) {
                        RoomPeopleContent(room, state, onOpenProfile, onlineMemberIds = activity.onlineMemberIds)
                    }
                }
                RoomTab.MEDIA -> if (room.canReadPosts) {
                    val mediaMessages = state.posts.filter { it.media.isNotEmpty() }
                    items(mediaMessages, key = { it.id }) { post ->
                        RoomPostCard(state.auth, post, state.postUi(post.id), post.authorId == state.accountId,
                            grouped = false, onOpenProfile = { onOpenProfile(post.authorHandle) },
                            onLike = { state.reactToMessage(post, it) }, onRetry = { state.retryActions(post.id) },
                            onJumpToReply = onOpenMessage)
                    }
                    if (mediaMessages.isEmpty() && !state.postsLoading) item {
                        RoomEmpty("No shared media in these messages", "Photos and videos sent to this group appear here.",
                            Icons.Rounded.PhotoLibrary)
                    }
                    if (state.postsMore || state.postsLoading) item {
                        TextButton(onClick = { state.loadPosts(append = true) }, enabled = !state.postsLoading) {
                            Text(if (state.postsLoading) "Loading…" else "Look through earlier messages")
                        }
                    }
                }
                RoomTab.LINKS -> if (room.canReadPosts) {
                    val links = state.posts.flatMap { post -> roomMessageLinks(post).map { post to it } }
                    items(links, key = { (post, url) -> "${post.id}:$url" }) { (post, url) ->
                        Surface(onClick = { onOpenMessage(post.id) }, shape = RoundedCornerShape(16.dp),
                            color = MaterialTheme.colorScheme.surfaceContainerLow) {
                            ListItem(headlineContent = { Text(url, maxLines = 2,
                                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis) },
                                supportingContent = { Text(post.authorName) },
                                leadingContent = { Icon(Icons.Rounded.Link, null) },
                                trailingContent = { Icon(Icons.Rounded.ChevronRight, null) },
                                colors = ListItemDefaults.colors(containerColor = androidx.compose.ui.graphics.Color.Transparent))
                        }
                    }
                    if (links.isEmpty() && !state.postsLoading) item {
                        RoomEmpty("No shared links in these messages", "Links shared in this group appear here.",
                            Icons.Rounded.Link)
                    }
                    if (state.postsMore || state.postsLoading) item {
                        TextButton(onClick = { state.loadPosts(append = true) }, enabled = !state.postsLoading) {
                            Text(if (state.postsLoading) "Loading…" else "Look through earlier messages")
                        }
                    }
                }
                else -> Unit
            }
        }
    }
}

@Composable
private fun RoomMembershipActions(state: RoomsState, room: NativeRoom, joining: Boolean,
    onMembership: (String) -> Unit) {
    when {
        state.invitations.any { it.room.id == room.id } -> {
            Button(onClick = { onMembership("accept_invitation") },
                enabled = !state.busy("invite:${room.id}") && !joining) { Text("Accept invitation") }
        }
        room.requestStatus == "pending" -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = {}, enabled = false) { Text("Request pending") }
            TextButton(onClick = { state.mutate("join", room, { state.client.cancelJoinRequest(room) }) },
                enabled = !state.busy("join")) { Text("Cancel request") }
        }
        room.policy == "open" -> Button(onClick = { onMembership("join") },
            enabled = !state.busy("join") && !joining) { Text(if (state.busy("join") || joining) "Joining…" else "Join Room") }
        room.policy == "approval" -> Button(onClick = { onMembership("request") },
            enabled = !state.busy("join") && !joining) { Text(if (state.busy("join") || joining) "Requesting…" else "Request to join") }
        else -> RoomNotice("An invitation is needed to join this Room.")
    }
}

@Composable
private fun RoomDestructiveConfirmation(room: NativeRoom, state: RoomsState, delete: Boolean, onDismiss: () -> Unit) {
    AlertDialog(onDismissRequest = onDismiss, title = { Text(if (delete) "Delete ${room.name}?" else "Leave ${room.name}?") },
        text = { Text(if (delete) "This permanently removes the Room, its posts and membership."
            else "You will lose member access to this Room.") },
        confirmButton = { TextButton(onClick = {
            onDismiss(); state.mutate(if (delete) "delete" else "leave", room,
                { if (delete) state.client.delete(room) else state.client.leave(room) }, { state.closeRoom() })
        }) { Text(if (delete) "Delete Room" else "Leave Room", color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } })
}
