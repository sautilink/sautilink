package com.sautilink.nativeapp.feature.rooms

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject
import java.time.OffsetDateTime

/** Additive APIs are inaccessible until their separate, real management capability is present. */
class NativeRoomManagementClient(auth: StagingAuthClient) {
    private val transport = NativeRoomsTransport(auth)

    suspend fun capabilities(): NativeRoomManagementCapabilities = capabilities(transport.viewer())

    private suspend fun capabilities(own: String): NativeRoomManagementCapabilities {
        val data = try { transport.api(own, "/api/rooms/capabilities") }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (error: AuthRequestException) {
            if (error.httpStatus == 404) return NativeRoomManagementCapabilities()
            throw error
        }
        transport.checkViewer(own)
        val flag = data.opt("room_management") as? Boolean
            ?: throw AuthRequestException("Room capability response could not be confirmed. Try again.")
        val version = data.optInt("management_version", -1)
        val approvalVersion = data.optInt("version", -1)
        val approval = data.opt("post_approval") as? Boolean
        if (approval == null || approvalVersion !in 0..1 || approvalVersion == 0 && approval ||
            flag && version != 1 || !flag && version != 0)
            throw AuthRequestException("Room capability response could not be confirmed. Try again.")
        return NativeRoomManagementCapabilities(flag)
    }

    private suspend fun access(room: NativeRoom, writing: Boolean = false): String {
        val own = transport.guard(room, writing)
        if (!capabilities(own).available) throw AuthRequestException("Room community management is not available on this server.")
        transport.checkViewer(own)
        return own
    }

    suspend fun configuration(room: NativeRoom): NativeRoomCommunityConfig {
        val own = access(room)
        return parseConfiguration(room, transport.api(own, "/api/rooms/${room.id}/management"))
    }

    /** The caller retains requestId for the same immutable edit after an uncertain response. */
    suspend fun saveConfiguration(room: NativeRoom, snapshot: NativeRoomCommunityConfig,
        rules: List<NativeRoomRule>, questions: List<NativeRoomQuestion>, requestId: String): NativeRoomCommunityConfig {
        val own = access(room, writing = true)
        if (!room.canManageSettings) throw AuthRequestException("Only Room owners and admins can change community settings.")
        checkedSnapshot(room, snapshot); checkedRequestId(requestId)
        val normalizedRules = rules.map { it.copy(title = it.title.trim(), body = it.body.trim()) }
        val normalizedQuestions = questions.map { it.copy(prompt = it.prompt.trim()) }
        NativeRoomCommunityRules.configurationError(normalizedRules, normalizedQuestions)?.let { throw AuthRequestException(it) }
        val data = transport.api(own, "/api/rooms/${room.id}/management", "PUT",
            JSONObject().put("expected_version", snapshot.version).put("request_id", requestId)
                .put("rules", rulesJson(normalizedRules)).put("questions", questionsJson(normalizedQuestions)))
        val updated = parseConfiguration(room, data)
        if (updated.version.toLong() != snapshot.version.toLong() + 1 || updated.rules != normalizedRules || updated.questions != normalizedQuestions)
            throw AuthRequestException("Community settings could not be confirmed. Refresh before retrying.")
        return updated
    }

    suspend fun requestMembership(room: NativeRoom, snapshot: NativeRoomCommunityConfig,
        answers: List<NativeRoomMembershipAnswer>, requestId: String,
        actionKind: String = if (room.policy == "approval") "request" else "join"): NativeRoomMembershipResult {
        val own = access(room, writing = true)
        checkedSnapshot(room, snapshot); checkedRequestId(requestId)
        if (actionKind !in NativeRoomCommunityRules.membershipActions) throw AuthRequestException("Choose a valid Room membership action.")
        NativeRoomCommunityRules.answersError(snapshot.questions, answers)?.let { throw AuthRequestException(it) }
        val data = transport.api(own, "/api/rooms/${room.id}/membership-request", "POST",
            JSONObject().put("expected_version", snapshot.version).put("request_id", requestId).put("action_kind", actionKind)
                .put("answers", JSONArray().apply { answers.forEach {
                    put(JSONObject().put("question_id", it.questionId).put("answer", it.answer.trim()))
                } }))
        val status = data.roomString("status")
        if (data.roomString("room_id") != room.id || data.roomString("requester_id") != own ||
            status !in setOf("member", "pending") || data.optInt("config_version") != snapshot.version || data.roomString("request_id") != requestId)
            throw AuthRequestException("Membership could not be confirmed. Refresh before retrying.")
        return NativeRoomMembershipResult(room.id, own, status, snapshot.version, requestId)
    }

    suspend fun membershipAnswers(room: NativeRoom, requesterId: String): NativeRoomMembershipAnswers {
        val own = access(room)
        checkedId(requesterId)
        if (own != requesterId && !room.isStaff) throw AuthRequestException("Only Room staff can read another member's answers.")
        val data = transport.api(own, "/api/rooms/${room.id}/membership-requests/$requesterId/answers")
        val questions = parseQuestions(data)
        val values = array(data, "answers", NativeRoomCommunityRules.MAX_QUESTIONS).map { row ->
            NativeRoomMembershipAnswer(row.roomString("question_id"), row.roomString("answer"))
        }
        val submitted = data.roomString("submitted_at")
        val version = data.optInt("config_version")
        if (data.roomString("room_id") != room.id || data.roomString("requester_id") != requesterId || version < 1 ||
            !validTime(submitted) || NativeRoomCommunityRules.answersError(questions, values) != null)
            throw AuthRequestException("Membership answers could not be read. Refresh and try again.")
        return NativeRoomMembershipAnswers(room.id, requesterId, version, questions, values, submitted)
    }

    suspend fun pinnedPosts(room: NativeRoom): List<NativeRoomPinnedPost> {
        val own = access(room)
        if (!room.canReadPosts) throw AuthRequestException("Join this Room to read its pinned posts.")
        val data = transport.api(own, "/api/rooms/${room.id}/pinned-posts")
        if (data.optInt("pin_limit") != NativeRoomCommunityRules.PIN_LIMIT) throw AuthRequestException("Pinned posts could not be read.")
        val result = array(data, "posts", NativeRoomCommunityRules.PIN_LIMIT).map { row ->
            val postId = row.roomString("post_id"); val by = row.roomString("pinned_by").ifBlank { null }; val at = row.roomString("pinned_at")
            if (!NativeRoomRules.uuid.matches(postId) || by != null && !NativeRoomRules.uuid.matches(by) || !validTime(at))
                throw AuthRequestException("Pinned posts could not be read.")
            NativeRoomPinnedPost(postId, at, by)
        }
        if (result.map { it.postId }.distinct().size != result.size) throw AuthRequestException("Pinned posts changed. Refresh and try again.")
        return result
    }

    suspend fun postPermissions(room: NativeRoom, post: NativeRoomPost): NativeRoomPostManagementAccess {
        val own = access(room)
        return postPermissions(own, room, post)
    }

    private suspend fun postPermissions(own: String, room: NativeRoom, post: NativeRoomPost): NativeRoomPostManagementAccess {
        checkedId(post.id); checkedId(post.authorId)
        val ids = listOf(own, post.authorId).distinct()
        val rows = transport.rest(own, "social_circle_members?circle_id=eq.${room.id}&member_id=in.(${ids.joinToString(",")})&select=member_id,member_role").roomObjects()
        val roles = rows.associate { it.roomString("member_id") to it.roomString("member_role") }
        if (rows.any { it.roomString("member_id") !in ids } || roles.size != rows.size)
            throw AuthRequestException("Room roles could not be confirmed.")
        return NativeRoomCommunityRules.postAccess(room, post.authorId, roles[own], roles[post.authorId])
    }

    suspend fun setPinned(room: NativeRoom, postId: String, pinned: Boolean, requestId: String): NativeRoomPinResult {
        val own = access(room, writing = true)
        checkedId(postId); checkedRequestId(requestId)
        if (!room.isStaff) throw AuthRequestException("Only Room staff can manage pinned posts.")
        val data = transport.api(own, "/api/rooms/${room.id}/posts/$postId/pin", "PUT",
            JSONObject().put("pinned", pinned).put("request_id", requestId))
        val at = data.roomString("pinned_at").ifBlank { null }
        if (data.roomString("room_id") != room.id || data.roomString("post_id") != postId || data.opt("pinned") != pinned ||
            pinned && (at == null || !validTime(at)) || !pinned && at != null)
            throw AuthRequestException("The pin change could not be confirmed. Refresh before retrying.")
        return NativeRoomPinResult(room.id, postId, pinned, at)
    }

    suspend fun removePost(room: NativeRoom, post: NativeRoomPost, reasonValue: String, requestId: String): NativeRoomPostRemoval {
        val own = access(room, writing = true)
        checkedRequestId(requestId)
        val reason = reasonValue.trim()
        if (NativeRoomCommunityRules.textLength(reason) !in 1..500) throw AuthRequestException("Include a removal reason of 1–500 characters.")
        if (!postPermissions(own, room, post).canRemove) throw AuthRequestException("Your current Room role cannot remove this post.")
        val data = transport.api(own, "/api/rooms/${room.id}/posts/${post.id}/moderation", "POST",
            JSONObject().put("action", "remove").put("reason", reason).put("request_id", requestId))
        val at = data.roomString("removed_at")
        if (data.roomString("room_id") != room.id || data.roomString("post_id") != post.id ||
            data.roomString("action") != "remove" || data.opt("removed") != true || !validTime(at))
            throw AuthRequestException("Post removal could not be confirmed. Refresh before retrying.")
        return NativeRoomPostRemoval(room.id, post.id, at)
    }

    private fun checkedSnapshot(room: NativeRoom, snapshot: NativeRoomCommunityConfig) {
        if (snapshot.roomId != room.id || snapshot.version !in 1 until Int.MAX_VALUE ||
            snapshot.pinLimit != NativeRoomCommunityRules.PIN_LIMIT || NativeRoomCommunityRules.configurationError(snapshot.rules, snapshot.questions) != null)
            throw AuthRequestException("Community settings changed. Refresh and try again.")
    }

    private fun parseConfiguration(room: NativeRoom, data: JSONObject): NativeRoomCommunityConfig {
        val rules = array(data, "rules", NativeRoomCommunityRules.MAX_RULES).map {
            NativeRoomRule(it.roomString("id"), it.roomString("title"), it.roomString("body"))
        }
        val questions = parseQuestions(data)
        val value = NativeRoomCommunityConfig(data.roomString("room_id"), data.optInt("version"), rules, questions, data.optInt("pin_limit"))
        checkedSnapshot(room, value)
        return value
    }

    private fun parseQuestions(data: JSONObject): List<NativeRoomQuestion> {
        val values = array(data, "questions", NativeRoomCommunityRules.MAX_QUESTIONS).map {
            if (it.opt("required") !is Boolean) throw AuthRequestException("Membership questions could not be read.")
            NativeRoomQuestion(it.roomString("id"), it.roomString("prompt"), it.getBoolean("required"))
        }
        NativeRoomCommunityRules.configurationError(emptyList(), values)?.let { throw AuthRequestException(it) }
        return values
    }

    private fun array(data: JSONObject, key: String, max: Int): List<JSONObject> {
        val rows = data.optJSONArray(key) ?: throw AuthRequestException("Room management response could not be read.")
        val values = rows.roomObjects()
        if (rows.length() > max || values.size != rows.length()) throw AuthRequestException("Room management response could not be read.")
        return values
    }

    private fun rulesJson(rules: List<NativeRoomRule>) = JSONArray().apply { rules.forEach {
        put(JSONObject().put("id", it.id).put("title", it.title).put("body", it.body))
    } }

    private fun questionsJson(questions: List<NativeRoomQuestion>) = JSONArray().apply { questions.forEach {
        put(JSONObject().put("id", it.id).put("prompt", it.prompt).put("required", it.required))
    } }

    private fun checkedId(id: String) {
        if (!NativeRoomRules.uuid.matches(id)) throw AuthRequestException("Invalid Room management reference.")
    }

    private fun checkedRequestId(id: String) {
        if (!NativeRoomCommunityRules.configuredId.matches(id)) throw AuthRequestException("Invalid Room management request.")
    }

    private fun validTime(value: String) = value.length in 1..64 && runCatching { OffsetDateTime.parse(value) }.isSuccess
}
