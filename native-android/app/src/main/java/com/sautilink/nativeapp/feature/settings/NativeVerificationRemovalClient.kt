package com.sautilink.nativeapp.feature.settings

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

internal object NativeVerificationRemovalPolicy {
    const val title = "Remove verification?"
    const val confirmLabel = "Remove verification"
    const val cancelLabel = "Keep verification"
    const val warning = "Your verification checkmark will be removed from your account. Your username will follow the normal change limits. To become verified again, you must submit a new application and complete every verification step again. Being verified before does not guarantee approval of a future application. This removal cannot be undone."
    const val success = "Verification removed. Normal username change limits apply. To get verified again, submit a new application and complete the full review process; approval is not guaranteed."
    const val unconfirmed = "Verification removal could not be confirmed. Refresh your settings before trying again."
    const val changedAccount = "Your account session changed. Open settings again before removing verification."
    const val confirmation = "remove-verification-v1"
    const val endpoint = "https://sautilink.com/api/account/verification/remove"
    private val uuid = Regex("^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$")

    fun validId(value: String?): Boolean = value != null && uuid.matches(value)

    fun verifiedOwner(ownerId: String?, profileOwnerId: Any?, rawVerified: Any?): Boolean =
        validId(ownerId) && ownerId == profileOwnerId && rawVerified == true

    fun eligible(ownerId: String?, profileOwnerId: String?, verified: Boolean, loading: Boolean): Boolean =
        validId(ownerId) && ownerId == profileOwnerId && verified && !loading

    /** Do not accept strings such as "false" in security-sensitive response fields. */
    fun confirmed(ownerId: String, response: NativeVerificationRemovalHttpResponse): NativeVerificationRemovalResult {
        if (response.statusCode != 200) throw AuthRequestException(when (response.statusCode) {
            401, 403 -> "Verification removal access denied. Sign in again."
            409 -> "Your verification state changed. Refresh settings before trying again."
            429 -> "Please wait a moment before trying to remove verification again."
            in 500..599 -> "Verification removal is temporarily unavailable. Please try again later."
            else -> "Could not remove verification (HTTP ${response.statusCode})."
        }, response.statusCode)
        val envelope = runCatching { JSONObject(response.body) }.getOrNull()
            ?: throw AuthRequestException(unconfirmed)
        val data = envelope.optJSONObject("data") ?: throw AuthRequestException(unconfirmed)
        val profile = data.optJSONObject("profile") ?: throw AuthRequestException(unconfirmed)
        val status = data.opt("status")
        if (!validId(ownerId) || envelope.opt("ok") != true ||
            status !in setOf("removed", "already_removed") || data.opt("user_id") != ownerId ||
            profile.opt("id") != ownerId || profile.opt("is_verified") != false ||
            profile.opt("verification_badge_type") != "standard" || data.opt("username_unlocked") != true) {
            throw AuthRequestException(unconfirmed)
        }
        return NativeVerificationRemovalResult(ownerId, status as String)
    }
}

internal data class NativeVerificationRemovalResult(val ownerId: String, val status: String)

internal interface NativeVerificationRemovalGateway {
    suspend fun removeVerification(ownerId: String, requestId: String): NativeVerificationRemovalResult
}

/** Injectable session and transport keep protocol/race checks testable without Auth or a network. */
internal interface NativeVerificationRemovalSession {
    val ownerId: String?
    val isProduction: Boolean
    suspend fun accessToken(): String
}

internal data class NativeVerificationRemovalHttpResponse(val statusCode: Int, val body: String)

internal fun interface NativeVerificationRemovalTransport {
    suspend fun post(url: String, accessToken: String, body: String): NativeVerificationRemovalHttpResponse
}

internal fun verificationRemovalHttpRequest(url: String, accessToken: String, body: String): Request =
    Request.Builder().url(url)
        .header("Authorization", "Bearer $accessToken")
        .header("Accept", "application/json")
        .header("Cache-Control", "no-store")
        .post(body.toRequestBody("application/json".toMediaType())).build()

internal class NativeVerificationRemovalHttpTransport : NativeVerificationRemovalTransport {
    // Never replay a destructive request automatically or forward its Bearer token to a redirect.
    private val http = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false).followRedirects(false).followSslRedirects(false).build()

    override suspend fun post(url: String, accessToken: String, body: String): NativeVerificationRemovalHttpResponse =
        withContext(Dispatchers.IO) {
            currentCoroutineContext().ensureActive()
            val request = verificationRemovalHttpRequest(url, accessToken, body)
            http.newCall(request).execute().use { response ->
                NativeVerificationRemovalHttpResponse(response.code,
                    response.body?.string()?.take(48_000).orEmpty())
            }
        }
}

internal class NativeVerificationRemovalClient(
    private val session: NativeVerificationRemovalSession,
    private val transport: NativeVerificationRemovalTransport = NativeVerificationRemovalHttpTransport()
) : NativeVerificationRemovalGateway {
    private val inFlight = Mutex()

    private fun requireOwner(ownerId: String) {
        if (!session.isProduction) throw AuthRequestException("Verification removal is available on production only.")
        if (!NativeVerificationRemovalPolicy.validId(ownerId) || session.ownerId != ownerId)
            throw AuthRequestException(NativeVerificationRemovalPolicy.changedAccount)
    }

    override suspend fun removeVerification(ownerId: String, requestId: String): NativeVerificationRemovalResult {
        requireOwner(ownerId)
        if (!NativeVerificationRemovalPolicy.validId(requestId))
            throw AuthRequestException("Open the verification removal confirmation again before continuing.")
        if (!inFlight.tryLock()) throw AuthRequestException("Verification removal is already in progress.")
        try {
            currentCoroutineContext().ensureActive()
            val token = session.accessToken()
            requireOwner(ownerId)
            if (token.isBlank()) throw AuthRequestException("Sign in again before removing verification.")
            currentCoroutineContext().ensureActive()
            val payload = JSONObject().put("request_id", requestId)
                .put("confirmation", NativeVerificationRemovalPolicy.confirmation)
            val response = transport.post(NativeVerificationRemovalPolicy.endpoint, token, payload.toString())
            currentCoroutineContext().ensureActive()
            requireOwner(ownerId)
            return NativeVerificationRemovalPolicy.confirmed(ownerId, response)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: AuthRequestException) {
            throw error
        } catch (_: Exception) {
            throw AuthRequestException("Could not connect to verification removal. Your removal was not confirmed; refresh settings before trying again.")
        } finally {
            inFlight.unlock()
        }
    }
}
