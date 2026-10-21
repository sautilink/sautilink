package com.sautilink.nativeapp.feature.rooms

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.net.URLDecoder

/** Actual production invitation sequence with synthetic REST responses, never Auth or a socket. */
class NativeRoomInvitationProtocolTest {
    private val room = "11111111-1111-4111-8111-111111111111"
    private val owner = "22222222-2222-4222-8222-222222222222"
    private val target = "33333333-3333-4333-8333-333333333333"
    private val inviter = "44444444-4444-4444-8444-444444444444"
    private val createdAt = "2026-10-20T10:20:30.123456+00:00"
    private val endedAt = "2026-10-21T11:22:33.456789+00:00"
    private data class Call(val path: String, val method: String, val payload: JSONObject?)

    private inner class Script(
        val previous: JSONObject? = null,
        val alreadyMember: Boolean = false,
        val deleteRows: Int = 1,
        val postRows: Int = 1,
        val denyDelete: Boolean = false
    ) {
        val calls = mutableListOf<Call>()
        suspend fun rest(path: String, method: String, payload: JSONObject?): JSONArray {
            calls += Call(path, method, payload?.let { JSONObject(it.toString()) })
            return when {
                method == "GET" && path.startsWith("social_circle_members?") ->
                    if (alreadyMember) JSONArray().put(JSONObject().put("member_id", target)) else JSONArray()
                method == "GET" && path.startsWith("social_room_invitations?") ->
                    if (previous == null) JSONArray() else JSONArray().put(previous)
                method == "DELETE" -> {
                    if (denyDelete) throw AuthRequestException("Offline fixture: RLS denied stale deletion.", 403)
                    JSONArray().apply { repeat(deleteRows) { put(JSONObject().put("room_id", room)
                        .put("invited_user_id", target).put("status", previous?.roomString("status"))) } }
                }
                method == "POST" -> JSONArray().apply { repeat(postRows) { put(JSONObject()
                    .put("room_id", room).put("invited_user_id", target).put("status", "pending")) } }
                else -> throw AssertionError("Unexpected fixture request")
            }
        }
        suspend fun send() = sendNativeRoomInvitation(room, owner, target, ::rest)
        fun writes() = calls.filter { it.method != "GET" }
    }

    private fun receipt(status: String = "accepted") = JSONObject().put("status", status)
        .put("membership_ended_at", endedAt).put("created_at", createdAt).put("invited_by", inviter)

    private suspend fun rejected(block: suspend () -> Unit): AuthRequestException {
        try { block() } catch (error: AuthRequestException) { return error }
        throw AssertionError("Unconfirmed or active invitation must fail closed")
    }

    private fun query(path: String): Map<String, String> {
        val pairs = path.substringAfter('?').split('&').map { part ->
            val key = URLDecoder.decode(part.substringBefore('='), "UTF-8")
            val value = URLDecoder.decode(part.substringAfter('='), "UTF-8")
            key to value
        }
        assertEquals("Filters must not rely on duplicate query keys", pairs.size, pairs.map { it.first }.toSet().size)
        return pairs.toMap()
    }

    @Test fun pendingInvitation_neverDeletesOrPosts_evenWhenItHasAnEndedMarker() = runBlocking {
        val script = Script(receipt("pending"))
        assertTrue(rejected { script.send() }.message!!.contains("already pending"))
        assertTrue(script.writes().isEmpty())
    }

    @Test fun acceptedActiveOrLegacyInvitation_cannotBeReusedOrDeleted() = runBlocking {
        listOf(receipt().put("membership_ended_at", JSONObject.NULL), receipt().apply { remove("membership_ended_at") })
            .forEach { previous ->
                val script = Script(previous)
                assertTrue(rejected { script.send() }.message!!.contains("already accepted"))
                assertTrue(script.writes().isEmpty())
            }
    }

    @Test fun endedAcceptedReceipt_requiresExactOptimisticDeleteBeforeFreshPendingInvitation() = runBlocking {
        val script = Script(receipt())
        script.send()
        assertEquals(listOf("GET", "GET", "DELETE", "POST"), script.calls.map { it.method })
        assertEquals("status,membership_ended_at,created_at,invited_by", query(script.calls[1].path)["select"])
        val deleted = query(script.calls[2].path)
        assertEquals(setOf("room_id", "invited_user_id", "status", "created_at", "invited_by", "and", "select"), deleted.keys)
        assertEquals("eq.$room", deleted["room_id"])
        assertEquals("eq.$target", deleted["invited_user_id"])
        assertEquals("eq.accepted", deleted["status"])
        assertEquals("eq.$createdAt", deleted["created_at"])
        assertEquals("eq.$inviter", deleted["invited_by"])
        assertEquals("(membership_ended_at.not.is.null,membership_ended_at.eq.${JSONObject.quote(endedAt)})", deleted["and"])
        val payload = script.calls.last().payload!!
        assertEquals(setOf("room_id", "invited_user_id", "invited_by", "status"), payload.keys().asSequence().toSet())
        assertEquals(room, payload.getString("room_id"))
        assertEquals(target, payload.getString("invited_user_id"))
        assertEquals(owner, payload.getString("invited_by"))
        assertEquals("pending", payload.getString("status"))
    }

    @Test fun existingMembership_blocksAllInvitationLookupAndWrites_evenWithHistoricalEndedReceipt() = runBlocking {
        val script = Script(receipt(), alreadyMember = true)
        assertTrue(rejected { script.send() }.message!!.contains("already a Room member"))
        assertEquals(1, script.calls.size)
        assertTrue(script.calls.single().path.startsWith("social_circle_members?"))
        assertTrue(script.writes().isEmpty())
    }

    @Test fun malformedOrIncompleteEndedReceipt_neverAuthorizesDeletion() = runBlocking {
        val malformed = listOf(
            receipt().put("membership_ended_at", true),
            receipt().put("membership_ended_at", "not-a-timestamp"),
            receipt().put("membership_ended_at", "2026-10-21T11:22:33Z),status.eq.pending"),
            receipt().put("created_at", JSONObject.NULL),
            receipt().put("created_at", "invalid"),
            receipt().put("invited_by", "not-a-user-id"),
            receipt().apply { remove("invited_by") }
        )
        malformed.forEach { previous ->
            val script = Script(previous)
            rejected { script.send() }
            assertTrue(script.writes().isEmpty())
        }
    }

    @Test fun staleOrRlsDeniedEndedReceipt_neverContinuesToPost() = runBlocking {
        listOf(Script(receipt(), deleteRows = 0), Script(receipt(), deleteRows = 2), Script(receipt(), denyDelete = true))
            .forEach { script ->
                rejected { script.send() }
                assertEquals(listOf("DELETE"), script.writes().map { it.method })
            }
    }

    @Test fun declinedInvitation_keepsItsExistingDeleteThenPostBehavior() = runBlocking {
        val script = Script(receipt("declined"), deleteRows = 0)
        script.send()
        assertEquals(listOf("DELETE", "POST"), script.writes().map { it.method })
        val deleted = query(script.writes().first().path)
        assertEquals(setOf("room_id", "invited_user_id", "status"), deleted.keys)
        assertEquals("eq.declined", deleted["status"])
    }

    @Test fun firstInvitation_postsOnce_andUnconfirmedPostStillFails() = runBlocking {
        val first = Script()
        first.send()
        assertEquals(listOf("POST"), first.writes().map { it.method })
        listOf(0, 2).forEach { count ->
            val script = Script(postRows = count)
            rejected { script.send() }
            assertEquals(listOf("POST"), script.writes().map { it.method })
        }
    }
}
