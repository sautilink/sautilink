package com.sautilink.nativeapp.feature.rooms

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.FeedMedia
import com.sautilink.nativeapp.feature.posts.NativeReadyMedia
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.time.Instant
import java.util.Locale
import java.util.UUID

/** The existing Rooms tables, RLS and website APIs remain the source of truth. */
class NativeRoomsClient(auth: StagingAuthClient) {
    private val transport = NativeRoomsTransport(auth)
    private val uuid = NativeRoomRules.uuid
    private val metadata = "id,owner_id,slug,name,description,join_policy,category,privacy,cover_key,member_count,post_permission,invite_permission,updated_at"
    private val profileFields = "id,username,display_name,is_verified,verification_badge_type,avatar_key"
    private var capabilitySnapshot: Triple<String, Long, NativeRoomCapabilities>? = null
    private val approvals = NativeRoomSubmissionsClient(transport) { own -> capabilities(own) }

    suspend fun capabilities(): NativeRoomCapabilities = capabilities(transport.viewer())

    private suspend fun capabilities(own: String): NativeRoomCapabilities {
        capabilitySnapshot?.takeIf { it.first == own && System.currentTimeMillis() - it.second < 60_000 }
            ?.let { return it.third }
        val value = try {
            val data = transport.api(own, "/api/rooms/capabilities")
            NativeRoomCapabilities(data.optBoolean("post_approval", false) && data.optInt("version") == 1)
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { NativeRoomCapabilities() }
        transport.checkViewer(own)
        capabilitySnapshot = Triple(own, System.currentTimeMillis(), value)
        return value
    }

    private fun selection(capabilities: NativeRoomCapabilities) = metadata +
        if (capabilities.postApproval) ",post_approval_required" else ""

    suspend fun list(offset: Int = 0, category: String? = null): List<NativeRoom> {
        val own = transport.viewer()
        checkedOffset(offset)
        if (category != null && category !in NativeRoomRules.categories)
            throw AuthRequestException("Choose a valid Room category.")
        val cap = capabilities(own)
        val categoryFilter = category?.let { "&category=eq.$it" }.orEmpty()
        val rows = transport.rest(own, "social_circles?select=${selection(cap)}$categoryFilter&order=created_at.desc,id.desc&limit=60&offset=$offset")
        return rooms(own, rows.roomObjects(), cap)
    }

    /** Resolve memberships independently of the latest discovery page, including older Rooms. */
    suspend fun yourRooms(): List<NativeRoom> {
        val own = transport.viewer()
        val cap = capabilities(own)
        val memberships = mutableListOf<JSONObject>()
        var offset = 0
        do {
            val page = transport.rest(own, "social_circle_members?member_id=eq.$own&select=circle_id,member_role&order=joined_at.desc,circle_id.desc&limit=100&offset=$offset").roomObjects()
            memberships.addAll(page)
            offset += page.size
        } while (page.size == 100 && offset < 10_000)
        if (offset >= 10_000) throw AuthRequestException("There are too many memberships to load at once.")
        val rows = mutableListOf<JSONObject>()
        for (ids in memberships.map { it.roomString("circle_id") }.filter(uuid::matches).distinct().chunked(50)) {
            rows.addAll(transport.rest(own, "social_circles?id=in.(${ids.joinToString(",")})&select=${selection(cap)}").roomObjects())
        }
        // The owner membership is normally created atomically; preserve legacy owned Rooms too.
        offset = 0
        do {
            val page = transport.rest(own, "social_circles?owner_id=eq.$own&select=${selection(cap)}&order=created_at.desc,id.desc&limit=100&offset=$offset").roomObjects()
            rows.addAll(page)
            offset += page.size
        } while (page.size == 100 && offset < 10_000)
        if (offset >= 10_000) throw AuthRequestException("There are too many owned Rooms to load at once.")
        return rooms(own, rows.distinctBy { it.roomString("id") }, cap)
            .sortedBy { it.name.lowercase(Locale.ROOT) }
    }

    suspend fun findBySlug(slugValue: String): NativeRoom? {
        val own = transport.viewer()
        val slug = slugValue.trim().lowercase(Locale.ROOT)
        if (!NativeRoomRules.slug.matches(slug)) throw AuthRequestException("This Room address is invalid.")
        val cap = capabilities(own)
        return rooms(own, transport.rest(own,
            "social_circles?slug=eq.$slug&select=${selection(cap)}&limit=1").roomObjects(), cap).firstOrNull()
    }

    private suspend fun rooms(own: String, rows: List<JSONObject>, cap: NativeRoomCapabilities): List<NativeRoom> {
        val ids = rows.map { it.roomString("id") }.filter(uuid::matches).distinct()
        val membership = mutableMapOf<String, String>()
        val requests = mutableMapOf<String, String>()
        for (batch in ids.chunked(50)) {
            val filter = "in.(${batch.joinToString(",")})"
            transport.rest(own, "social_circle_members?member_id=eq.$own&circle_id=$filter&select=circle_id,member_role")
                .roomObjects().forEach { membership[it.roomString("circle_id")] = it.roomString("member_role") }
            transport.rest(own, "social_circle_join_requests?requester_id=eq.$own&circle_id=$filter&select=circle_id,status")
                .roomObjects().forEach { requests[it.roomString("circle_id")] = it.roomString("status") }
        }
        transport.checkViewer(own)
        return rows.mapNotNull { row -> parseRoom(row, own, membership[row.roomString("id")], requests[row.roomString("id")], cap) }
    }

    private fun parseRoom(row: JSONObject, own: String, role: String?, request: String?, cap: NativeRoomCapabilities): NativeRoom? {
        val id = row.roomString("id")
        val owner = row.roomString("owner_id")
        val slug = row.roomString("slug")
        val privacy = row.roomString("privacy")
        val policy = row.roomString("join_policy")
        if (!uuid.matches(id) || !uuid.matches(owner) || !NativeRoomRules.slug.matches(slug) ||
            privacy !in setOf("public", "private") || policy !in NativeRoomRules.policies) return null
        return NativeRoom(id, owner, slug, row.roomString("name"), row.roomString("description"), policy,
            if (owner == own) "owner" else role?.takeIf { it in NativeRoomRules.roles },
            request?.takeIf { it in setOf("pending", "approved", "declined") }, own,
            row.roomString("category"), privacy, row.roomString("cover_key").ifBlank { null },
            row.optInt("member_count").coerceAtLeast(0), row.roomString("post_permission"),
            row.roomString("invite_permission"), row.roomString("updated_at"), cap.postApproval,
            cap.postApproval && row.optBoolean("post_approval_required", false))
    }

    suspend fun create(nameValue: String, slugValue: String, descriptionValue: String, policy: String): NativeRoom =
        create(NativeRoomSettings(nameValue, slugValue, descriptionValue, policy,
            privacy = if (policy == "private") "private" else "public"))

    suspend fun create(settings: NativeRoomSettings): NativeRoom {
        val own = transport.viewer(writing = true)
        val value = settings.normalized()
        value.validationError()?.let { throw AuthRequestException(it) }
        val cap = capabilities(own)
        if (value.postApprovalRequired && !cap.postApproval) throw AuthRequestException("Post approval is not available on this server.")
        val row = transport.rest(own, "social_circles?select=${selection(cap)}", "POST",
            settingsPayload(value, cap).put("owner_id", own)).optJSONObject(0)
            ?: throw AuthRequestException("Room creation could not be confirmed. Refresh before trying again.")
        return parseRoom(row, own, "owner", null, cap)
            ?: throw AuthRequestException("Room creation could not be confirmed. Refresh before trying again.")
    }

    suspend fun update(room: NativeRoom, settings: NativeRoomSettings): NativeRoom {
        val own = transport.guard(room, writing = true)
        if (!room.canManageSettings) throw AuthRequestException("Only Room owners and admins can change settings.")
        val value = settings.normalized()
        value.validationError(existingPrivacy = room.privacy)?.let { throw AuthRequestException(it) }
        val cap = capabilities(own)
        if (value.postApprovalRequired && !cap.postApproval) throw AuthRequestException("Post approval is not available on this server.")
        val payload = settingsPayload(value, cap).apply {
            // Keep existing privacy immutable until its transition and historical-content
            // behavior have an approved contract. Current circle-post RLS still requires membership.
            remove("privacy")
            put("updated_at", Instant.now().toString())
        }
        val versionFilter = room.updatedAt.takeIf { it.isNotBlank() }
            ?.let { "&updated_at=eq.${URLEncoder.encode(it, "UTF-8")}" }.orEmpty()
        val row = transport.rest(own,
            "social_circles?id=eq.${room.id}&privacy=eq.${room.privacy}$versionFilter&select=${selection(cap)}", "PATCH", payload)
            .optJSONObject(0) ?: throw AuthRequestException("Room settings changed. Refresh and try again.")
        return parseRoom(row, own, room.role, room.requestStatus, cap)
            ?: throw AuthRequestException("Room settings could not be confirmed.")
    }

    private fun settingsPayload(value: NativeRoomSettings, cap: NativeRoomCapabilities): JSONObject =
        JSONObject().put("name", value.name).put("slug", value.slug).put("description", value.description)
            .put("join_policy", value.policy).put("category", value.category).put("privacy", value.privacy)
            .put("post_permission", value.postPermission).put("invite_permission", value.invitePermission)
            .apply { if (cap.postApproval) put("post_approval_required", value.postApprovalRequired) }

    suspend fun delete(room: NativeRoom) {
        val own = transport.guard(room, writing = true)
        if (room.ownerId != own) throw AuthRequestException("Only the owner can delete this Room.")
        confirmed(transport.rest(own, "social_circles?id=eq.${room.id}&owner_id=eq.$own&select=id", "DELETE"),
            "Room was not deleted. Refresh and try again.")
    }

    suspend fun join(room: NativeRoom) {
        val own = transport.guard(room, writing = true)
        if (room.policy != "open" || room.isMember) throw AuthRequestException("This Room cannot be joined directly.")
        confirmed(transport.rest(own, "social_circle_members?select=circle_id", "POST",
            JSONObject().put("circle_id", room.id).put("member_id", own).put("member_role", "member")),
            "Room membership was not confirmed. Refresh before trying again.")
    }

    suspend fun leave(room: NativeRoom) {
        val own = transport.guard(room, writing = true)
        if (room.isOwner || !room.isMember) throw AuthRequestException("The Room owner cannot leave; other members may leave their Room.")
        confirmed(transport.rest(own, "social_circle_members?circle_id=eq.${room.id}&member_id=eq.$own&member_role=neq.owner&select=circle_id", "DELETE"),
            "Could not leave Room. Refresh and try again.")
    }

    suspend fun requestJoin(room: NativeRoom) {
        val own = transport.guard(room, writing = true)
        if (room.policy != "approval" || room.isMember || room.requestStatus == "pending")
            throw AuthRequestException("A join request is not available for this Room.")
        if (room.requestStatus != null) transport.rest(own,
            "social_circle_join_requests?circle_id=eq.${room.id}&requester_id=eq.$own&status=neq.pending", "DELETE")
        confirmed(transport.rest(own, "social_circle_join_requests?select=circle_id", "POST",
            JSONObject().put("circle_id", room.id).put("requester_id", own)),
            "Join request was not confirmed. Refresh before trying again.")
    }

    suspend fun cancelJoinRequest(room: NativeRoom) {
        val own = transport.guard(room, writing = true)
        if (room.isMember || room.requestStatus != "pending") throw AuthRequestException("There is no pending join request to cancel.")
        confirmed(transport.rest(own,
            "social_circle_join_requests?circle_id=eq.${room.id}&requester_id=eq.$own&status=eq.pending&select=circle_id", "DELETE"),
            "Join request changed. Refresh and try again.")
    }

    suspend fun posts(room: NativeRoom, offset: Int = 0): List<NativeRoomPost> {
        val own = transport.guard(room)
        checkedOffset(offset)
        if (!room.canReadPosts) return emptyList()
        val rows = transport.rest(own, "social_posts?circle_id=eq.${room.id}&visibility=eq.circle&reply_to_post_id=is.null&post_status=eq.published&deleted_at=is.null&select=id,author_id,body,created_at,like_count,comment_count,repost_count,media_count&order=created_at.desc,id.desc&limit=30&offset=$offset")
            .roomObjects().filter { uuid.matches(it.roomString("id")) && uuid.matches(it.roomString("author_id")) }
        val authors = profiles(own, rows.map { it.roomString("author_id") })
        val ids = rows.map { it.roomString("id") }
        val mediaByPost = if (ids.isEmpty()) emptyMap() else transport.rest(own,
            "social_post_media?post_id=in.(${ids.joinToString(",")})&upload_status=eq.attached&select=id,post_id,media_kind,position,width,height&order=position.asc&limit=150")
            .roomObjects().filter { uuid.matches(it.roomString("id")) && it.roomString("post_id") in ids }
            .groupBy { it.roomString("post_id") }.mapValues { (_, media) -> media.mapNotNull { item ->
                val kind = item.roomString("media_kind")
                if (kind !in setOf("image", "video")) null else FeedMedia(item.roomString("id"), kind,
                    item.optInt("position").coerceAtLeast(0), item.optInt("width").coerceAtLeast(0), item.optInt("height").coerceAtLeast(0))
            }.sortedBy { it.position }.take(10) }
        transport.checkViewer(own)
        return rows.map { row ->
            val author = authors[row.roomString("author_id")]
            NativeRoomPost(row.roomString("id"), row.roomString("author_id"), author.name(),
                author?.roomString("username").orEmpty(), row.roomString("body"), row.roomString("created_at"),
                author?.optBoolean("is_verified", false) == true, author.badge(),
                row.optInt("like_count").coerceAtLeast(0), row.optInt("comment_count").coerceAtLeast(0),
                row.optInt("repost_count").coerceAtLeast(0), row.optInt("media_count").coerceIn(0, 10),
                mediaByPost[row.roomString("id")].orEmpty(), author.hasAvatar())
        }
    }

    suspend fun publish(room: NativeRoom, bodyValue: String, media: List<NativeReadyMedia> = emptyList(),
        replyAccess: String = "everyone", clientRequestId: String = UUID.randomUUID().toString()): NativeRoomPublishResult {
        val own = transport.guard(room, writing = true)
        if (!room.canPost) throw AuthRequestException("Room posting is available only to permitted members.")
        val body = bodyValue.trim()
        if (body.isBlank() && media.isEmpty()) throw AuthRequestException("Write something or add media before posting.")
        if (bodyValue.length > 2000) throw AuthRequestException("Room post text must be 2,000 characters or fewer.")
        if (replyAccess !in setOf("everyone", "following", "mentioned")) throw AuthRequestException("Choose who can comment.")
        if (replyAccess == "mentioned" && !NativeRoomRules.mention.containsMatchIn(body))
            throw AuthRequestException("Mention at least one @username or change who can comment.")
        if (!uuid.matches(clientRequestId)) throw AuthRequestException("Invalid post request. Reopen the composer.")
        if (media.size > NativeRoomRules.mediaLimit(media.map { it.kind }) || media.map { it.id.lowercase(Locale.ROOT) }.distinct().size != media.size ||
            media.any { !uuid.matches(it.id) || it.kind !in setOf("image", "video") || it.altText.length > 1000 })
            throw AuthRequestException("One or more media items are invalid.")
        val data = transport.api(own, "/api/sauti", "POST", JSONObject().put("body", body)
            .put("circle_id", room.id).put("reply_access", replyAccess).put("client_request_id", clientRequestId)
            .put("media", JSONArray().apply {
                media.forEach { put(JSONObject().put("id", it.id).put("alt_text", it.altText.trim())) }
            }))
        val post = data.optJSONObject("post")
        val id = post?.roomString("id").orEmpty()
        if (post != null && uuid.matches(id) && post.roomString("circle_id") == room.id && post.roomString("author_id") == own)
            return NativeRoomPublishResult.Published(id)
        val pending = data.optJSONObject("submission")
        val pendingId = pending?.roomString("id").orEmpty()
        if (pending != null && data.has("published") && !data.optBoolean("published", true) && uuid.matches(pendingId) &&
            pending.roomString("room_id") == room.id && pending.roomString("author_id") == own &&
            pending.roomString("state") == "pending") return NativeRoomPublishResult.Pending(pendingId)
        throw AuthRequestException("Posting could not be confirmed. Refresh before trying again.")
    }

    suspend fun members(room: NativeRoom, offset: Int = 0): List<NativeRoomMember> {
        val own = transport.guard(room)
        checkedOffset(offset)
        if (!room.canSeeMembers) return emptyList()
        val rows = transport.rest(own, "social_circle_members?circle_id=eq.${room.id}&select=member_id,member_role,joined_at&order=joined_at.asc,member_id.asc&limit=100&offset=$offset")
            .roomObjects().filter { uuid.matches(it.roomString("member_id")) && it.roomString("member_role") in NativeRoomRules.roles }
        val profiles = profiles(own, rows.map { it.roomString("member_id") })
        return rows.map { row ->
            val person = profiles[row.roomString("member_id")]
            NativeRoomMember(row.roomString("member_id"), row.roomString("member_role"), person.name(),
                person?.roomString("username").orEmpty(), person?.optBoolean("is_verified", false) == true,
                person.badge(), person.hasAvatar(), row.roomString("joined_at"))
        }
    }

    suspend fun pendingRequests(room: NativeRoom, offset: Int = 0): List<NativeJoinRequest> {
        val own = transport.guard(room)
        checkedOffset(offset)
        if (!room.canManagePeople) return emptyList()
        val rows = transport.rest(own, "social_circle_join_requests?circle_id=eq.${room.id}&status=eq.pending&select=requester_id,created_at&order=created_at.asc,requester_id.asc&limit=100&offset=$offset")
            .roomObjects().filter { uuid.matches(it.roomString("requester_id")) }
        val profiles = profiles(own, rows.map { it.roomString("requester_id") })
        return rows.map { row ->
            val person = profiles[row.roomString("requester_id")]
            NativeJoinRequest(row.roomString("requester_id"), person.name(), person?.roomString("username").orEmpty(),
                person?.optBoolean("is_verified", false) == true, person.badge(), person.hasAvatar(), row.roomString("created_at"))
        }
    }

    suspend fun decide(room: NativeRoom, requesterId: String, approve: Boolean) {
        val own = transport.guard(room, writing = true)
        if (!room.canManagePeople || !uuid.matches(requesterId) || requesterId == own)
            throw AuthRequestException("Only Room staff can review another person's join request.")
        confirmed(transport.rest(own, "social_circle_join_requests?circle_id=eq.${room.id}&requester_id=eq.$requesterId&status=eq.pending&select=requester_id",
            "PATCH", JSONObject().put("status", if (approve) "approved" else "declined")),
            "Request status changed. Refresh and try again.")
    }

    suspend fun changeMemberRole(room: NativeRoom, member: NativeRoomMember, newRole: String) {
        val own = transport.guard(room, writing = true)
        if (!uuid.matches(member.id) || newRole !in room.availableRolesFor(member))
            throw AuthRequestException("Your Room role cannot make that role change.")
        confirmed(transport.rest(own,
            "social_circle_members?circle_id=eq.${room.id}&member_id=eq.${member.id}&member_role=eq.${member.role}&select=member_id,member_role",
            "PATCH", JSONObject().put("member_role", newRole)), "Membership changed. Refresh and try again.")
    }

    suspend fun removeMember(room: NativeRoom, member: NativeRoomMember) {
        val own = transport.guard(room, writing = true)
        if (!uuid.matches(member.id) || !room.canRemoveMember(member))
            throw AuthRequestException("Your Room role cannot remove that member.")
        confirmed(transport.rest(own,
            "social_circle_members?circle_id=eq.${room.id}&member_id=eq.${member.id}&member_role=eq.${member.role}&select=member_id", "DELETE"),
            "Membership changed. Refresh and try again.")
    }

    suspend fun invitations(): List<NativeRoomInvitation> {
        val own = transport.viewer()
        val cap = capabilities(own)
        val rows = transport.rest(own, "social_room_invitations?invited_user_id=eq.$own&status=eq.pending&select=room_id,invited_by,created_at&order=created_at.desc,room_id.desc&limit=100")
            .roomObjects().filter { uuid.matches(it.roomString("room_id")) && uuid.matches(it.roomString("invited_by")) }
        val byId = mutableMapOf<String, NativeRoom>()
        for (ids in rows.map { it.roomString("room_id") }.distinct().chunked(50)) {
            rooms(own, transport.rest(own, "social_circles?id=in.(${ids.joinToString(",")})&select=${selection(cap)}")
                .roomObjects(), cap).forEach { byId[it.id] = it }
        }
        val people = profiles(own, rows.map { it.roomString("invited_by") })
        return rows.mapNotNull { row ->
            val room = byId[row.roomString("room_id")] ?: return@mapNotNull null
            val person = people[row.roomString("invited_by")]
            NativeRoomInvitation(room, row.roomString("invited_by"), row.roomString("created_at"),
                person.name(), person?.roomString("username").orEmpty())
        }
    }

    suspend fun invite(room: NativeRoom, handleValue: String) {
        val own = transport.guard(room, writing = true)
        if (!room.canInvite) throw AuthRequestException("Your Room role cannot invite members.")
        val handle = handleValue.trim().removePrefix("@").lowercase(Locale.ROOT)
        if (!NativeRoomRules.handle.matches(handle)) throw AuthRequestException("Enter a valid SautiLink username.")
        val profile = transport.rest(own, "social_profiles?username=eq.$handle&select=id&limit=1").optJSONObject(0)
        val target = profile?.roomString("id").orEmpty()
        if (!uuid.matches(target)) throw AuthRequestException("That SautiLink account was not found.")
        if (target == own) throw AuthRequestException("Choose another member to invite.")
        sendNativeRoomInvitation(room.id, own, target) { path, method, payload ->
            transport.rest(own, path, method, payload)
        }
    }

    suspend fun respond(invitation: NativeRoomInvitation, accept: Boolean) {
        val room = invitation.room
        val own = transport.guard(room, writing = true)
        if (!uuid.matches(invitation.invitedBy) || invitation.invitedBy == own)
            throw AuthRequestException("This invitation is invalid.")
        confirmed(transport.rest(own,
            "social_room_invitations?room_id=eq.${room.id}&invited_user_id=eq.$own&status=eq.pending&select=room_id,status",
            "PATCH", JSONObject().put("status", if (accept) "accepted" else "declined")),
            "Invitation changed. Refresh and try again.")
    }

    suspend fun submissions(room: NativeRoom, scope: String = "staff", state: String = "pending",
        cursor: String? = null): NativeRoomSubmissionPage = approvals.list(room, scope, state, cursor)

    suspend fun submission(room: NativeRoom, id: String): NativeRoomSubmission = approvals.load(room, id)

    suspend fun decideSubmission(room: NativeRoom, submission: NativeRoomSubmission, approve: Boolean,
        requestId: String, reason: String = ""): NativeRoomSubmission = approvals.decide(room, submission, approve, requestId, reason)

    suspend fun withdrawSubmission(room: NativeRoom, submission: NativeRoomSubmission,
        requestId: String): NativeRoomSubmission = approvals.withdraw(room, submission, requestId)

    private suspend fun profiles(own: String, ids: List<String>): Map<String, JSONObject> {
        val profiles = mutableMapOf<String, JSONObject>()
        for (batch in ids.filter(uuid::matches).distinct().chunked(50)) {
            transport.rest(own, "social_profiles?id=in.(${batch.joinToString(",")})&select=$profileFields")
                .roomObjects().forEach { profiles[it.roomString("id")] = it }
        }
        transport.checkViewer(own)
        return profiles
    }

    private fun confirmed(rows: JSONArray, message: String) {
        if (rows.length() != 1) throw AuthRequestException(message)
    }

    private fun checkedOffset(offset: Int) {
        if (offset !in 0..100_000) throw AuthRequestException("Invalid Room page.")
    }
}

private fun JSONObject?.name(): String = this?.roomString("display_name")?.ifBlank { null }
    ?: this?.roomString("username")?.ifBlank { null } ?: "SautiLink member"
private fun JSONObject?.badge(): String = this?.roomString("verification_badge_type")?.ifBlank { null } ?: "standard"
private fun JSONObject?.hasAvatar(): Boolean = !this?.roomString("avatar_key").isNullOrBlank()
