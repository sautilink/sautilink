package com.sautilink.nativeapp.feature.home

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okio.Buffer
import okio.BufferedSource
import okio.ForwardingSource
import okio.Timeout
import okio.buffer
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class NativeFeedDetailReadsTest {
    private class Body(bytes: ByteArray, private val declared: Long = bytes.size.toLong()) : ResponseBody() {
        var closed = false
        var read = 0L
        private val input = object : ForwardingSource(Buffer().write(bytes)) {
            override fun read(sink: Buffer, byteCount: Long): Long = super.read(sink, byteCount).also { if (it > 0) read += it }
            override fun close() { closed = true; super.close() }
        }.buffer()
        override fun contentType() = "application/json".toMediaType()
        override fun contentLength() = declared
        override fun source(): BufferedSource = input
    }
    private class FakeCall(private val action: ((FakeCall) -> Unit)? = null, method: String = "GET") : Call {
        private val request = Request.Builder().url("https://fixture.supabase.co/rest/v1/social_posts")
            .method(method, if (method == "POST") "{}".toRequestBody("application/json".toMediaType()) else null).build()
        lateinit var callback: Callback
        var cancelled = false
        var enqueued = 0
        override fun request() = request
        override fun execute(): Response = error("Asynchronous synthetic feed only")
        override fun enqueue(responseCallback: Callback) { callback=responseCallback;enqueued++;action?.invoke(this) }
        override fun cancel() { cancelled=true }
        override fun isExecuted() = enqueued>0
        override fun isCanceled() = cancelled
        override fun timeout() = Timeout.NONE
        override fun clone(): Call = FakeCall(action, request.method)
        fun respond(body: Body, status: Int = 200) = callback.onResponse(this,
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(status).message("Fixture").body(body).build())
        fun fail() = callback.onFailure(this,IOException("Synthetic transport failure"))
    }
    private suspend fun enqueued(vararg calls: FakeCall) = withTimeout(2_000L) {
        while (calls.any { it.enqueued==0 }) yield()
    }
    private fun body(value: String = "[]") = Body(value.toByteArray())

    @Test fun postAndMediaStartTogether_whileProfilesWaitForTheReturnedPostAuthors() = runBlocking {
        val postsStarted=CompletableDeferred<Unit>();val mediaStarted=CompletableDeferred<Unit>()
        val allowPosts=CompletableDeferred<Unit>();val allowMedia=CompletableDeferred<Unit>()
        val profilesStarted=CompletableDeferred<Unit>();val allowProfiles=CompletableDeferred<Unit>()
        val posts=JSONArray("[{\"id\":\"post\",\"author_id\":\"actual-author\"}]")
        val authors=JSONArray("[{\"id\":\"actual-author\"}]")
        val media=JSONArray("[{\"post_id\":\"post\"}]")
        val work=async {
            readNativeFeedDetails({},readPosts={ postsStarted.complete(Unit);allowPosts.await();posts },
                readAuthors={ returned ->
                    assertSame(posts,returned)
                    assertEquals("actual-author",returned.getJSONObject(0).getString("author_id"))
                    profilesStarted.complete(Unit);allowProfiles.await();authors
                },readMedia={ mediaStarted.complete(Unit);allowMedia.await();media })
        }
        withTimeout(2_000L) { postsStarted.await();mediaStarted.await() }
        assertFalse("Profiles cannot begin before actual post rows return",profilesStarted.isCompleted)
        assertFalse(work.isCompleted)
        allowPosts.complete(Unit)
        withTimeout(2_000L) { profilesStarted.await() }
        assertFalse("The independent media read may still be in flight",work.isCompleted)
        allowProfiles.complete(Unit);allowMedia.complete(Unit)
        val result=work.await()
        assertSame(posts,result.posts);assertSame(authors,result.authors);assertSame(media,result.media)
    }

    @Test fun postDenialCancelsIndependentMedia_andLateBodiesCloseWithoutReadingOrPartialProjection() = runBlocking {
        supervisorScope {
            val posts=FakeCall();val media=FakeCall();val profiles=FakeCall()
            var projected=false
            val work=async {
                readNativeFeedDetails({}, { awaitNativeFeedDetailRows(posts) },
                    { awaitNativeFeedDetailRows(profiles) },{ awaitNativeFeedDetailRows(media) }).also { projected=true }
            }
            enqueued(posts,media)
            val denied=body();posts.respond(denied,403)
            try { work.await();fail("Denied posts cannot return a feed projection") }
            catch (error: AuthRequestException) { assertEquals(403,error.httpStatus) }
            assertTrue(denied.closed);assertTrue(media.cancelled);assertEquals(0,profiles.enqueued)
            val late=body();media.respond(late)
            assertTrue(late.closed);assertEquals(0L,late.read);assertFalse(projected)
        }
    }

    @Test fun mediaFailureCancelsProfilesEvenAfterPostsSucceed_withoutReturningHalfAFeed() = runBlocking {
        supervisorScope {
            val posts=FakeCall();val media=FakeCall();val profiles=FakeCall()
            var projected=false
            val work=async {
                readNativeFeedDetails({}, { awaitNativeFeedDetailRows(posts) },
                    { awaitNativeFeedDetailRows(profiles) },{ awaitNativeFeedDetailRows(media) }).also { projected=true }
            }
            enqueued(posts,media);val postBody=body();posts.respond(postBody)
            enqueued(profiles)
            media.respond(body(),503)
            try { work.await();fail("Media failure cannot return posts with missing media") }
            catch (error: AuthRequestException) { assertEquals(503,error.httpStatus) }
            assertTrue(postBody.closed);assertTrue(profiles.cancelled)
            val late=body();profiles.respond(late)
            assertTrue(late.closed);assertEquals(0L,late.read);assertFalse(projected)
        }
    }

    @Test fun parentCancellationCancelsBothSockets_andNeverReadsLateBodies() = runBlocking {
        val posts=FakeCall();val media=FakeCall()
        var projected=false
        val work=launch {
            readNativeFeedDetails({}, { awaitNativeFeedDetailRows(posts) },
                { fail("Profiles must not start after cancellation");JSONArray() },
                { awaitNativeFeedDetailRows(media) }).also { projected=true }
        }
        enqueued(posts,media);work.cancelAndJoin()
        assertTrue(posts.cancelled);assertTrue(media.cancelled)
        for(call in listOf(posts,media)) {
            val late=body();call.respond(late);assertTrue(late.closed);assertEquals(0L,late.read)
        }
        assertFalse(projected)
    }

    @Test fun ownerChangeAfterPostResponsePreventsProfiles_andCancelsTheOtherRead() = runBlocking {
        supervisorScope {
            val posts=FakeCall();val media=FakeCall();val profiles=FakeCall()
            var current=true
            val work=async {
                readNativeFeedDetails({ if (!current) throw CancellationException("Synthetic owner changed") },
                    { awaitNativeFeedDetailRows(posts) },{ awaitNativeFeedDetailRows(profiles) },
                    { awaitNativeFeedDetailRows(media) })
            }
            enqueued(posts,media);current=false;posts.respond(body())
            try { work.await();fail("An obsolete account must not return a feed") }
            catch (_: CancellationException) { }
            assertTrue(media.cancelled);assertEquals(0,profiles.enqueued)
        }
    }

    @Test fun httpFailureMessagesAndStatusesRemainUnchanged_andNoGetIsRetried() = runBlocking {
        val expected=mapOf(401 to "Session expired or feed permission denied. Sign in again.",
            403 to "Session expired or feed permission denied. Sign in again.",404 to "Feed endpoint is unavailable.",
            429 to "Too many requests. Try again shortly.",503 to "Feed server is temporarily unavailable.",
            307 to "Could not load posts (HTTP 307).")
        for((status,message) in expected) {
            val response=body();val call=FakeCall({ it.respond(response,status) })
            try { awaitNativeFeedDetailRows(call);fail("Expected existing feed HTTP failure") }
            catch (error: AuthRequestException) { assertEquals(status,error.httpStatus);assertEquals(message,error.message) }
            assertEquals(1,call.enqueued);assertTrue(response.closed);assertEquals(0L,response.read)
        }
        val failed=FakeCall({ it.fail() })
        try { awaitNativeFeedDetailRows(failed);fail("Expected existing transport failure") }
        catch (error: AuthRequestException) {
            assertNull(error.httpStatus);assertEquals("Could not load feed. Check internet and try again.",error.message)
        }
        assertEquals(1,failed.enqueued)
    }

    @Test fun invalidDeclaredOrChunkedOversizeJsonFailsClosed_andClosesEveryBody() = runBlocking {
        for(response in listOf(body("not-json"),Body(ByteArray(400_001)),Body(ByteArray(400_001),-1L))) {
            val call=FakeCall({ it.respond(response) })
            try { awaitNativeFeedDetailRows(call);fail("Invalid or oversized feed cannot be projected") }
            catch (error: AuthRequestException) { assertNull(error.httpStatus) }
            assertEquals(1,call.enqueued);assertTrue(response.closed)
        }
    }

    @Test fun detailReaderCannotSendAMutation_andValidArrayIsReturnedOnceAndClosed() = runBlocking {
        val mutation=FakeCall(method="POST")
        try { awaitNativeFeedDetailRows(mutation);fail("Only independent GET reads are allowed") }
        catch (_: IllegalArgumentException) { }
        assertEquals(0,mutation.enqueued)
        val response=body("[{\"id\":\"actual-row\"}]")
        val call=FakeCall({ it.respond(response) })
        assertEquals("actual-row",awaitNativeFeedDetailRows(call).getJSONObject(0).getString("id"))
        assertEquals(1,call.enqueued);assertTrue(response.closed)
    }
}
