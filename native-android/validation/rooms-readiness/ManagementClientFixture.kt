package com.sautilink.nativeapp.feature.rooms

import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.CompletableDeferred

object ReadinessNetwork {
    var capability = CompletableDeferred<NativeRoomManagementCapabilities>()
    var config = CompletableDeferred<NativeRoomCommunityConfig>()
    var membership = CompletableDeferred<NativeRoomMembershipResult>()
    fun reset() {
        capability = CompletableDeferred()
        config = CompletableDeferred()
        membership = CompletableDeferred()
    }
}

// Deferred boundaries let actual open/loadConfiguration code execute, without a server.
class NativeRoomManagementClient(auth: StagingAuthClient) {
    suspend fun capabilities() = ReadinessNetwork.capability.await()
    suspend fun configuration(room: NativeRoom) = ReadinessNetwork.config.await()
    suspend fun saveConfiguration(room: NativeRoom, snapshot: NativeRoomCommunityConfig,
        rules: List<NativeRoomRule>, questions: List<NativeRoomQuestion>, id: String): NativeRoomCommunityConfig = error("Unexpected write")
    suspend fun requestMembership(room: NativeRoom, snapshot: NativeRoomCommunityConfig,
        answers: List<NativeRoomMembershipAnswer>, id: String, action: String): NativeRoomMembershipResult = ReadinessNetwork.membership.await()
    suspend fun membershipAnswers(room: NativeRoom, id: String): NativeRoomMembershipAnswers = error("Unexpected read")
    suspend fun pinnedPosts(room: NativeRoom): List<NativeRoomPinnedPost> = error("Unexpected pins read")
    suspend fun postPermissions(room: NativeRoom, post: NativeRoomPost): NativeRoomPostManagementAccess = error("Unexpected permissions read")
    suspend fun setPinned(room: NativeRoom, id: String, pinned: Boolean, request: String): NativeRoomPinResult = error("Unexpected write")
    suspend fun removePost(room: NativeRoom, post: NativeRoomPost, reason: String, request: String): NativeRoomPostRemoval = error("Unexpected write")
}
class NativeRoomOutgoingInvitationsClient(auth: StagingAuthClient) {
    suspend fun list(room: NativeRoom, offset: Int): NativeRoomOutgoingInvitationPage = error("Unexpected invitations read")
    suspend fun revoke(room: NativeRoom, invitation: NativeRoomOutgoingInvitation): Unit = error("Unexpected write")
}
