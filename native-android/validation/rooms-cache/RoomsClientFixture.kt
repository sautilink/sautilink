package com.sautilink.nativeapp.feature.rooms

import android.content.Context
import android.net.Uri
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.posts.NativeReadyMedia

// Only external service/UI boundaries are substituted. Actual RoomsState and Room models are compiled unchanged.
internal enum class RoomsTab { DISCOVER, YOURS, INVITES }
internal enum class RoomTab { DISCUSSION, ABOUT, PEOPLE, MEDIA }
internal data class RoomPostUi(val liked: Boolean?, val saved: Boolean?, val reposted: Boolean?,
    val busy: Set<String>, val error: String?)
object CacheNetwork {
    var list: suspend () -> List<NativeRoom> = { emptyList() }
    var yours: suspend () -> List<NativeRoom> = { emptyList() }
    var invitations: suspend () -> List<NativeRoomInvitation> = { emptyList() }
    var find: suspend (String) -> NativeRoom? = { null }
    fun reset() { list = { emptyList() }; yours = { emptyList() }; invitations = { emptyList() }; find = { null } }
}
class NativeRoomsClient(auth: StagingAuthClient) {
    suspend fun capabilities() = NativeRoomCapabilities()
    suspend fun list(offset: Int, category: String?) = CacheNetwork.list()
    suspend fun yourRooms() = CacheNetwork.yours()
    suspend fun invitations() = CacheNetwork.invitations()
    suspend fun findBySlug(slug: String) = CacheNetwork.find(slug)
    suspend fun posts(room: NativeRoom, offset: Int): List<NativeRoomPost> = error("Unexpected posts read")
    suspend fun members(room: NativeRoom, offset: Int): List<NativeRoomMember> = error("Unexpected people read")
    suspend fun pendingRequests(room: NativeRoom, offset: Int): List<NativeJoinRequest> = error("Unexpected requests read")
    suspend fun create(settings: NativeRoomSettings): NativeRoom = error("Unexpected create")
    suspend fun update(room: NativeRoom, settings: NativeRoomSettings): NativeRoom = error("Unexpected update")
    suspend fun invite(room: NativeRoom, handle: String): Unit = error("Unexpected invitation")
    suspend fun respond(invitation: NativeRoomInvitation, accept: Boolean): Unit = error("Unexpected invitation decision")
    suspend fun publish(room: NativeRoom, body: String, media: List<NativeReadyMedia>, replyAccess: String,
        clientRequestId: String): NativeRoomPublishResult = error("Unexpected publication")
    suspend fun submissions(room: NativeRoom, scope: String, filter: String, cursor: String?): NativeRoomSubmissionPage = error("Unexpected queue read")
    suspend fun submission(room: NativeRoom, id: String): NativeRoomSubmission = error("Unexpected attachment read")
    suspend fun decideSubmission(room: NativeRoom, submission: NativeRoomSubmission, approve: Boolean,
        request: String, reason: String): NativeRoomSubmission = error("Unexpected moderation")
    suspend fun withdrawSubmission(room: NativeRoom, submission: NativeRoomSubmission,
        request: String): NativeRoomSubmission = error("Unexpected withdrawal")
}
class NativeRoomCoverClient(context: Context, auth: StagingAuthClient) {
    suspend fun upload(room: NativeRoom, uri: Uri): Unit = error("Unexpected cover upload")
    suspend fun remove(room: NativeRoom): Unit = error("Unexpected cover deletion")
}
