package com.sautilink.nativeapp.feature.integrity

import android.content.Context
import com.google.android.gms.tasks.Task
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.StandardIntegrityException
import com.google.android.play.core.integrity.StandardIntegrityManager
import com.google.android.play.core.integrity.StandardIntegrityManager.PrepareIntegrityTokenRequest
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenRequest
import com.google.android.play.core.integrity.model.StandardIntegrityErrorCode
import com.sautilink.nativeapp.BuildConfig
import com.sautilink.nativeapp.feature.auth.SautiBackend
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Infrequent authenticated Play Integrity observations during closed testing.
 * This is deliberately a separate, best-effort task: no auth/content request depends on it,
 * and no integrity verdict, exception, or unavailable Google service changes app access.
 * Tokens and hashes stay in memory, are never logged, and are sent only to the fixed backend.
 */
object NativePlayIntegrityMonitor {
    private const val ENDPOINT = "/functions/v1/sautilink-play-integrity"
    private const val MAX_RESPONSE_BYTES = 16L * 1024L
    private val observationLock = Mutex()
    private val http = OkHttpClient.Builder()
        .callTimeout(15, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .retryOnConnectionFailure(false)
        .build()

    suspend fun syncIfDue(context: Context, auth: StagingAuthClient) {
        // Preview/staging must never issue production integrity observations.
        if (BuildConfig.APPLICATION_ID != "com.sautilink.app" || BuildConfig.DEBUG ||
            auth.backend != SautiBackend.PRODUCTION || !auth.configured) return
        val accountId = auth.account?.id ?: return
        if (auth.cachedAccessTokenForObservation(accountId) == null) return
        if (!observationLock.tryLock()) return
        try {
            val store = context.applicationContext.getSharedPreferences(
                "sautilink_play_integrity_monitor_v1", Context.MODE_PRIVATE)
            val now = System.currentTimeMillis()
            if (!PlayIntegrityMonitorPolicy.due(now, BuildConfig.VERSION_CODE,
                    store.getInt("version_code", 0), store.getLong("scheduled_at_ms", 0),
                    store.getLong("retry_at_ms", 0))) return

            fun schedule(recorded: Boolean, serverSeconds: Long? = null) {
                val scheduledAt = System.currentTimeMillis()
                // Only scheduling metadata is persisted; never user IDs, tokens, or verdicts.
                store.edit().putInt("version_code", BuildConfig.VERSION_CODE)
                    .putLong("scheduled_at_ms", scheduledAt)
                    .putLong("retry_at_ms", scheduledAt +
                        PlayIntegrityMonitorPolicy.retryDelayMillis(recorded, serverSeconds)).apply()
            }

            // Reserve the attempt before any suspension to bound cancellation/restart loops.
            schedule(recorded = false)
            withTimeoutOrNull(120_000L) {
                val response = post(auth, accountId, JSONObject()
                    .put("action", "challenge").put("version_code", BuildConfig.VERSION_CODE))
                if (response.optString("mode") != PlayIntegrityMonitorPolicy.MODE) return@withTimeoutOrNull
                val challenge = PlayIntegrityMonitorPolicy.challenge(
                    mode = response.optString("mode"),
                    id = response.optString("challenge_id"),
                    requestHash = response.optString("request_hash"),
                    projectNumber = response.optString("cloud_project_number"),
                    expiresAtMillis = response.optLong("expires_at_ms", 0),
                    nowMillis = System.currentTimeMillis())
                if (challenge == null) {
                    schedule(recorded = false, serverSeconds = response.retrySeconds())
                    return@withTimeoutOrNull
                }
                // The backend binds this challenge to its authenticated user/session and
                // checks Google's decoded package/hash/freshness/app/certificate signals.
                val receipt = submitPlayIntegrityObservation(challenge,
                    accountStillCurrent = { auth.account?.id == accountId },
                    nowMillis = System::currentTimeMillis,
                    requestToken = { requestToken(context.applicationContext, it) },
                    submitToken = { pending, token ->
                        val result = post(auth, accountId, JSONObject().put("action", "observe")
                            .put("challenge_id", pending.id).put("integrity_token", token))
                        PlayIntegrityObservationReceipt(result.optString("mode"),
                            result.optString("status"), result.retrySeconds())
                    })
                if (receipt?.mode == PlayIntegrityMonitorPolicy.MODE) {
                    schedule(recorded = receipt.status == "recorded", serverSeconds = receipt.retrySeconds)
                }
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            // Monitoring failures are intentionally silent. Existing app/auth behavior continues.
        } finally {
            observationLock.unlock()
        }
    }

    private fun JSONObject.retrySeconds(): Long? =
        if (has("retry_after_seconds") && !isNull("retry_after_seconds"))
            optLong("retry_after_seconds", PlayIntegrityMonitorPolicy.FAILURE_INTERVAL_SECONDS) else null

    private suspend fun requestToken(context: Context, challenge: PlayIntegrityChallenge): String {
        val manager = IntegrityManagerFactory.createStandard(context)
        suspend fun prepare(): StandardIntegrityManager.StandardIntegrityTokenProvider = withTimeout(60_000L) {
            manager.prepareIntegrityToken(PrepareIntegrityTokenRequest.builder()
                .setCloudProjectNumber(challenge.cloudProjectNumber).build()).awaitCancellable()
        }
        var provider = prepare()
        val request = StandardIntegrityTokenRequest.builder().setRequestHash(challenge.requestHash).build()
        val response = try {
            withTimeout(30_000L) { provider.request(request).awaitCancellable() }
        } catch (error: StandardIntegrityException) {
            if (error.errorCode != StandardIntegrityErrorCode.INTEGRITY_TOKEN_PROVIDER_INVALID) throw error
            // Google recommends preparing a replacement for an expired provider. Retry once.
            provider = prepare()
            withTimeout(30_000L) { provider.request(request).awaitCancellable() }
        }
        return response.token()
    }

    private suspend fun post(auth: StagingAuthClient, accountId: String, payload: JSONObject): JSONObject {
        if (auth.account?.id != accountId) throw CancellationException("Integrity account changed")
        val jwt = auth.cachedAccessTokenForObservation(accountId)
            ?: throw IOException("Integrity observation session is unavailable")
        if (auth.account?.id != accountId) throw CancellationException("Integrity account changed")
        val request = Request.Builder().url(auth.backend.supabaseOrigin + ENDPOINT)
            .header("apikey", auth.publicKeyForRead()).header("Authorization", "Bearer $jwt")
            .header("Accept", "application/json")
            .post(payload.toString().toRequestBody("application/json".toMediaType())).build()
        return suspendCancellableCoroutine { continuation ->
            val call = http.newCall(request)
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, error: IOException) {
                    if (continuation.isActive) continuation.resumeWithException(
                        IOException("Integrity observation request is unavailable"))
                }

                override fun onResponse(call: Call, response: Response) {
                    val result = try {
                        response.use {
                            if (!it.isSuccessful) throw IOException("Integrity observation was not accepted")
                            val text = it.peekBody(MAX_RESPONSE_BYTES + 1L).use { body ->
                                if (body.contentLength() > MAX_RESPONSE_BYTES) {
                                    throw IOException("Integrity observation response is too large")
                                }
                                body.string()
                            }
                            Result.success(JSONObject(text))
                        }
                    } catch (_: Exception) {
                        Result.failure<JSONObject>(IOException("Integrity observation response is unavailable"))
                    }
                    if (continuation.isActive) continuation.resumeWith(result)
                }
            })
        }
    }

    /** Observe Google Task completion without blocking a thread or retaining any result on disk. */
    private suspend fun <T> Task<T>.awaitCancellable(): T = suspendCancellableCoroutine { continuation ->
        addOnCompleteListener { task ->
            if (continuation.isActive) {
                when {
                    task.isCanceled -> continuation.cancel()
                    task.isSuccessful -> continuation.resume(task.result)
                    else -> continuation.resumeWithException(task.exception
                        ?: IOException("Integrity observation service is unavailable"))
                }
            }
        }
    }
}
