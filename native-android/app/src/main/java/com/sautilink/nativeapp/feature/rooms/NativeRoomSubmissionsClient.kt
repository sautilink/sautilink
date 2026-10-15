package com.sautilink.nativeapp.feature.rooms

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import org.json.JSONObject

/** Future approval APIs are accessible only after the server advertises version 1 support. */
internal class NativeRoomSubmissionsClient(
    private val transport: NativeRoomsTransport,
    private val capabilities: suspend (String) -> NativeRoomCapabilities
) {
    private val uuid = NativeRoomRules.uuid
    private val states = setOf("pending", "approved", "rejected", "withdrawn")

    private suspend fun access(room: NativeRoom, writing: Boolean = false): String {
        val own = transport.guard(room, writing)
        if (!room.supportsPostApproval || !capabilities(own).postApproval)
            throw AuthRequestException("Post approval is not available on this server.")
        return own
    }

    suspend fun list(room: NativeRoom, scope: String, state: String, cursor: String?): NativeRoomSubmissionPage {
        val own = access(room)
        if (scope !in setOf("mine", "staff") || state != "all" && state !in states || cursor != null && !uuid.matches(cursor))
            throw AuthRequestException("Invalid Room submission filter.")
        if (scope == "staff" && !room.canManagePeople) throw AuthRequestException("Only Room staff can review submissions.")
        val query = "?scope=$scope&state=$state&limit=30" + cursor?.let { "&cursor=$it" }.orEmpty()
        val data = transport.api(own, "/api/rooms/${room.id}/post-submissions$query")
        val rows = data.optJSONArray("submissions") ?: throw AuthRequestException("Submission list could not be confirmed.")
        val submissions = rows.roomObjects().map { parse(room, it) }
        if (submissions.size != rows.length() || submissions.any { state != "all" && it.state != state || scope == "mine" && it.authorId != own })
            throw AuthRequestException("Submission list changed. Refresh and try again.")
        val next = data.roomString("next_cursor").ifBlank { null }
        if (next != null && !uuid.matches(next)) throw AuthRequestException("Submission page could not be read.")
        return NativeRoomSubmissionPage(identities(own, submissions), next)
    }

    suspend fun load(room: NativeRoom, id: String): NativeRoomSubmission {
        val own = access(room)
        checkedId(id)
        val data = transport.api(own, "/api/rooms/${room.id}/post-submissions/$id")
        val row = data.optJSONObject("submission") ?: throw AuthRequestException("Submission is unavailable.")
        val submission = parse(room, row)
        if (submission.id != id || !room.canManagePeople && submission.authorId != own)
            throw AuthRequestException("Submission is unavailable.")
        return identities(own, listOf(submission)).single()
    }

    suspend fun decide(room: NativeRoom, submission: NativeRoomSubmission, approve: Boolean,
        requestId: String, reasonValue: String): NativeRoomSubmission {
        val own = access(room, writing = true)
        checkedMutation(room, submission, requestId)
        if (!room.canManagePeople) throw AuthRequestException("Only Room staff can decide submissions.")
        val reason = reasonValue.trim()
        if (reason.length > 500 || !approve && reason.isBlank())
            throw AuthRequestException("Include a rejection reason of 1–500 characters.")
        val data = transport.api(own, "/api/rooms/${room.id}/post-submissions/${submission.id}/decision", "POST",
            JSONObject().put("request_id", requestId).put("expected_version", submission.version)
                .put("decision", if (approve) "approve" else "reject").put("reason", reason))
        val updated = parse(room, data.optJSONObject("submission")
            ?: throw AuthRequestException("The decision could not be confirmed. Refresh the queue."))
        if (updated.id != submission.id || updated.authorId != submission.authorId ||
            updated.state != (if (approve) "approved" else "rejected") ||
            updated.version <= submission.version || approve &&
            (!uuid.matches(data.roomString("post_id")) || data.roomString("post_id") != updated.publishedPostId))
            throw AuthRequestException("The decision could not be confirmed. Refresh the queue.")
        return updated.withIdentityFrom(submission)
    }

    suspend fun withdraw(room: NativeRoom, submission: NativeRoomSubmission, requestId: String): NativeRoomSubmission {
        val own = access(room, writing = true)
        checkedMutation(room, submission, requestId)
        if (submission.authorId != own) throw AuthRequestException("You can withdraw only your own submission.")
        val data = transport.api(own, "/api/rooms/${room.id}/post-submissions/${submission.id}", "DELETE",
            JSONObject().put("request_id", requestId).put("expected_version", submission.version))
        val updated = parse(room, data.optJSONObject("submission")
            ?: throw AuthRequestException("Withdrawal could not be confirmed. Refresh your submissions."))
        if (updated.id != submission.id || updated.authorId != own || updated.state != "withdrawn" || updated.version <= submission.version)
            throw AuthRequestException("Withdrawal could not be confirmed. Refresh your submissions.")
        return updated.withIdentityFrom(submission)
    }

    private fun checkedMutation(room: NativeRoom, submission: NativeRoomSubmission, requestId: String) {
        checkedId(submission.id)
        checkedId(requestId)
        if (submission.roomId != room.id || !uuid.matches(submission.authorId) || submission.state != "pending" || submission.version < 1)
            throw AuthRequestException("This submission changed. Refresh before deciding it.")
    }

    // Display-name enrichment must never turn a confirmed decision into a network failure.
    private fun NativeRoomSubmission.withIdentityFrom(original: NativeRoomSubmission) = copy(
        authorName = original.authorName, authorHandle = original.authorHandle,
        verified = original.verified, badgeType = original.badgeType, hasAvatar = original.hasAvatar
    )

    private fun checkedId(id: String) {
        if (!uuid.matches(id)) throw AuthRequestException("Invalid Room submission reference.")
    }

    private fun parse(room: NativeRoom, row: JSONObject): NativeRoomSubmission {
        val id = row.roomString("id")
        val author = row.roomString("author_id")
        val state = row.roomString("state")
        val version = row.optInt("version")
        val published = row.roomString("published_post_id").ifBlank { null }
        // Approval history remains valid when the published post is later deleted (FK SET NULL).
        // A fresh approval acknowledgement above still requires a real, matching post ID.
        if (!uuid.matches(id) || !uuid.matches(author) || row.roomString("room_id") != room.id ||
            state !in states || version < 1 || published != null && !uuid.matches(published))
            throw AuthRequestException("Submission details could not be read. Refresh and try again.")
        val mediaRows = row.optJSONArray("media")?.roomObjects().orEmpty()
        if (mediaRows.size > 5) throw AuthRequestException("Submission media could not be read.")
        val media = mediaRows.map { item ->
            val mediaId = item.roomString("id")
            val kind = item.roomString("media_kind")
            if (!uuid.matches(mediaId) || kind !in setOf("image", "video"))
                throw AuthRequestException("Submission media could not be read.")
            NativeRoomSubmissionMedia(mediaId, kind, item.optInt("position").coerceAtLeast(0),
                item.roomString("alt_text"), item.optInt("width").coerceAtLeast(0),
                item.optInt("height").coerceAtLeast(0), item.optLong("duration_ms").coerceAtLeast(0))
        }.sortedBy { it.position }
        return NativeRoomSubmission(id, room.id, author, row.roomString("body"), row.roomString("reply_access"),
            row.optInt("media_count").coerceIn(0, 5), state, version, row.roomString("created_at"),
            row.roomString("decided_at").ifBlank { null }, row.roomString("decision_reason"), published, media)
    }

    private suspend fun identities(own: String, rows: List<NativeRoomSubmission>): List<NativeRoomSubmission> {
        val people = mutableMapOf<String, JSONObject>()
        for (ids in rows.map { it.authorId }.distinct().chunked(50)) {
            transport.rest(own, "social_profiles?id=in.(${ids.joinToString(",")})&select=id,username,display_name,is_verified,verification_badge_type,avatar_key")
                .roomObjects().forEach { people[it.roomString("id")] = it }
        }
        transport.checkViewer(own)
        return rows.map { row ->
            val person = people[row.authorId]
            val handle = person?.roomString("username").orEmpty()
            row.copy(authorName = person?.roomString("display_name")?.ifBlank { null } ?: handle.ifBlank { "SautiLink member" },
                authorHandle = handle, verified = person?.optBoolean("is_verified", false) == true,
                badgeType = person?.roomString("verification_badge_type")?.ifBlank { null } ?: "standard",
                hasAvatar = !person?.roomString("avatar_key").isNullOrBlank())
        }
    }
}
