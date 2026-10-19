package com.sautilink.nativeapp.feature.rooms

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import java.net.URLEncoder
import java.time.OffsetDateTime

/** Existing invitation RLS already permits an inviter or current staff to revoke a pending tuple. */
class NativeRoomOutgoingInvitationsClient(auth: StagingAuthClient) {
    private val transport = NativeRoomsTransport(auth)
    private val fields = "room_id,invited_user_id,invited_by,status,created_at"

    suspend fun list(room: NativeRoom, offset: Int = 0): NativeRoomOutgoingInvitationPage {
        val own = transport.guard(room)
        if (!room.isMember) throw AuthRequestException("Join this Room to manage your invitations.")
        if (offset !in 0..100_000) throw AuthRequestException("Invalid invitation page.")
        val inviter = if (room.isStaff) "" else "&invited_by=eq.$own"
        val data = transport.rest(own, "social_room_invitations?room_id=eq.${room.id}&status=eq.pending$inviter&select=$fields&order=created_at.desc,invited_user_id.desc&limit=100&offset=$offset")
        val raw = data.roomObjects()
        if (raw.size != data.length() || raw.size > 100) throw AuthRequestException("Invitations could not be read.")
        val rows = raw.map { row ->
            val user = row.roomString("invited_user_id"); val by = row.roomString("invited_by"); val at = row.roomString("created_at")
            if (row.roomString("room_id") != room.id || row.roomString("status") != "pending" ||
                !NativeRoomRules.uuid.matches(user) || !NativeRoomRules.uuid.matches(by) ||
                !validTime(at) || !room.isStaff && by != own)
                throw AuthRequestException("Invitations changed. Refresh and try again.")
            NativeRoomOutgoingInvitation(room.id, user, by, at)
        }
        if (rows.map { it.invitedUserId }.distinct().size != rows.size) throw AuthRequestException("Invitations changed. Refresh and try again.")
        val profiles = mutableMapOf<String, org.json.JSONObject>()
        rows.map { it.invitedUserId }.distinct().chunked(50).forEach { ids ->
            transport.rest(own, "social_profiles?id=in.(${ids.joinToString(",")})&select=id,username,display_name,is_verified,verification_badge_type,avatar_key")
                .roomObjects().filter { it.roomString("id") in ids }.forEach { profiles[it.roomString("id")] = it }
        }
        transport.checkViewer(own)
        return NativeRoomOutgoingInvitationPage(rows.map { invite ->
            val person = profiles[invite.invitedUserId]
            val handle = person?.roomString("username").orEmpty()
            invite.copy(name = person?.roomString("display_name")?.ifBlank { null } ?: handle.ifBlank { "SautiLink member" },
                handle = handle, verified = person?.optBoolean("is_verified", false) == true,
                badgeType = person?.roomString("verification_badge_type")?.ifBlank { null } ?: "standard",
                hasAvatar = !person?.roomString("avatar_key").isNullOrBlank())
        }, if (raw.size == 100) offset + raw.size else null)
    }

    suspend fun revoke(room: NativeRoom, invitation: NativeRoomOutgoingInvitation) {
        val own = transport.guard(room, writing = true)
        if (!room.isMember || invitation.roomId != room.id || !NativeRoomRules.uuid.matches(invitation.invitedUserId) ||
            !NativeRoomRules.uuid.matches(invitation.invitedBy) || !validTime(invitation.createdAt) ||
            !room.isStaff && invitation.invitedBy != own)
            throw AuthRequestException("Your Room role cannot revoke this invitation.")
        val at = URLEncoder.encode(invitation.createdAt, "UTF-8")
        val result = transport.rest(own, "social_room_invitations?room_id=eq.${room.id}&invited_user_id=eq.${invitation.invitedUserId}&invited_by=eq.${invitation.invitedBy}&created_at=eq.$at&status=eq.pending&select=$fields", "DELETE")
        val row = result.optJSONObject(0)
        if (result.length() != 1 || row == null || row.roomString("room_id") != room.id ||
            row.roomString("invited_user_id") != invitation.invitedUserId || row.roomString("invited_by") != invitation.invitedBy ||
            row.roomString("status") != "pending" || !sameTime(row.roomString("created_at"), invitation.createdAt))
            throw AuthRequestException("Revocation could not be confirmed. Refresh before retrying.")
    }

    private fun validTime(value: String) = value.length in 1..64 && runCatching { OffsetDateTime.parse(value) }.isSuccess
    private fun sameTime(first: String, second: String) = runCatching {
        OffsetDateTime.parse(first).toInstant() == OffsetDateTime.parse(second).toInstant()
    }.getOrDefault(false)
}
