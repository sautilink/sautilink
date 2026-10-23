package com.sautilink.nativeapp.feature.rooms

import android.content.Context
import android.net.Uri
import androidx.compose.runtime.*
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.PostInteractionsClient
import com.sautilink.nativeapp.feature.home.StagingFeedClient
import com.sautilink.nativeapp.feature.posts.NativeMediaClient
import com.sautilink.nativeapp.feature.posts.NativeReadyMedia
import kotlinx.coroutines.*
import java.util.UUID

internal class RoomDraft {
    var editor by mutableStateOf(TextFieldValue(""))
    var media by mutableStateOf<List<RoomDraftMedia>>(emptyList())
    var replyAccess by mutableStateOf("everyone")
    var error by mutableStateOf<String?>(null)
    var attemptSnapshot: RoomPublishSnapshot? = null
    var attemptId: String? = null
    val uploading get() = media.any { it.status == "Preparing" || it.status == "Uploading" }
}

internal data class RoomPublishSnapshot(val body: String, val replyAccess: String, val media: List<NativeReadyMedia>)

internal data class RoomDraftMedia(val localId: String, val label: String, val kind: String = "image",
    val status: String = "Preparing", val progress: Int = 0,
    val ready: NativeReadyMedia? = null, val alt: String = "", val error: String? = null)

private data class RoomNavigationBookmark(val roomId: String, val role: String?, val privacy: String, val tab: RoomTab) {
    fun matches(room: NativeRoom) = roomId == room.id && role == room.role && privacy == room.privacy
}

/** Only the viewer's drafts/navigation survive a Profile round trip; server content is re-read. */
private object RoomsMemory {
    private var account: String? = null
    val drafts = mutableMapOf<String, RoomDraft>()
    var slug: String? = null
    var returningFromProfile = false
    var profileEntrySlug: String? = null
    var profilePostId: String? = null
    var navigation: RoomNavigationBookmark? = null
    fun account(value: String?) {
        if (account != value) {
            drafts.clear(); slug = null; returningFromProfile = false; profileEntrySlug = null; profilePostId = null
            navigation = null; account = value
        }
    }
}

internal data class RoomReturnContext(val slug: String?, val postId: String? = null)

/** Screen-owned state: account/room guards prevent late reads and ACKs updating another context. */
internal class RoomsState(val auth: StagingAuthClient, val accountId: String?, private val context: Context,
    parentScope: CoroutineScope) {
    val client = NativeRoomsClient(auth)
    val interactions = PostInteractionsClient(auth)
    private val mediaClient = NativeMediaClient(auth, context.applicationContext)
    private val coverClient = NativeRoomCoverClient(context.applicationContext, auth)
    private val lifetime = SupervisorJob(parentScope.coroutineContext[Job])
    private val scope = CoroutineScope(parentScope.coroutineContext + lifetime)
    private var discoveryJob: Job? = null
    private var yoursJob: Job? = null
    private var invitesJob: Job? = null
    private var capabilityJob: Job? = null
    private var postsJob: Job? = null
    private var peopleJob: Job? = null
    private var queueJob: Job? = null
    private var discoveryVersion = 0
    private var yoursVersion = 0
    private var invitesVersion = 0
    private var capabilityVersion = 0
    private var postsVersion = 0
    private var peopleVersion = 0
    private var queueVersion = 0
    private val busyKeys = mutableStateMapOf<String, Boolean>()
    private val versions = mutableMapOf<String, Int>()
    private val actionStates = mutableStateMapOf<String, Boolean>()
    private val actionErrors = mutableStateMapOf<String, String>()
    private val drafts: MutableMap<String, RoomDraft> = RoomsMemory.run { account(accountId); this.drafts }
    private val decisionIds = mutableMapOf<String, String>()
    private var navigationVersion = 0
    private var metadataVersion = 0
    private var peopleRequested = false
    private var landingRequested = false
    var tab by mutableStateOf(RoomsTab.DISCOVER)
    var roomTab by mutableStateOf(RoomTab.DISCUSSION); private set
    var search by mutableStateOf("")
    var category by mutableStateOf<String?>(null)
    var approvalAvailable by mutableStateOf(false); private set
    var discover by mutableStateOf<List<NativeRoom>>(emptyList()); private set
    var yours by mutableStateOf<List<NativeRoom>>(emptyList()); private set
    var invitations by mutableStateOf<List<NativeRoomInvitation>>(emptyList()); private set
    var discoverLoading by mutableStateOf(false); private set
    var yoursLoading by mutableStateOf(false); private set
    var invitesLoading by mutableStateOf(false); private set
    var discoverMore by mutableStateOf(false); private set
    var discoverError by mutableStateOf<String?>(null); private set
    var yoursError by mutableStateOf<String?>(null); private set
    var invitesError by mutableStateOf<String?>(null); private set
    var selected by mutableStateOf<NativeRoom?>(null); private set
    var openingSlug by mutableStateOf(false); private set
    var openError by mutableStateOf<String?>(null); private set
    var roomError by mutableStateOf<String?>(null); private set
    var notice by mutableStateOf<String?>(null); private set
    var posts by mutableStateOf<List<NativeRoomPost>>(emptyList()); private set
    var postsLoading by mutableStateOf(false); private set
    var postsMore by mutableStateOf(false); private set
    var members by mutableStateOf<List<NativeRoomMember>>(emptyList()); private set
    var peopleLoading by mutableStateOf(false); private set
    var requests by mutableStateOf<List<NativeJoinRequest>>(emptyList()); private set
    var peopleError by mutableStateOf<String?>(null); private set
    var membersMore by mutableStateOf(false); private set
    var requestsMore by mutableStateOf(false); private set
    var submissions by mutableStateOf<List<NativeRoomSubmission>>(emptyList()); private set
    var submissionsLoading by mutableStateOf(false); private set
    var submissionError by mutableStateOf<String?>(null); private set
    var submissionsCursor by mutableStateOf<String?>(null); private set
    var submissionFilter by mutableStateOf("pending")
    private var submissionRetry: (() -> Unit)? by mutableStateOf(null)
    val canRetrySubmission get() = submissionRetry != null
    fun retrySubmission() { submissionRetry?.invoke() }

    fun dispose() {
        drafts.values.forEach { draft ->
            draft.editor = draft.editor.copy(composition = null)
            draft.media = draft.media.map { item ->
                if (item.status in setOf("Preparing", "Uploading")) item.copy(status = "Interrupted", error = "Upload interrupted. Remove and select again.") else item
            }
        }
        lifetime.cancel()
    }
    private fun current() = accountId != null && auth.account?.id == accountId
    private fun current(roomId: String) = current() && selected?.id == roomId
    private fun readCurrent(room: NativeRoom) = current(room.id) && selected?.role == room.role && selected?.privacy == room.privacy
    fun busy(key: String) = busyKeys[key] == true
    fun draft(room: NativeRoom): RoomDraft = drafts.getOrPut(room.id) { RoomDraft() }
    fun reportError(message: String) { if (current()) roomError = message }
    fun rememberProfileReturn(entrySlug: String?, postId: String?) {
        RoomsMemory.returningFromProfile = true; RoomsMemory.profileEntrySlug = entrySlug; RoomsMemory.profilePostId = postId
    }
    fun restoreEntry(entrySlug: String?): RoomReturnContext {
        val profile = RoomsMemory.returningFromProfile && RoomsMemory.profileEntrySlug == entrySlug
        RoomsMemory.returningFromProfile = false
        return RoomReturnContext(if (profile) RoomsMemory.slug ?: entrySlug else entrySlug ?: RoomsMemory.slug,
            if (profile) RoomsMemory.profilePostId else null)
    }

    fun loadLanding() {
        if (!current()) return
        landingRequested = true
        capabilityJob?.cancel()
        val capability = ++capabilityVersion
        capabilityJob = scope.launch {
            try { val value = client.capabilities(); if (current() && capability == capabilityVersion) approvalAvailable = value.postApproval }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { if (current() && capability == capabilityVersion) approvalAvailable = false }
        }
        loadDiscover()
        yoursJob?.cancel()
        val ownRevision = ++yoursVersion
        yoursJob = scope.launch {
            yoursLoading = true; yoursError = null
            try { val result = client.yourRooms(); if (current() && ownRevision == yoursVersion) yours = result }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { if (current() && ownRevision == yoursVersion) yoursError = e.message ?: "Could not load your Rooms." }
            finally { if (current() && ownRevision == yoursVersion) yoursLoading = false }
        }
        invitesJob?.cancel()
        val inviteRevision = ++invitesVersion
        invitesJob = scope.launch {
            invitesLoading = true; invitesError = null
            try { val result = client.invitations(); if (current() && inviteRevision == invitesVersion) invitations = result }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { if (current() && inviteRevision == invitesVersion) invitesError = e.message ?: "Could not load invitations." }
            finally { if (current() && inviteRevision == invitesVersion) invitesLoading = false }
        }
    }

    fun loadDiscover(append: Boolean = false) {
        if (!current() || append && discoverLoading) return
        discoveryJob?.cancel()
        val filter = category
        val offset = if (append) discover.size else 0
        val revision = ++discoveryVersion
        discoveryJob = scope.launch {
            discoverLoading = true; discoverError = null
            try {
                val result = client.list(offset, filter)
                if (current() && category == filter && revision == discoveryVersion) {
                    discover = (if (append) discover + result else result).distinctBy { it.id }
                    discoverMore = result.size == 60
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { if (current() && category == filter && revision == discoveryVersion) discoverError = e.message ?: "Could not discover Rooms." }
            finally { if (current() && category == filter && revision == discoveryVersion) discoverLoading = false }
        }
    }

    fun openSlug(slug: String) {
        if (!current()) return
        val navigation = ++navigationVersion
        scope.launch {
            openingSlug = true; openError = null
            try {
                val result = client.findBySlug(slug)
                if (current() && navigation == navigationVersion) {
                    if (result == null) openError = "This Room is unavailable or you no longer have access."
                    else select(result, restoreNavigation = true)
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { if (current() && navigation == navigationVersion) openError = e.message ?: "Could not open Room." }
            finally { if (current() && navigation == navigationVersion) {
                openingSlug = false
                if (selected == null && !landingRequested) loadLanding()
            } }
        }
    }

    fun openRoom(room: NativeRoom) { select(room, loadDetails = false); refreshRoom() }

    fun selectRoomTab(tab: RoomTab) {
        val room = selected ?: return
        if (!current(room.id)) return
        roomTab = tab
        RoomsMemory.navigation = RoomNavigationBookmark(room.id, room.role, room.privacy, tab)
        if (tab == RoomTab.PEOPLE) loadPeople()
    }

    fun select(room: NativeRoom, loadDetails: Boolean = true, restoreNavigation: Boolean = false) {
        if (!current()) return
        navigationVersion++; openingSlug = false
        RoomsMemory.slug = room.slug
        if (selected?.id != room.id || selected?.role != room.role || selected?.privacy != room.privacy) {
            posts = emptyList(); members = emptyList(); requests = emptyList(); submissions = emptyList()
            // Restore presentation only after a fresh slug lookup confirms the same viewer context.
            roomTab = RoomsMemory.navigation?.takeIf { restoreNavigation && selected == null && it.matches(room) }
                ?.tab ?: RoomTab.DISCUSSION
            notice = null; roomError = null; peopleError = null
            submissionError = null; submissionsCursor = null
            postsLoading = false; peopleLoading = false; submissionsLoading = false
            membersMore = false; requestsMore = false
            peopleRequested = false
        }
        selected = room
        RoomsMemory.navigation = RoomNavigationBookmark(room.id, room.role, room.privacy, roomTab)
        if (!room.canReadPosts) posts = emptyList()
        if (!room.canSeeMembers) members = emptyList()
        if (!room.canManagePeople) requests = emptyList()
        if (loadDetails) {
            loadPosts()
            if (peopleRequested || roomTab == RoomTab.PEOPLE) loadPeople()
        }
    }

    fun closeRoom() {
        navigationVersion++; metadataVersion++
        postsVersion++; peopleVersion++; queueVersion++
        peopleJob?.cancel(); queueJob?.cancel()
        RoomsMemory.slug = null; RoomsMemory.navigation = null
        postsJob?.cancel(); selected = null; openingSlug = false; openError = null
        posts = emptyList(); members = emptyList(); requests = emptyList(); submissions = emptyList()
        postsLoading = false; peopleLoading = false; submissionsLoading = false
        roomError = null; notice = null
        if (!landingRequested && current()) loadLanding()
    }

    fun refreshRoom() {
        val room = selected ?: return
        val revision = ++metadataVersion
        scope.launch {
            try {
                val result = client.findBySlug(room.slug)
                if (current(room.id) && revision == metadataVersion) {
                    if (result == null) { evictUnavailableRoom(room.id); closeRoom(); openError = "This Room is no longer available." }
                    else { select(result); roomError = null }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { if (current(room.id) && revision == metadataVersion) roomError = e.message ?: "Could not refresh Room." }
        }
    }

    private fun evictUnavailableRoom(roomId: String) {
        // Older landing reads must not restore a Room the canonical lookup just removed.
        discoveryVersion++; yoursVersion++; invitesVersion++
        discoveryJob?.cancel(); yoursJob?.cancel(); invitesJob?.cancel()
        discoverLoading = false; yoursLoading = false; invitesLoading = false
        discover = discover.filterNot { it.id == roomId }
        yours = yours.filterNot { it.id == roomId }
        invitations = invitations.filterNot { it.room.id == roomId }
    }

    fun loadPosts(append: Boolean = false) {
        val room = selected?.takeIf { it.canReadPosts } ?: return
        if (append && postsLoading) return
        postsJob?.cancel()
        val offset = if (append) posts.size else 0
        val actionSnapshot = versions.toMap()
        val revision = ++postsVersion
        postsJob = scope.launch {
            postsLoading = true
            try {
                val result = client.posts(room, offset)
                if (readCurrent(room) && revision == postsVersion) {
                    val known = posts.associateBy { it.id }
                    val guardedRows = result.map { row ->
                        val existing = known[row.id]
                        if (existing == null) row else row.copy(
                            likes = if ((versions["like:${row.id}"] ?: 0) != (actionSnapshot["like:${row.id}"] ?: 0)) existing.likes else row.likes,
                            reposts = if ((versions["repost:${row.id}"] ?: 0) != (actionSnapshot["repost:${row.id}"] ?: 0)) existing.reposts else row.reposts)
                    }
                    posts = (if (append) posts + guardedRows else guardedRows).distinctBy { it.id }
                    postsMore = result.size == 30; roomError = null
                    loadPostActions(result.map { it.id }, room.id)
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { if (readCurrent(room) && revision == postsVersion) roomError = e.message ?: "Could not load Room posts." }
            finally { if (readCurrent(room) && revision == postsVersion) postsLoading = false }
        }
    }

    fun loadPeople(appendMembers: Boolean = false, appendRequests: Boolean = false) {
        val room = selected ?: return
        if (!room.canSeeMembers || (appendMembers || appendRequests) && peopleLoading) return
        peopleRequested = true
        peopleJob?.cancel()
        val revision = ++peopleVersion
        peopleJob = scope.launch {
            peopleLoading = true; peopleError = null
            try {
                val roster = if (appendRequests) null else client.members(room, if (appendMembers) members.size else 0)
                val pending = if (room.canManagePeople && !appendMembers) client.pendingRequests(room, if (appendRequests) requests.size else 0) else null
                if (readCurrent(room) && revision == peopleVersion) {
                    if (roster != null) { members = (if (appendMembers) members + roster else roster).distinctBy { it.id }; membersMore = roster.size == 100 }
                    if (pending != null) { requests = (if (appendRequests) requests + pending else pending).distinctBy { it.requesterId }; requestsMore = pending.size == 100 }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { if (readCurrent(room) && revision == peopleVersion) peopleError = e.message ?: "Could not load people." }
            finally { if (readCurrent(room) && revision == peopleVersion) peopleLoading = false }
        }
    }

    fun mutate(key: String, room: NativeRoom? = selected, action: suspend () -> Unit,
        onSuccess: () -> Unit = {}) {
        if (!current() || busy(key) || room != null && !current(room.id)) return
        busyKeys[key] = true; roomError = null
        scope.launch {
            try {
                if (!current()) return@launch
                action()
                if (current()) {
                    loadLanding()
                    if (room == null || selected?.id == room.id) {
                        onSuccess()
                        if (room != null && selected?.id == room.id) refreshRoom()
                    }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) {
                if (current() && (room == null || selected?.id == room.id)) roomError = e.message ?: "Room action could not be confirmed. Refresh before retrying."
            } finally { busyKeys.remove(key) }
        }
    }

    fun create(settings: NativeRoomSettings, cover: Uri?, onCreated: () -> Unit) {
        if (!current() || busy("create")) return
        busyKeys["create"] = true; roomError = null
        val navigation = navigationVersion
        scope.launch {
            try {
                val created = client.create(settings)
                if (!current()) return@launch
                if (navigation == navigationVersion) {
                    select(created); onCreated()
                    // INSERT RETURNING predates the owner-membership count trigger.
                    // Re-read canonical metadata independently of the confirmed create ACK.
                    refreshRoom()
                }
                loadLanding()
                if (cover != null) {
                    try { coverClient.upload(created, cover); if (current(created.id)) refreshRoom() }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (e: Exception) { if (current(created.id)) roomError = "Room created. ${e.message ?: "Cover upload failed; retry in Manage."}" }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { if (current()) roomError = e.message ?: "Room creation could not be confirmed." }
            finally { busyKeys.remove("create") }
        }
    }

    fun saveSettings(room: NativeRoom, settings: NativeRoomSettings, cover: Uri?, onSaved: () -> Unit) {
        if (!current(room.id) || busy("settings")) return
        busyKeys["settings"] = true; roomError = null
        scope.launch {
            try {
                val updated = client.update(room, settings)
                if (!current()) return@launch
                if (current(room.id)) { select(updated); onSaved() }
                loadLanding()
                if (cover != null) {
                    try { coverClient.upload(updated, cover); if (current(updated.id)) refreshRoom(); loadLanding() }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (e: Exception) { if (current(updated.id)) roomError = "Settings saved. ${e.message ?: "Cover upload failed; try again."}" }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { if (current(room.id)) roomError = e.message ?: "Settings change could not be confirmed." }
            finally { busyKeys.remove("settings") }
        }
    }

    fun cover(room: NativeRoom, uri: Uri?) = mutate("cover", room, {
        if (uri == null) coverClient.remove(room) else coverClient.upload(room, uri)
    })

    fun invite(room: NativeRoom, handle: String, onInvited: () -> Unit) = mutate("invite", room,
        { client.invite(room, handle) }, { notice = "Invitation sent."; onInvited() })

    fun respond(invitation: NativeRoomInvitation, accept: Boolean) = mutate("invite:${invitation.room.id}",
        null, { client.respond(invitation, accept) }, {
            if (selected == null || selected?.id == invitation.room.id)
                notice = if (accept) "Room invitation accepted." else "Invitation declined."
            if (selected?.id == invitation.room.id) refreshRoom()
        })

    fun postUi(postId: String): RoomPostUi {
        val errors = listOf("like", "save", "repost").mapNotNull { actionErrors["$it:$postId"] }
        return RoomPostUi(actionStates["like:$postId"], actionStates["save:$postId"], actionStates["repost:$postId"],
            listOf("like", "save", "repost").filter { busy("$it:$postId") }.toSet(), errors.distinct().joinToString("\n").ifBlank { null })
    }

    fun retryActions(postId: String) { selected?.id?.let { loadPostActions(listOf(postId), it) } }

    fun commentCount(postId: String, delta: Int) {
        if (current()) posts = posts.map { if (it.id == postId) it.copy(comments = (it.comments + delta).coerceAtLeast(0)) else it }
    }

    fun confirmedPostRemoval(roomId: String, postId: String) {
        if (!current(roomId)) return
        posts = posts.filterNot { it.id == postId }
        loadPosts(); refreshRoom()
    }

    fun refreshPost(postId: String) {
        val room = selected ?: return
        val snapshot = versions.toMap()
        scope.launch {
            try {
                val fresh = StagingFeedClient(auth).loadOne(postId)
                if (readCurrent(room)) posts = posts.map { row ->
                    if (row.id != postId || fresh == null) row else row.copy(body = fresh.body,
                        likes = if ((versions["like:$postId"] ?: 0) == (snapshot["like:$postId"] ?: 0)) fresh.likes else row.likes,
                        comments = fresh.comments,
                        reposts = if ((versions["repost:$postId"] ?: 0) == (snapshot["repost:$postId"] ?: 0)) fresh.reposts else row.reposts,
                        mediaCount = fresh.mediaCount, media = fresh.media)
                }
                if (readCurrent(room)) loadPostActions(listOf(postId), room.id)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { if (readCurrent(room)) roomError = e.message ?: "Could not refresh post." }
        }
    }

    private fun loadPostActions(ids: List<String>, roomId: String) {
        listOf("like", "save", "repost").forEach { kind ->
            val snapshots = ids.associateWith { versions["$kind:$it"] ?: 0 }
            scope.launch {
                try {
                    val result = when (kind) {
                        "like" -> interactions.getLikeStates(ids)
                        "save" -> interactions.getSavedStates(ids)
                        else -> interactions.getRepostStates(ids)
                    }
                    if (current(roomId)) result.forEach { (id, value) ->
                        val key = "$kind:$id"
                        if ((versions[key] ?: 0) == snapshots[id]) { actionStates[key] = value; actionErrors.remove(key) }
                    }
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (e: Exception) { if (current(roomId)) ids.forEach { id ->
                    if ((versions["$kind:$id"] ?: 0) == snapshots[id]) actionErrors["$kind:$id"] = e.message ?: "Action status unavailable."
                } }
            }
        }
    }

    fun postAction(post: NativeRoomPost, kind: String, likeOnly: Boolean = false) {
        if (kind !in setOf("like", "save", "repost")) return
        val room = selected ?: return
        if (posts.none { it.id == post.id }) return
        val key = "$kind:${post.id}"
        val old = actionStates[key] ?: return
        if (!current(room.id) || busy(key) || likeOnly && old) return
        val desired = if (likeOnly) true else !old
        versions[key] = (versions[key] ?: 0) + 1
        busyKeys[key] = true; actionErrors.remove(key)
        scope.launch {
            try {
                if (!current(room.id)) return@launch
                when (kind) {
                    "like" -> interactions.setLike(post.id, desired)
                    "save" -> interactions.setSaved(post.id, desired)
                    "repost" -> interactions.setRepost(post.id, desired)
                }
                if (current(room.id)) {
                    versions[key] = (versions[key] ?: 0) + 1
                    actionStates[key] = desired
                    posts = posts.map { row -> if (row.id != post.id) row else when (kind) {
                        "like" -> row.copy(likes = (row.likes + if (desired) 1 else -1).coerceAtLeast(0))
                        "repost" -> row.copy(reposts = (row.reposts + if (desired) 1 else -1).coerceAtLeast(0))
                        else -> row
                    } }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { if (current(room.id)) actionErrors[key] = e.message ?: "Action could not be confirmed. Refresh before retrying." }
            finally { busyKeys.remove(key) }
        }
    }

    fun addMedia(room: NativeRoom, uris: List<Uri>) {
        if (!current(room.id) || !room.canPost) return
        val draft = draft(room)
        val kinds = uris.map { if (context.contentResolver.getType(it)?.startsWith("video/") == true) "video" else "image" }
        val limit = NativeRoomRules.mediaLimit(draft.media.map { it.kind } + kinds)
        val available = (limit - draft.media.size).coerceAtLeast(0)
        if (uris.size > available) draft.error = "Use up to 10 attachments. Remove an attachment first."
        uris.take(available).forEachIndexed { index, uri ->
            val id = UUID.randomUUID().toString()
            draft.media = draft.media + RoomDraftMedia(id, "Attachment ${draft.media.size + 1}", kinds[index])
            scope.launch {
                try {
                    if (!current()) return@launch
                    val ready = mediaClient.upload(uri) { progress ->
                        scope.launch {
                            if (current()) updateMedia(draft, id) { item ->
                                if (item.ready == null && item.status in setOf("Preparing", "Uploading"))
                                    item.copy(status = "Uploading", progress = maxOf(item.progress, progress)) else item
                            }
                        }
                    }
                    if (!current()) return@launch
                    if (draft.media.none { it.localId == id }) mediaClient.remove(ready.id)
                    else updateMedia(draft, id) { it.copy(kind = ready.kind, status = "Ready", progress = 100, ready = ready) }
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (e: Exception) { if (current()) updateMedia(draft, id) { it.copy(status = "Failed", error = e.message ?: "Upload failed.") } }
            }
        }
    }

    private fun updateMedia(draft: RoomDraft, id: String, change: (RoomDraftMedia) -> RoomDraftMedia) {
        draft.media = draft.media.map { if (it.localId == id) change(it) else it }
    }

    fun mediaAlt(room: NativeRoom, id: String, alt: String) = updateMedia(draft(room), id) { it.copy(alt = alt.take(1001)) }

    fun removeMedia(room: NativeRoom, item: RoomDraftMedia) {
        if (!current()) return
        val draft = draft(room)
        draft.media = draft.media.filterNot { it.localId == item.localId }
        item.ready?.let { ready -> scope.launch {
            try { if (current()) mediaClient.remove(ready.id) }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { if (current()) draft.error = e.message ?: "Could not discard uploaded media." }
        } }
    }

    fun publish(room: NativeRoom, onConfirmed: () -> Unit) {
        val draft = draft(room)
        if (!current(room.id) || busy("publish") || draft.uploading) return
        val snapshot = RoomPublishSnapshot(draft.editor.text, draft.replyAccess,
            draft.media.mapNotNull { it.ready?.copy(altText = it.alt) })
        if (draft.attemptSnapshot != snapshot) {
            draft.attemptSnapshot = snapshot; draft.attemptId = UUID.randomUUID().toString()
        }
        val requestId = draft.attemptId ?: return
        busyKeys["publish"] = true; draft.error = null
        scope.launch {
            try {
                val result = client.publish(room, snapshot.body, snapshot.media, snapshot.replyAccess,
                    clientRequestId = requestId)
                if (current() && draft.attemptSnapshot == snapshot) {
                    draft.editor = TextFieldValue("", TextRange.Zero); draft.media = emptyList()
                    draft.attemptSnapshot = null; draft.attemptId = null
                }
                if (readCurrent(room)) {
                    notice = when (result) {
                        is NativeRoomPublishResult.Published -> "Post published in ${room.name}."
                        is NativeRoomPublishResult.Pending -> "Post sent for review. It is not published yet."
                    }
                    onConfirmed(); loadPosts()
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { if (current()) draft.error = e.message ?: "Publication could not be confirmed. Refresh before retrying." }
            finally { busyKeys.remove("publish") }
        }
    }

    fun loadSubmissions(append: Boolean = false) {
        val room = selected?.takeIf { it.supportsPostApproval } ?: return
        if (append && submissionsLoading) return
        queueJob?.cancel()
        val revision = ++queueVersion
        val filter = submissionFilter
        val cursor = if (append) submissionsCursor else null
        queueJob = scope.launch {
            submissionsLoading = true; submissionError = null; submissionRetry = null
            try {
                val result = client.submissions(room, if (room.isStaff) "staff" else "mine", filter, cursor)
                if (readCurrent(room) && revision == queueVersion && submissionFilter == filter) {
                    submissions = (if (append) submissions + result.submissions else result.submissions).distinctBy { it.id }
                    submissionsCursor = result.nextCursor
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { if (readCurrent(room) && revision == queueVersion) submissionError = e.message ?: "Could not load pending posts." }
            finally { if (readCurrent(room) && revision == queueVersion) submissionsLoading = false }
        }
    }

    fun decideSubmission(submission: NativeRoomSubmission, approve: Boolean, reason: String = "") {
        val room = selected?.takeIf { it.supportsPostApproval && it.isStaff } ?: return
        if (submission.roomId != room.id || submission.state != "pending") return
        val decision = if (approve) "approve" else "reject"
        submissionMutation(room, submission, "$decision:$reason") { requestId ->
            client.decideSubmission(room, submission, approve, requestId, reason)
        }
    }

    fun loadSubmissionMedia(submission: NativeRoomSubmission) {
        val room = selected?.takeIf { it.supportsPostApproval } ?: return
        if (submission.roomId != room.id) return
        val key = "submission-media:${submission.id}"
        if (!current(room.id) || submission.state != "pending" || busy(key)) return
        busyKeys[key] = true; submissionError = null; submissionRetry = null
        scope.launch {
            try {
                val loaded = client.submission(room, submission.id)
                if (readCurrent(room)) {
                    val existing = submissions.firstOrNull { it.id == submission.id }
                    if (loaded.state != "pending" || loaded.version != submission.version) loadSubmissions()
                    else if (existing?.state == "pending" && existing.version == submission.version)
                        submissions = submissions.map { if (it.id == submission.id) it.copy(media = loaded.media) else it }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { if (readCurrent(room)) {
                submissionError = e.message ?: "Could not load submission attachments."
                submissionRetry = { loadSubmissionMedia(submission) }
            } }
            finally { busyKeys.remove(key) }
        }
    }

    fun withdrawSubmission(submission: NativeRoomSubmission) {
        val room = selected?.takeIf { it.supportsPostApproval && submission.authorId == accountId } ?: return
        if (submission.roomId != room.id || submission.state != "pending") return
        submissionMutation(room, submission, "withdraw") { requestId -> client.withdrawSubmission(room, submission, requestId) }
    }

    private fun submissionMutation(room: NativeRoom, submission: NativeRoomSubmission, decision: String,
        action: suspend (String) -> NativeRoomSubmission) {
        val key = "submission:${submission.id}"
        if (!current(room.id) || busy(key)) return
        val attempt = "${submission.id}:${submission.version}:$decision"
        val requestId = decisionIds.getOrPut(attempt) { UUID.randomUUID().toString() }
        busyKeys[key] = true; submissionError = null; submissionRetry = null
        scope.launch {
            try {
                val result = action(requestId)
                if (current(room.id)) {
                    decisionIds.remove(attempt)
                    queueVersion++; queueJob?.cancel(); queueJob = null
                    submissionsLoading = false; submissionError = null; submissionRetry = null; submissionsCursor = null
                    submissions = if (submissionFilter == "all") submissions.map { if (it.id == result.id) result.copy(media = emptyList()) else it }
                        else submissions.filterNot { it.id == result.id }
                    notice = when (result.state) { "approved" -> "Post approved."; "rejected" -> "Post rejected."; else -> "Submission withdrawn." }
                    loadPosts()
                    loadSubmissions()
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { if (current(room.id)) {
                submissionError = e.message ?: "Decision could not be confirmed. Refresh before retrying."
                submissionRetry = { submissionMutation(room, submission, decision, action) }
            } }
            finally { busyKeys.remove(key) }
        }
    }
}
