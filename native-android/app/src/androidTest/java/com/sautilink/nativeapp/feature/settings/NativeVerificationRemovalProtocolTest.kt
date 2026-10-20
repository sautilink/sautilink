package com.sautilink.nativeapp.feature.settings

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.sautilink.nativeapp.feature.auth.AuthRequestException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import okhttp3.Request
import okio.Buffer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Pure fake session/transport: never restores Auth, creates MainActivity, or opens a socket. */
@RunWith(AndroidJUnit4::class)
class NativeVerificationRemovalProtocolTest {
    private val owner = "11111111-1111-4111-8111-111111111111"
    private val other = "22222222-2222-4222-8222-222222222222"
    private val requestId = "33333333-3333-4333-8333-333333333333"

    private class Session(initialOwner: String?) : NativeVerificationRemovalSession {
        override var ownerId: String? = initialOwner
        override var isProduction: Boolean = true
        var tokenCalls = 0
        var token: suspend () -> String = { "offline-access-token-fixture" }
        override suspend fun accessToken(): String { tokenCalls++; return token() }
    }

    private data class Call(val url: String, val token: String, val body: String)

    private fun response(status: String = "removed") = JSONObject().put("ok", true).put("data",
        JSONObject().put("status", status).put("user_id", owner).put("username_unlocked", true)
            .put("profile", JSONObject().put("id", owner).put("username", "fixture_owner")
                .put("display_name", "Fixture owner").put("is_verified", false)
                .put("verification_badge_type", "standard")))

    private suspend fun denied(block: suspend () -> Unit): AuthRequestException {
        try { block() } catch (failure: AuthRequestException) { return failure }
        throw AssertionError("An invalid/unconfirmed removal must fail closed")
    }

    @Test fun ownerProfileGate_requiresCurrentOwnerAndStrictTrue_regardlessOfArtworkOrHistoricalCase() {
        listOf("standard", "team", "government").forEach { artwork ->
            val profile = JSONObject().put("id", owner).put("is_verified", true)
                .put("verification_badge_type", artwork)
            assertTrue(NativeVerificationRemovalPolicy.verifiedOwner(owner,
                profile.opt("id"), profile.opt("is_verified")))
        }
        listOf(false, "true", "false", 1, 0, JSONObject.NULL, null).forEach { flag ->
            assertFalse("Only a server Boolean true authorizes the setting: $flag",
                NativeVerificationRemovalPolicy.verifiedOwner(owner, owner, flag))
        }
        assertFalse(NativeVerificationRemovalPolicy.verifiedOwner(owner, other, true))
        assertFalse(NativeVerificationRemovalPolicy.verifiedOwner(null, owner, true))
        assertFalse(NativeVerificationRemovalPolicy.verifiedOwner("not-a-user-id", "not-a-user-id", true))
        assertFalse(NativeVerificationRemovalPolicy.eligible(owner, owner, true, loading = true))
        assertFalse(NativeVerificationRemovalPolicy.eligible(owner, other, true, loading = false))
        // An old approved case never overrides the current own-profile checkmark state.
        val historical = JSONObject().put("status", "approved").put("is_verified", false)
        assertFalse(NativeVerificationRemovalPolicy.verifiedOwner(owner, owner, historical.opt("is_verified")))
        assertTrue(NativeVerificationRemovalPolicy.eligible(owner, owner, true, loading = false))
    }

    @Test fun request_usesOnlyUuidConfirmation_andActualProductionBearerRequest_withoutSecrets() = runBlocking {
        val calls = mutableListOf<Call>()
        val session = Session(owner)
        val transport = NativeVerificationRemovalTransport { url, token, body ->
            calls += Call(url, token, body)
            NativeVerificationRemovalHttpResponse(200, response().toString())
        }
        val result = NativeVerificationRemovalClient(session, transport).removeVerification(owner, requestId)
        assertEquals(NativeVerificationRemovalResult(owner, "removed"), result)
        assertEquals(1, calls.size)
        val sent = calls.single()
        assertEquals("https://sautilink.com/api/account/verification/remove", sent.url)
        val payload = JSONObject(sent.body)
        assertEquals(setOf("request_id", "confirmation"), payload.keys().asSequence().toSet())
        assertEquals(requestId, payload.getString("request_id"))
        assertEquals("remove-verification-v1", payload.getString("confirmation"))
        assertFalse(payload.has("user_id"))
        assertFalse(payload.has("is_verified"))
        val actual: Request = verificationRemovalHttpRequest(sent.url, sent.token, sent.body)
        assertEquals("POST", actual.method)
        assertEquals(sent.url, actual.url.toString())
        assertEquals("Bearer offline-access-token-fixture", actual.header("Authorization"))
        assertEquals("application/json", actual.header("Accept"))
        assertEquals("no-store", actual.header("Cache-Control"))
        assertNull("This account endpoint never needs an API/service key", actual.header("apikey"))
        assertEquals("application/json; charset=utf-8", actual.body?.contentType().toString())
        val buffer = Buffer()
        actual.body!!.writeTo(buffer)
        assertEquals(sent.body, buffer.readUtf8())
        assertEquals(1, session.tokenCalls)
    }

    @Test fun strictResponseValidation_acceptsIdempotentResultAndRejectsEveryMalformedSecurityField() = runBlocking {
        assertEquals("already_removed", NativeVerificationRemovalPolicy.confirmed(owner,
            NativeVerificationRemovalHttpResponse(200, response("already_removed").toString())).status)
        val mutations: List<(JSONObject) -> Unit> = listOf(
            { it.put("ok", "true") },
            { it.put("ok", false) },
            { it.remove("data") },
            { it.getJSONObject("data").put("status", "pending") },
            { it.getJSONObject("data").put("user_id", other) },
            { it.getJSONObject("data").remove("user_id") },
            { it.getJSONObject("data").put("username_unlocked", "true") },
            { it.getJSONObject("data").put("username_unlocked", false) },
            { it.getJSONObject("data").remove("username_unlocked") },
            { it.getJSONObject("data").getJSONObject("profile").put("id", other) },
            { it.getJSONObject("data").getJSONObject("profile").put("is_verified", true) },
            { it.getJSONObject("data").getJSONObject("profile").put("is_verified", "false") },
            { it.getJSONObject("data").getJSONObject("profile").remove("is_verified") },
            { it.getJSONObject("data").getJSONObject("profile").put("verification_badge_type", "team") },
            { it.getJSONObject("data").getJSONObject("profile").remove("verification_badge_type") },
            { it.getJSONObject("data").remove("profile") },
        )
        mutations.forEachIndexed { index, mutate ->
            val candidate = response().also(mutate)
            val failure = denied {
                NativeVerificationRemovalPolicy.confirmed(owner,
                    NativeVerificationRemovalHttpResponse(200, candidate.toString()))
            }
            assertEquals("Malformed response case $index", NativeVerificationRemovalPolicy.unconfirmed, failure.message)
        }
        listOf("", "<html>error</html>", "null", "{}", "[]").forEach { body ->
            denied { NativeVerificationRemovalPolicy.confirmed(owner, NativeVerificationRemovalHttpResponse(200, body)) }
        }
        listOf(201, 202, 204, 301, 400, 401, 403, 409, 429, 503).forEach { code ->
            assertEquals(code, denied { NativeVerificationRemovalPolicy.confirmed(owner,
                NativeVerificationRemovalHttpResponse(code, response().toString())) }.httpStatus)
        }
    }

    @Test fun signedOutWrongOwnerStagingAndMalformedUuid_neverAcquireTokenOrPost() = runBlocking {
        val session = Session(null)
        var writes = 0
        val client = NativeVerificationRemovalClient(session, NativeVerificationRemovalTransport { _, _, _ ->
            writes++; NativeVerificationRemovalHttpResponse(200, response().toString())
        })
        denied { client.removeVerification(owner, requestId) }
        session.ownerId = other
        denied { client.removeVerification(owner, requestId) }
        session.ownerId = owner
        session.isProduction = false
        denied { client.removeVerification(owner, requestId) }
        session.isProduction = true
        denied { client.removeVerification(owner, "not-a-uuid") }
        assertEquals(0, session.tokenCalls)
        assertEquals(0, writes)
    }

    @Test fun accountChangesWhileAcquiringToken_preventAnyPost() = runBlocking {
        listOf<String?>(null, other).forEach { nextOwner ->
            val session = Session(owner)
            val token = CompletableDeferred<String>()
            session.token = { token.await() }
            var writes = 0
            val client = NativeVerificationRemovalClient(session, NativeVerificationRemovalTransport { _, _, _ ->
                writes++; NativeVerificationRemovalHttpResponse(200, response().toString())
            })
            val pending = async(start = CoroutineStart.UNDISPATCHED) {
                denied { client.removeVerification(owner, requestId) }
            }
            assertEquals(1, session.tokenCalls)
            session.ownerId = nextOwner
            token.complete("offline-access-token-fixture")
            assertEquals(NativeVerificationRemovalPolicy.changedAccount, pending.await().message)
            assertEquals(0, writes)
        }
    }

    @Test fun pendingReplyAfterAccountSwitch_neverReturnsConfirmedLocalResult_andDuplicateIsBlocked() = runBlocking {
        val session = Session(owner)
        val pendingResponse = CompletableDeferred<NativeVerificationRemovalHttpResponse>()
        var writes = 0
        val client = NativeVerificationRemovalClient(session, NativeVerificationRemovalTransport { _, _, _ ->
            writes++; pendingResponse.await()
        })
        val first = async(start = CoroutineStart.UNDISPATCHED) { denied { client.removeVerification(owner, requestId) } }
        assertEquals(1, writes)
        assertTrue(denied { client.removeVerification(owner, requestId) }.message!!.contains("already in progress"))
        assertEquals(1, writes)
        session.ownerId = other
        pendingResponse.complete(NativeVerificationRemovalHttpResponse(200, response().toString()))
        assertEquals(NativeVerificationRemovalPolicy.changedAccount, first.await().message)
        assertEquals(1, writes)
    }

    @Test fun failedRequest_canRetryTheSameIdempotencyKey_withoutAcceptingAnUnconfirmedResult() = runBlocking {
        val session = Session(owner)
        val ids = mutableListOf<String>()
        var attempt = 0
        val client = NativeVerificationRemovalClient(session, NativeVerificationRemovalTransport { _, _, body ->
            ids += JSONObject(body).getString("request_id")
            if (attempt++ == 0) throw java.io.IOException("offline fixture")
            NativeVerificationRemovalHttpResponse(200, response("already_removed").toString())
        })
        denied { client.removeVerification(owner, requestId) }
        assertEquals("already_removed", client.removeVerification(owner, requestId).status)
        assertEquals(listOf(requestId, requestId), ids)
    }
}
