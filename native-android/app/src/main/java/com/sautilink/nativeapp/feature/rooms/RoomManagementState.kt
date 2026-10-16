package com.sautilink.nativeapp.feature.rooms

import androidx.compose.runtime.*
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.StagingFeedClient
import kotlinx.coroutines.*
import java.util.UUID

/** Account/Room scoped management state; every mutation remains pending until its validated ACK. */
internal class RoomManagementState(val auth: StagingAuthClient, val accountId: String?, parentScope: CoroutineScope) {
    private val client = NativeRoomManagementClient(auth)
    private val invitationsClient = NativeRoomOutgoingInvitationsClient(auth)
    private val feedClient = StagingFeedClient(auth)
    private val lifetime = SupervisorJob(parentScope.coroutineContext[Job])
    private val scope = CoroutineScope(parentScope.coroutineContext + lifetime)
    // Readiness can be observed before open(); publishing the Room must invalidate that first read.
    private var active by mutableStateOf<NativeRoom?>(null)
    private var generation = 0
    private var capabilityVersion = 0
    private var configVersion = 0
    private var pinsVersion = 0
    private var outgoingVersion = 0
    private var answersVersion = 0
    private var configJob: Job? = null
    private var capabilityJob: Job? = null
    private var pinsJob: Job? = null
    private var outgoingJob: Job? = null
    private var answersJob: Job? = null
    private val busyKeys = mutableStateMapOf<String, Boolean>()
    private val attempts = mutableMapOf<Any, String>()
    private val permissions = mutableStateMapOf<String, NativeRoomPostManagementAccess>()
    private val postErrors = mutableStateMapOf<String, String>()
    private val permissionVersions = mutableMapOf<String, Int>()
    private val pinAcknowledgements = mutableStateMapOf<String, Boolean>()
    var available by mutableStateOf(false); private set
    var capabilityResolved by mutableStateOf(false); private set
    var capabilityLoading by mutableStateOf(false); private set
    var capabilityError by mutableStateOf<String?>(null); private set
    var configuration by mutableStateOf<NativeRoomCommunityConfig?>(null); private set
    var configurationLoading by mutableStateOf(false); private set
    var configurationError by mutableStateOf<String?>(null); private set
    var membershipError by mutableStateOf<String?>(null); private set
    var pins by mutableStateOf<List<NativeRoomPinnedPost>>(emptyList()); private set
    var pinnedPosts by mutableStateOf<List<NativeRoomPost>>(emptyList()); private set
    var pinsLoading by mutableStateOf(false); private set
    var pinsLoaded by mutableStateOf(false); private set
    var pinsError by mutableStateOf<String?>(null); private set
    var outgoing by mutableStateOf<List<NativeRoomOutgoingInvitation>>(emptyList()); private set
    var outgoingLoading by mutableStateOf(false); private set
    var outgoingError by mutableStateOf<String?>(null); private set
    var outgoingNextOffset by mutableStateOf<Int?>(null); private set
    var membershipAnswers by mutableStateOf<NativeRoomMembershipAnswers?>(null); private set
    var answersLoading by mutableStateOf(false); private set
    var answersError by mutableStateOf<String?>(null); private set
    var notice by mutableStateOf<String?>(null); private set

    fun busy(key: String) = busyKeys[key] == true
    fun postAccess(postId: String) = permissions[postId]
    fun postError(postId: String) = postErrors[postId]
    fun isPinned(postId: String): Boolean? = pinAcknowledgements[postId] ?: if (pinsLoaded) pins.any { it.postId == postId } else null
    fun savingConfiguration(room: NativeRoom) = busy("configuration-save:${room.id}")
    fun joining(room: NativeRoom) = busy("membership:${room.id}")
    fun membershipRequestCancelled(room: NativeRoom) {
        if (current(room) && notice == "Join request sent.") notice = null
    }
    fun revoking(room: NativeRoom, invitation: NativeRoomOutgoingInvitation) = busy("revoke:${room.id}:${invitation.invitedUserId}")
    fun membershipReady(room: NativeRoom) = current(room) && capabilityResolved && !capabilityLoading &&
        (!available || configuration?.roomId == room.id && !configurationLoading && configurationError == null)
    private fun current() = lifetime.isActive && accountId != null && auth.account?.id == accountId
    private fun current(room: NativeRoom) = current() && room.viewerId == accountId && active?.id == room.id && active?.role == room.role &&
        active?.privacy == room.privacy && active?.viewerId == room.viewerId

    fun open(room: NativeRoom?, force: Boolean = false) {
        if (!current()) return
        val previous = active
        val sameContext = room != null && previous?.id == room.id && previous?.role == room.role &&
            previous?.privacy == room.privacy && previous?.viewerId == room.viewerId
        if (!sameContext) {
            generation++; configVersion++; pinsVersion++; outgoingVersion++; answersVersion++
            capabilityVersion++; capabilityJob?.cancel()
            configJob?.cancel(); pinsJob?.cancel(); outgoingJob?.cancel(); answersJob?.cancel()
            available = false; capabilityResolved = false; capabilityLoading = false; capabilityError = null
            configuration = null; configurationLoading = false
            configurationError = null; membershipError = null; pins = emptyList(); pinnedPosts = emptyList()
            pinsLoading = false; pinsLoaded = false; pinsError = null; outgoing = emptyList(); outgoingLoading = false
            outgoingError = null; outgoingNextOffset = null; membershipAnswers = null; answersLoading = false; answersError = null
            permissions.clear(); postErrors.clear(); permissionVersions.clear(); pinAcknowledgements.clear(); notice = null
        }
        active = room
        if (room == null || sameContext && !force) return
        capabilityVersion++; capabilityJob?.cancel()
        val revision = generation
        val capabilityRevision = capabilityVersion
        capabilityResolved = false; capabilityLoading = true; capabilityError = null
        capabilityJob = scope.launch {
            try {
                val result = client.capabilities()
                if (current(room) && revision == generation && capabilityRevision == capabilityVersion) {
                    available = result.available
                    capabilityResolved = true
                    if (result.available) { loadConfiguration(room); if (room.canReadPosts) loadPins(room) }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { if (current(room) && revision == generation && capabilityRevision == capabilityVersion) {
                available = false; capabilityResolved = false
                capabilityError = error.message ?: "Could not check Room capabilities. Try again."
            } }
            finally { if (current(room) && revision == generation && capabilityRevision == capabilityVersion) {
                capabilityLoading = false
            } }
        }
    }

    fun retry(room: NativeRoom) = open(room, force = true)

    fun dispose() {
        generation++; lifetime.cancel(); active = null
        membershipAnswers = null; outgoing = emptyList(); permissions.clear(); attempts.clear(); pinAcknowledgements.clear()
    }

    fun loadConfiguration(room: NativeRoom) {
        if (!current(room) || !available) return
        configJob?.cancel()
        val revision = ++configVersion
        configurationLoading = true; configurationError = null
        configJob = scope.launch {
            try {
                val result = client.configuration(room)
                if (current(room) && revision == configVersion) configuration = result
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { if (current(room) && revision == configVersion) configurationError = e.message ?: "Could not load community settings." }
            finally { if (current(room) && revision == configVersion) configurationLoading = false }
        }
    }

    fun reloadMembershipQuestions(room: NativeRoom) {
        if (!current(room)) return
        membershipError = null; loadConfiguration(room)
    }

    private data class ConfigAttempt(val roomId: String, val version: Int, val rules: List<NativeRoomRule>, val questions: List<NativeRoomQuestion>)
    fun saveConfiguration(room: NativeRoom, snapshot: NativeRoomCommunityConfig, rules: List<NativeRoomRule>,
        questions: List<NativeRoomQuestion>, onSaved: () -> Unit) {
        val key = "configuration-save:${room.id}"
        if (!current(room) || !available || busy(key)) return
        val attempt = ConfigAttempt(room.id, snapshot.version, rules.toList(), questions.toList())
        val requestId = attempts.getOrPut(attempt) { UUID.randomUUID().toString() }
        busyKeys[key] = true; configurationError = null
        scope.launch {
            try {
                val result = client.saveConfiguration(room, snapshot, attempt.rules, attempt.questions, requestId)
                attempts.remove(attempt)
                if (current(room)) {
                    configVersion++; configJob?.cancel(); configurationLoading = false; configuration = result
                    notice = "Community settings saved."; onSaved(); loadConfiguration(room)
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { if (current(room)) configurationError = e.message ?: "Community changes could not be confirmed. Refresh before retrying." }
            finally { busyKeys.remove(key) }
        }
    }

    private data class MembershipAttempt(val roomId: String, val version: Int, val answers: List<NativeRoomMembershipAnswer>, val actionKind: String)
    fun requestMembership(room: NativeRoom, snapshot: NativeRoomCommunityConfig, answers: List<NativeRoomMembershipAnswer>,
        actionKind: String = if (room.policy == "approval") "request" else "join", onConfirmed: (NativeRoomMembershipResult) -> Unit) {
        val key = "membership:${room.id}"
        if (!current(room) || !available || busy(key)) return
        val attempt = MembershipAttempt(room.id, snapshot.version, answers.toList(), actionKind)
        val requestId = attempts.getOrPut(attempt) { UUID.randomUUID().toString() }
        busyKeys[key] = true; membershipError = null
        scope.launch {
            try {
                val result = client.requestMembership(room, snapshot, attempt.answers, requestId, attempt.actionKind)
                attempts.remove(attempt)
                if (current(room)) {
                    notice = if (result.status == "member") "Room membership confirmed." else "Join request sent."
                    onConfirmed(result)
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { if (current(room)) membershipError = e.message ?: "Membership could not be confirmed. Refresh before retrying." }
            finally { busyKeys.remove(key) }
        }
    }

    fun loadMembershipAnswers(room: NativeRoom, requesterId: String) {
        if (!current(room) || !available) return
        answersJob?.cancel()
        val revision = ++answersVersion
        membershipAnswers = null
        answersJob = scope.launch {
            answersLoading = true; answersError = null
            try {
                val result = client.membershipAnswers(room, requesterId)
                if (current(room) && revision == answersVersion) membershipAnswers = result
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { if (current(room) && revision == answersVersion) answersError = e.message ?: "Could not load membership answers." }
            finally { if (current(room) && revision == answersVersion) answersLoading = false }
        }
    }

    fun clearMembershipAnswers() {
        answersVersion++; answersJob?.cancel(); membershipAnswers = null; answersLoading = false; answersError = null
    }

    fun loadPins(room: NativeRoom) {
        if (!current(room) || !available || !room.canReadPosts) return
        pinsJob?.cancel()
        val revision = ++pinsVersion
        pinsJob = scope.launch {
            pinsLoading = true; pinsError = null
            try {
                val result = client.pinnedPosts(room)
                val posts = result.mapNotNull { pin -> feedClient.loadOne(pin.postId)?.let { fresh ->
                    NativeRoomPost(fresh.id, fresh.authorId, fresh.authorName, fresh.authorHandle, fresh.body, fresh.createdAt,
                        fresh.verified, fresh.badgeType, fresh.likes, fresh.comments, fresh.reposts, fresh.mediaCount, fresh.media, fresh.hasAvatar)
                } }
                if (current(room) && revision == pinsVersion) { pins = result; pinnedPosts = posts; pinsLoaded = true; pinAcknowledgements.clear() }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { if (current(room) && revision == pinsVersion) pinsError = e.message ?: "Could not load pinned posts." }
            finally { if (current(room) && revision == pinsVersion) pinsLoading = false }
        }
    }

    fun loadPostAccess(room: NativeRoom, post: NativeRoomPost) {
        val key = "permissions:${post.id}"
        if (!current(room) || !available || busy(key)) return
        val revision = (permissionVersions[post.id] ?: 0) + 1
        permissionVersions[post.id] = revision; busyKeys[key] = true; postErrors.remove(post.id)
        scope.launch {
            try {
                val result = client.postPermissions(room, post)
                if (current(room) && permissionVersions[post.id] == revision) permissions[post.id] = result
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { if (current(room) && permissionVersions[post.id] == revision) {
                permissions.remove(post.id); postErrors[post.id] = e.message ?: "Room post permissions are unavailable."
            } }
            finally { busyKeys.remove(key) }
        }
    }

    fun refreshPostManagement(room: NativeRoom, post: NativeRoomPost) {
        loadPostAccess(room, post); loadPins(room)
    }

    private data class PinAttempt(val roomId: String, val postId: String, val pinned: Boolean)
    fun setPinned(room: NativeRoom, post: NativeRoomPost, pinned: Boolean) {
        val key = "pin:${post.id}"
        if (!current(room) || !available || busy(key) || busy("remove:${post.id}") || isPinned(post.id) == null) return
        val attempt = PinAttempt(room.id, post.id, pinned)
        val requestId = attempts.getOrPut(attempt) { UUID.randomUUID().toString() }
        busyKeys[key] = true; postErrors.remove(post.id)
        scope.launch {
            try {
                val result = client.setPinned(room, post.id, pinned, requestId)
                attempts.remove(attempt)
                if (current(room)) {
                    pinsVersion++; pinsJob?.cancel(); pinsLoading = false; pinsError = null
                    pinAcknowledgements[result.postId] = result.pinned
                    if (!result.pinned) pins = pins.filterNot { it.postId == result.postId }
                    pinnedPosts = if (result.pinned) pinnedPosts.filterNot { it.id == result.postId } + post
                        else pinnedPosts.filterNot { it.id == result.postId }
                    pinsLoaded = true; notice = if (result.pinned) "Post pinned." else "Post unpinned."; loadPins(room)
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { if (current(room)) postErrors[post.id] = e.message ?: "Pin change could not be confirmed. Refresh before retrying." }
            finally { busyKeys.remove(key) }
        }
    }

    private data class RemovalAttempt(val roomId: String, val postId: String, val reason: String)
    fun removePost(room: NativeRoom, post: NativeRoomPost, reason: String, onRemoved: (String) -> Unit) {
        val key = "remove:${post.id}"
        if (!current(room) || !available || busy(key) || busy("pin:${post.id}")) return
        val attempt = RemovalAttempt(room.id, post.id, reason.trim())
        val requestId = attempts.getOrPut(attempt) { UUID.randomUUID().toString() }
        busyKeys[key] = true; postErrors.remove(post.id)
        scope.launch {
            try {
                val result = client.removePost(room, post, attempt.reason, requestId)
                attempts.remove(attempt)
                if (current(room)) {
                    pinsVersion++; pinsJob?.cancel(); pinsLoading = false
                    pinAcknowledgements.remove(result.postId)
                    pins = pins.filterNot { it.postId == result.postId }; pinnedPosts = pinnedPosts.filterNot { it.id == result.postId }
                    notice = "Post removed from this Room."; onRemoved(result.postId); loadPins(room)
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { if (current(room)) postErrors[post.id] = e.message ?: "Removal could not be confirmed. Refresh before retrying." }
            finally { busyKeys.remove(key) }
        }
    }

    fun loadOutgoing(room: NativeRoom, append: Boolean = false) {
        if (!current(room) || !room.isMember || append && outgoingLoading) return
        val offset = if (append) outgoingNextOffset ?: return else 0
        outgoingJob?.cancel()
        val revision = ++outgoingVersion
        outgoingJob = scope.launch {
            outgoingLoading = true; outgoingError = null
            try {
                val result = invitationsClient.list(room, offset)
                if (current(room) && revision == outgoingVersion) {
                    outgoing = (if (append) outgoing + result.invitations else result.invitations).distinctBy { it.invitedUserId }
                    outgoingNextOffset = result.nextOffset
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { if (current(room) && revision == outgoingVersion) outgoingError = e.message ?: "Could not load outgoing invitations." }
            finally { if (current(room) && revision == outgoingVersion) outgoingLoading = false }
        }
    }

    fun revokeInvitation(room: NativeRoom, invitation: NativeRoomOutgoingInvitation) {
        val key = "revoke:${room.id}:${invitation.invitedUserId}"
        if (!current(room) || busy(key)) return
        busyKeys[key] = true; outgoingError = null
        scope.launch {
            try {
                invitationsClient.revoke(room, invitation)
                if (current(room)) {
                    outgoingVersion++; outgoingJob?.cancel(); outgoingLoading = false; outgoingError = null; outgoingNextOffset = null
                    outgoing = outgoing.filterNot { it.invitedUserId == invitation.invitedUserId }
                    notice = "Invitation revoked."; loadOutgoing(room)
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { if (current(room)) outgoingError = e.message ?: "Revocation could not be confirmed. Refresh before retrying." }
            finally { busyKeys.remove(key) }
        }
    }
}
