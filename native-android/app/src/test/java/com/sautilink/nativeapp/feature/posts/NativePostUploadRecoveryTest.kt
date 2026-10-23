package com.sautilink.nativeapp.feature.posts

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import javax.net.ssl.SSLHandshakeException

class NativePostUploadRecoveryTest {
    private val ready get() = JSONObject().put("id", "existing-id").put("ready", true)
    private fun plan(chunked: Boolean = false) = NativePostUploadPlan("/same-upload-id", 20L, if (chunked) 3 else 1, chunked, "/same-completion")

    @Test fun lostSinglePutResponseConfirmsCommitWithoutResendingBytes() = runBlocking {
        var transfers = 0; var confirmations = 0
        val result = finishNativePostUpload(plan(), {}, { transfers++; throw IOException("lost response") },
            { fail("single transfer must not complete multipart") }, { confirmations++; ready }, { fail("already committed") })
        assertTrue(result.getBoolean("ready"))
        assertEquals(1, transfers); assertEquals(1, confirmations)
    }

    @Test fun interruptedSinglePutRetriesSameTransferOnlyAfterServerConfirmsItIsNotReady() = runBlocking {
        val calls = mutableListOf<String>()
        var attempts = 0
        val result = finishNativePostUpload(plan(), {}, {
            calls += "transfer"
            if (++attempts == 1) throw AuthRequestException("network", cause = IOException())
        }, {}, {
            calls += "confirm"
            if (attempts == 1) throw AuthRequestException("not uploaded", 404)
            ready
        }, { calls += "wait" })
        assertTrue(result.getBoolean("ready"))
        assertEquals(listOf("transfer", "confirm", "wait", "transfer", "confirm"), calls)
    }

    @Test fun chunkFailureResendsOnlyFailedPartAndCompletionAndFinalizationCanRecover() = runBlocking {
        val parts = mutableListOf<Int>(); var completed = 0; var finalized = 0
        finishNativePostUpload(plan(true), {}, { part ->
            parts += part
            if (part == 2 && parts.count { it == 2 } == 1) throw IOException("interrupted")
        }, { if (++completed == 1) throw AuthRequestException("temporarily unavailable", 503) },
            { if (++finalized == 1) throw IOException("lost final response"); ready }, {})
        assertEquals(listOf(1, 2, 2, 3), parts)
        assertEquals(2, completed); assertEquals(2, finalized)
    }

    @Test fun retriesAreBoundedAndNeverHideAuthorizationOrValidationFailures() = runBlocking {
        var attempts = 0
        try {
            finishNativePostUpload(plan(true), {}, { attempts++; throw IOException("offline") }, {}, { ready }, {})
            fail("must retain failure")
        } catch (_: IOException) { assertEquals(3, attempts) }
        for (status in listOf(400, 401, 403, 404, 409, 413, 415, 429)) {
            attempts = 0
            try {
                finishNativePostUpload(plan(), {}, { attempts++; throw AuthRequestException("denied", status) }, {},
                    { fail("denied transfer must not probe or finalize"); ready }, {})
                fail("must retain HTTP$status")
            } catch (error: AuthRequestException) { assertEquals(status, error.httpStatus); assertEquals(1, attempts) }
        }
    }

    @Test fun ownerChangeWhileWaitingPreventsAnotherAuthenticatedRequest() = runBlocking {
        var owner = true; var attempts = 0
        try {
            finishNativePostUpload(plan(true), { if (!owner) throw CancellationException("owner changed") },
                { attempts++; throw IOException("interrupted") }, {}, { ready }, { owner = false })
            fail("must cancel")
        } catch (_: CancellationException) { assertEquals(1, attempts) }
        assertFalse(retryablePostUploadFailure(IOException("cancelled body", CancellationException())))
        assertFalse(retryablePostUploadFailure(IOException("owner changed", AuthRequestException("changed"))))
        assertFalse(retryablePostUploadFailure(SSLHandshakeException("certificate")))
    }

    @Test fun serverValidationFailureAfterLostPutDoesNotResendTheFile() = runBlocking {
        var transfers = 0
        try {
            finishNativePostUpload(plan(), {}, { transfers++; throw IOException("lost response") }, {},
                { throw AuthRequestException("stored media failed validation", 409) }, { fail("must not retry validation") })
            fail("must keep validation failure")
        } catch (error: AuthRequestException) {
            assertEquals(409, error.httpStatus); assertEquals(1, transfers)
        }
    }
}
