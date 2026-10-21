package com.sautilink.nativeapp.feature.home

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Response
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal class FollowReadHttpFailure(val status: Int, val retryAfter: String? = null) : IOException("Follow status unavailable (HTTP $status).")
internal class FollowReadContentFailure : IOException("Follow status response was invalid.")

/** An empty valid array means no follows. Malformed or cross-batch rows mean unknown, never false. */
internal fun validatedFollowReadIds(requested: Set<String>, returned: List<Any?>): Set<String> {
    val uuid = Regex("[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")
    if (requested.any { !uuid.matches(it) } || returned.any { it !is String || !uuid.matches(it) || it !in requested })
        throw FollowReadContentFailure()
    return returned.filterIsInstance<String>().toSet()
}

/** Typed causes only. A denial, bad response or long server cooldown never becomes a blind retry. */
internal fun followReadRetryDelay(error: Throwable, nowMillis: Long = System.currentTimeMillis()): Long? {
    val causes = generateSequence(error) { it.cause }.take(8).toList()
    if (causes.any { it is CancellationException || it is FollowReadContentFailure }) return null
    val http = causes.filterIsInstance<FollowReadHttpFailure>().firstOrNull()
    val status = http?.status ?: causes.filterIsInstance<AuthRequestException>().firstNotNullOfOrNull { it.httpStatus }
    if (status != null) {
        if (status !in setOf(408, 429) && status !in 500..599) return null
        val header = http?.retryAfter?.trim()?.takeIf(String::isNotEmpty)
        if (header != null && header.all(Char::isDigit) && header.toLongOrNull() == null) return null
        val wait = header?.toLongOrNull()?.takeIf { it >= 0L }?.let {
            if (it > 5L) return null
            it * 1_000L
        } ?: header?.let { runCatching {
            ZonedDateTime.parse(it, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli() - nowMillis
        }.getOrNull()?.coerceAtLeast(0L) }
        if (wait != null && wait > 5_000L) return null
        return maxOf(600L, wait ?: 0L)
    }
    return if (causes.any { it is IOException }) 600L else null
}

/** Exactly one extra idempotent GET. The account is rechecked after backoff and after the response. */
internal suspend fun followReadBytesWithRetry(newCall: () -> Call, stillCurrent: () -> Boolean,
    pause: suspend (Long) -> Unit = { delay(it) }, nowMillis: () -> Long = System::currentTimeMillis): ByteArray {
    var retried = false
    while (true) {
        currentCoroutineContext().ensureActive()
        if (!stillCurrent()) throw CancellationException("Follow read scope ended")
        try {
            val call = newCall()
            require(call.request().method == "GET" && call.request().body == null) { "Only Follow GET reads may retry" }
            val bytes = awaitFollowReadBytes(call)
            currentCoroutineContext().ensureActive()
            if (!stillCurrent()) throw CancellationException("Follow read scope ended")
            return bytes
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: IOException) {
            if (retried) throw error
            val wait = followReadRetryDelay(error, nowMillis()) ?: throw error
            retried = true
            pause(wait)
        }
    }
}

/** Cancel a recycled feed's socket and close late bodies without reading them. JSON decoding is outside retry. */
internal suspend fun awaitFollowReadBytes(call: Call, limit: Int = 65_536): ByteArray =
    suspendCancellableCoroutine { continuation ->
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, error: IOException) {
                if (continuation.isActive) continuation.resumeWithException(error)
            }
            override fun onResponse(call: Call, response: Response) {
                try {
                    response.use {
                        if (!continuation.isActive) return
                        if (!response.isSuccessful) throw FollowReadHttpFailure(response.code, response.header("Retry-After"))
                        val body = response.body ?: throw FollowReadContentFailure()
                        if (body.contentType()?.subtype?.contains("json") != true || body.contentLength() > limit) throw FollowReadContentFailure()
                        val bytes = ByteArrayOutputStream()
                        body.byteStream().use { stream ->
                            val buffer = ByteArray(2_048)
                            while (continuation.isActive) {
                                val count = stream.read(buffer)
                                if (count < 0) break
                                if (bytes.size() + count > limit) throw FollowReadContentFailure()
                                bytes.write(buffer, 0, count)
                            }
                        }
                        if (continuation.isActive) continuation.resume(bytes.toByteArray())
                    }
                } catch (error: Exception) {
                    if (continuation.isActive) continuation.resumeWithException(error)
                }
            }
        })
    }
