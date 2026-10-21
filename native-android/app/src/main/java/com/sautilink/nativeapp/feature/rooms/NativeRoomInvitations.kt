package com.sautilink.nativeapp.feature.rooms

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.time.Instant

/** Shared production sequence; the caller retains its account, role and target guards.
 * The transport checks the current account on every request and RLS remains authoritative.
 */
internal suspend fun sendNativeRoomInvitation(
    roomId: String,
    own: String,
    target: String,
    rest: suspend (path: String, method: String, payload: JSONObject?) -> JSONArray
) {
    if (rest("social_circle_members?circle_id=eq.$roomId&member_id=eq.$target&select=member_id&limit=1", "GET", null).length() != 0)
        throw AuthRequestException("That person is already a Room member.")
    val invitation = "social_room_invitations?room_id=eq.$roomId&invited_user_id=eq.$target"
    val previous = rest("$invitation&select=status,membership_ended_at,created_at,invited_by&limit=1", "GET", null)
        .optJSONObject(0)
    val status = previous?.roomString("status")
    if (status == "pending") throw AuthRequestException("That invitation is already pending.")
    if (status == "accepted") {
        val accepted = previous ?: throw AuthRequestException("Invitation changed. Refresh and try again.")
        if (accepted.isNull("membership_ended_at"))
            throw AuthRequestException("That invitation was already accepted.")
        val endedAt = accepted.opt("membership_ended_at") as? String
        val createdAt = accepted.opt("created_at") as? String
        val invitedBy = accepted.opt("invited_by") as? String
        if (!invitationTimestamp(endedAt) || !invitationTimestamp(createdAt) ||
            invitedBy == null || !NativeRoomRules.uuid.matches(invitedBy))
            throw AuthRequestException("Invitation changed. Refresh and try again.")
        // Match only the receipt we observed, never a replacement or an active invitation.
        val endedFilter = "(membership_ended_at.not.is.null,membership_ended_at.eq.${JSONObject.quote(endedAt)})"
        val removed = rest("$invitation&status=eq.accepted&created_at=eq.${invitationQuery(createdAt!!)}" +
            "&invited_by=eq.$invitedBy&and=${invitationQuery(endedFilter)}&select=room_id,invited_user_id,status", "DELETE", null)
        if (removed.length() != 1) throw AuthRequestException("Invitation changed. Refresh and try again.")
    }
    if (status == "declined") rest("$invitation&status=eq.declined", "DELETE", null)
    val created = rest("social_room_invitations?select=room_id,invited_user_id,status", "POST",
        JSONObject().put("room_id", roomId).put("invited_user_id", target).put("invited_by", own).put("status", "pending"))
    if (created.length() != 1)
        throw AuthRequestException("Invitation could not be confirmed. Refresh before trying again.")
}

private fun invitationTimestamp(value: String?): Boolean = value != null && value.length in 20..64 &&
    runCatching { Instant.parse(value) }.isSuccess

private fun invitationQuery(value: String): String = URLEncoder.encode(value, "UTF-8")
