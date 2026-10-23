package com.sautilink.nativeapp.feature.home

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Response
import org.json.JSONArray
import java.io.ByteArrayOutputStream
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal data class NativeFeedDetails(val posts: JSONArray, val authors: JSONArray, val media: JSONArray)

/** Only media is independent. Profiles still resolve from the returned posts;
 * no partial projection escapes if either branch fails or its owner changes. */
internal suspend fun readNativeFeedDetails(checkOwner: () -> Unit,
    readPosts: suspend () -> JSONArray, readAuthors: suspend (JSONArray) -> JSONArray,
    readMedia: suspend () -> JSONArray): NativeFeedDetails = coroutineScope {
    suspend fun guard() { currentCoroutineContext().ensureActive(); checkOwner() }
    guard()
    val postAndAuthors = async {
        guard()
        val posts = readPosts()
        guard()
        val authors = readAuthors(posts)
        guard()
        posts to authors
    }
    val media = async { guard(); readMedia().also { guard() } }
    val (posts, authors) = postAndAuthors.await()
    val mediaRows = media.await()
    guard()
    NativeFeedDetails(posts, authors, mediaRows)
}

/** Single, cancellable GET with the existing feed HTTP messages. No request is
 * retried here. A cancelled sibling closes any late body without reading it. */
internal suspend fun awaitNativeFeedDetailRows(call: Call): JSONArray {
    require(call.request().method == "GET" && call.request().body == null)
    return suspendCancellableCoroutine { continuation ->
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, error: IOException) {
                if (continuation.isActive) continuation.resumeWithException(
                    AuthRequestException("Could not load feed. Check internet and try again."))
            }
            override fun onResponse(call: Call, response: Response) {
                try {
                    response.use {
                        if (!continuation.isActive) return
                        val status = response.code
                        if (status !in 200..299) throw AuthRequestException(when (status) {
                            401, 403 -> "Session expired or feed permission denied. Sign in again."
                            404 -> "Feed endpoint is unavailable."
                            429 -> "Too many requests. Try again shortly."
                            in 500..599 -> "Feed server is temporarily unavailable."
                            else -> "Could not load posts (HTTP $status)."
                        }, status)
                        val body = response.body ?: throw IOException("Missing feed response")
                        if (body.contentLength() > 400_000L) throw IOException("Feed response exceeded limit")
                        val bytes = ByteArrayOutputStream()
                        body.byteStream().use { stream ->
                            val buffer = ByteArray(2_048)
                            while (continuation.isActive) {
                                val count = stream.read(buffer)
                                if (count < 0) break
                                if (bytes.size() + count > 400_000) throw IOException("Feed response exceeded limit")
                                bytes.write(buffer, 0, count)
                            }
                        }
                        if (continuation.isActive) continuation.resume(JSONArray(bytes.toString(Charsets.UTF_8.name())))
                    }
                } catch (error: Exception) {
                    if (continuation.isActive) continuation.resumeWithException(
                        if (error is AuthRequestException) error else AuthRequestException("Could not load feed. Check internet and try again."))
                }
            }
        })
    }
}
