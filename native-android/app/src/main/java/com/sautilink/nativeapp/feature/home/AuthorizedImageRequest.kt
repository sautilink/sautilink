package com.sautilink.nativeapp.feature.home

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Response
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal class AuthorizedImageHttpFailure(val status: Int, val retryAfter: String? = null) :
    IOException("Image unavailable (HTTP $status)")

internal class AuthorizedImageContentFailure(message: String) : IOException(message)

/** A failed token acquisition may recover on a later reconnect/resume, but is
 * never replayed by the GET retry loop. Explicit auth denials stay non-transient.
 */
internal fun authorizedImageEnvironmentRecovery(error: Exception): Boolean = when (error) {
    is IOException -> authorizedImageRetryDelay(error) != null
    is AuthRequestException -> error.httpStatus?.let { it in setOf(408, 429) || it in 500..599 }
        ?: (error.cause is IOException)
    else -> false
}

/** Never shorten a long server cooldown to our retry budget. Such a failure stays
 * visible for an explicit later retry, rather than immediately making another GET.
 */
internal fun authorizedImageRetryDelay(error: IOException, nowMillis: Long = System.currentTimeMillis()): Long? {
    if (error is AuthorizedImageContentFailure) return null
    if (error is AuthorizedImageHttpFailure) {
        if (error.status !in setOf(408, 429) && error.status !in 500..599) return null
        val header = error.retryAfter?.trim()?.takeIf(String::isNotEmpty)
        if (header != null && header.all(Char::isDigit) && header.toLongOrNull() == null) return null
        val wait = header?.toLongOrNull()?.takeIf { it >= 0L }?.let {
            if (it > 5L) return null
            it * 1_000L
        } ?: header?.let {
            runCatching { ZonedDateTime.parse(it, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli() - nowMillis }
                .getOrNull()?.coerceAtLeast(0L)
        }
        if (wait != null && wait > 5_000L) return null
        return maxOf(600L, wait ?: 0L)
    }
    return 600L // Socket/DNS/connection I/O only; decoding is outside this boundary.
}

/** At most two idempotent GET attempts. Scope and cancellation are checked again
 * after backoff; neither an obsolete cell nor a signed-out account starts a retry.
 */
internal suspend fun authorizedImageBytesWithRetry(
    newCall: () -> Call,
    stillEligible: () -> Boolean,
    pause: suspend (Long) -> Unit = { delay(it) },
    nowMillis: () -> Long = System::currentTimeMillis,
): ByteArray {
    var retries = 0
    while (true) {
        currentCoroutineContext().ensureActive()
        if (!stillEligible()) throw CancellationException("Image read scope ended")
        try {
            val call = newCall()
            require(call.request().method == "GET" && call.request().body == null) { "Only image GET reads may retry" }
            return awaitAuthorizedImageBytes(call)
        }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (error: IOException) {
            if (retries >= 1) throw error
            val backoff = authorizedImageRetryDelay(error, nowMillis()) ?: throw error
            retries++
            pause(backoff)
        }
    }
}

/** Cancelling a recycled cell cancels its socket too. Both declared and chunked
 * image bodies are bounded before bitmap decoding; response bodies always close.
 */
internal suspend fun awaitAuthorizedImageBytes(call: Call, limit: Int = 12 * 1024 * 1024): ByteArray =
    suspendCancellableCoroutine { continuation ->
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, error: IOException) {
                if (continuation.isActive) continuation.resumeWithException(error)
            }
            override fun onResponse(call: Call, response: Response) {
                try {
                    response.use {
                        if (!response.isSuccessful) throw AuthorizedImageHttpFailure(response.code, response.header("Retry-After"))
                        val body = response.body ?: throw AuthorizedImageContentFailure("Media unavailable")
                        if (body.contentType()?.type != "image") throw AuthorizedImageContentFailure("Response was not an image")
                        if (body.contentLength() > limit) throw AuthorizedImageContentFailure("Image is too large")
                        val bytes = ByteArrayOutputStream()
                        val buffer = ByteArray(8192)
                        body.byteStream().use { stream ->
                            while (continuation.isActive) {
                                val count = stream.read(buffer)
                                if (count < 0) break
                                if (bytes.size() + count > limit) throw AuthorizedImageContentFailure("Image is too large")
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
