package com.sautilink.nativeapp.feature.rooms

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.ui.theme.SautiShape
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NativeRoomsScreen(auth: StagingAuthClient, onBack: () -> Unit, onSignIn: () -> Unit,
    onOpenProfile: (String) -> Unit, initialRoomSlug: String? = null) {
    val client = remember(auth) { NativeRoomsClient(auth) }
    val scope = rememberCoroutineScope()
    var rooms by remember { mutableStateOf<List<NativeRoom>>(emptyList()) }
    var selectedId by remember { mutableStateOf<String?>(null) }
    var deepOpened by remember(initialRoomSlug) { mutableStateOf(false) }
    var refresh by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var createOpen by remember { mutableStateOf(false) }
    var confirmLeave by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var posts by remember { mutableStateOf<List<NativeRoomPost>>(emptyList()) }
    var members by remember { mutableStateOf<List<NativeRoomMember>>(emptyList()) }
    var pending by remember { mutableStateOf<List<NativeJoinRequest>>(emptyList()) }
    var draft by remember { mutableStateOf("") }
    val selected = rooms.firstOrNull { it.id == selectedId }
    BackHandler(selectedId != null) { selectedId = null }

    LaunchedEffect(auth.account?.id, refresh) {
        if (auth.account == null) { rooms = emptyList(); selectedId = null; return@LaunchedEffect }
        loading = true; error = null
        try { rooms = client.list() }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) { error = e.message ?: "Could not load Rooms." }
        finally { loading = false }
    }
    LaunchedEffect(initialRoomSlug, rooms) {
        if (!initialRoomSlug.isNullOrBlank() && !deepOpened) {
            rooms.firstOrNull { it.slug == initialRoomSlug }?.let { room ->
                selectedId = room.id; deepOpened = true
            }
        }
    }
    LaunchedEffect(selected?.id, selected?.role, refresh) {
        posts = emptyList(); members = emptyList(); pending = emptyList()
        val room = selected ?: return@LaunchedEffect
        if (!room.isOwner && room.role == null) return@LaunchedEffect
        try {
            posts = client.posts(room)
            if (room.isOwner) {
                members = client.members(room)
                pending = client.pendingRequests(room)
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (e: Exception) { error = e.message ?: "Could not load Room details." }
    }
    fun perform(action: suspend () -> Unit) {
        if (busy) return
        busy = true; error = null
        scope.launch {
            try { action(); refresh++ }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { error = e.message ?: "Room action failed." }
            finally { busy = false }
        }
    }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { if (selectedId != null) selectedId = null else onBack() }) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back")
            }
            Text(selected?.name ?: "Rooms", style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.weight(1f))
            IconButton(onClick = { refresh++ }, enabled = !loading && !busy) {
                Icon(Icons.Rounded.Refresh, "Refresh Rooms")
            }
            if (selected == null && auth.account != null) IconButton(onClick = { createOpen = true }) {
                Icon(Icons.Rounded.Add, "Create Room")
            }
        }
        if (loading || busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (error != null) Text(error.orEmpty(), Modifier.padding(16.dp), color = MaterialTheme.colorScheme.error)
        if (auth.account == null) {
            Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Sign in to see SautiLink Rooms.")
                Spacer(Modifier.height(12.dp))
                Button(onClick = onSignIn) { Text("Sign in") }
            }
        } else if (selected == null) {
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (!loading && rooms.isEmpty()) item { Text("No Rooms available yet.") }
                items(rooms, key = { it.id }) { room ->
                    Surface(Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.surfaceContainer,
                        shape = SautiShape.Card) {
                        Column(Modifier.fillMaxWidth().clickable { selectedId = room.id }.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(room.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                            Text("/rooms/${room.slug} · ${room.policy.replaceFirstChar { it.uppercase() }}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                            if (room.description.isNotBlank()) Text(room.description, maxLines = 3)
                            Text(when {
                                room.isOwner -> "Owner"
                                room.role != null -> "Joined"
                                room.requestStatus == "pending" -> "Request pending"
                                room.policy == "open" -> "Open to join"
                                room.policy == "approval" -> "Approval required"
                                else -> "Private Room"
                            }, color = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
            }
        } else {
            val room = selected
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item {
                    Surface(color = MaterialTheme.colorScheme.surfaceContainer, shape = SautiShape.Card) {
                        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("/rooms/${room.slug} · ${room.policy}",
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(room.description.ifBlank { "No description yet." })
                            Text(when {
                                room.isOwner -> "You own this Room"
                                room.role != null -> "You joined this Room"
                                room.requestStatus == "pending" -> "Join request pending"
                                else -> "You are not a member"
                            }, style = MaterialTheme.typography.bodySmall)
                            when {
                                room.isOwner -> OutlinedButton(onClick = { confirmDelete = true }, enabled = !busy) {
                                    Text("Delete Room")
                                }
                                room.role != null -> OutlinedButton(onClick = { confirmLeave = true }, enabled = !busy) {
                                    Text("Leave Room")
                                }
                                room.policy == "open" -> Button(onClick = { perform { client.join(room) } }, enabled = !busy) {
                                    Text("Join Room")
                                }
                                room.policy == "approval" && room.requestStatus != "pending" ->
                                    Button(onClick = { perform { client.requestJoin(room) } }, enabled = !busy) {
                                        Text(if (room.requestStatus == "declined") "Request again" else "Request to join")
                                    }
                            }
                        }
                    }
                }
                if (room.isOwner) {
                    item { Text("Members (${members.size})", style = MaterialTheme.typography.titleLarge) }
                    items(members, key = { "member:${it.id}" }) { member ->
                        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            Text(member.name, modifier = Modifier.weight(1f).clickable(enabled = member.handle.isNotBlank()) {
                                onOpenProfile(member.handle)
                            })
                            Text(member.role, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    if (pending.isNotEmpty()) item { Text("Join requests", style = MaterialTheme.typography.titleLarge) }
                    items(pending, key = { "request:${it.requesterId}" }) { request ->
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text(request.name, modifier = Modifier.weight(1f))
                            TextButton(onClick = { perform { client.decide(room, request.requesterId, true) } }, enabled = !busy) {
                                Text("Approve")
                            }
                            TextButton(onClick = { perform { client.decide(room, request.requesterId, false) } }, enabled = !busy) {
                                Text("Decline")
                            }
                        }
                    }
                }
                if (room.isOwner || room.role != null) {
                    item { Text("Room posts", style = MaterialTheme.typography.titleLarge) }
                    item {
                        Surface(color = MaterialTheme.colorScheme.surfaceContainer, shape = SautiShape.Card) {
                            Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedTextField(draft, { draft = it.take(501) }, label = { Text("Write in this Room") },
                                    supportingText = { Text("${draft.length}/500") }, minLines = 2,
                                    modifier = Modifier.fillMaxWidth())
                                Button(onClick = { perform { client.publish(room, draft); draft = "" } },
                                    enabled = !busy && draft.trim().isNotEmpty() && draft.trim().length <= 500) {
                                    Text("Post to Room")
                                }
                            }
                        }
                    }
                    if (posts.isEmpty() && !loading) item { Text("No Room posts yet.") }
                    items(posts, key = { "post:${it.id}" }) { post ->
                        Surface(Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.surfaceContainer,
                            shape = SautiShape.Card) {
                            Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(post.authorName, fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.clickable(enabled = post.authorHandle.isNotBlank()) {
                                        onOpenProfile(post.authorHandle)
                                    })
                                Text(post.body)
                                Text(post.createdAt.take(10), color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                } else item {
                    Text(if (room.policy == "approval") "Approved members can read and post in this Room."
                        else "Join to read and post in this Room.")
                }
            }
        }
    }
    if (createOpen) {
        var name by remember { mutableStateOf("") }
        var slug by remember { mutableStateOf("") }
        var description by remember { mutableStateOf("") }
        var policy by remember { mutableStateOf("open") }
        ModalBottomSheet(onDismissRequest = { createOpen = false }, shape = SautiShape.Sheet,
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Create Room", style = MaterialTheme.typography.titleLarge)
                OutlinedTextField(name, { name = it.take(81) }, label = { Text("Name") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(slug, { slug = it.lowercase().filter { ch -> ch.isLetterOrDigit() || ch == '-' }.take(50) },
                    label = { Text("Address · lowercase, numbers, hyphens") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(description, { description = it.take(1001) }, label = { Text("Description") },
                    modifier = Modifier.fillMaxWidth(), minLines = 2)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("open", "approval", "private").forEach { option ->
                        FilterChip(selected = policy == option, onClick = { policy = option },
                            label = { Text(option.replaceFirstChar { it.uppercase() }) })
                    }
                }
                Button(onClick = { perform {
                    val created = client.create(name, slug, description, policy)
                    createOpen = false; selectedId = created.id
                } }, enabled = !busy && name.trim().isNotEmpty() && slug.length >= 3,
                    modifier = Modifier.fillMaxWidth()) { Text("Create Room") }
            }
        }
    }
    if (confirmLeave && selected != null) AlertDialog(onDismissRequest = { confirmLeave = false },
        title = { Text("Leave Room?") }, text = { Text("You will lose access to member posts.") },
        confirmButton = { TextButton(onClick = { confirmLeave = false; perform { client.leave(selected) } }) { Text("Leave") } },
        dismissButton = { TextButton(onClick = { confirmLeave = false }) { Text("Cancel") } })
    if (confirmDelete && selected != null) AlertDialog(onDismissRequest = { confirmDelete = false },
        title = { Text("Delete Room?") }, text = { Text("All Room posts and membership will be removed. This cannot be undone.") },
        confirmButton = { TextButton(onClick = { confirmDelete = false; perform { client.delete(selected); selectedId = null } }) {
            Text("Delete")
        } }, dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } })
}
