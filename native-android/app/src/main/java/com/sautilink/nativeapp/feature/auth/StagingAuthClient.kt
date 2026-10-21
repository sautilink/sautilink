package com.sautilink.nativeapp.feature.auth

import android.content.Context
import android.util.Log
import com.sautilink.nativeapp.network.SautiNetworkPhase
import com.sautilink.nativeapp.network.SautiNetworkSite
import com.sautilink.nativeapp.network.sautiNetworkFailureDiagnostic
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/**
 * Environment-scoped Supabase Auth adapter. Only the refresh token is encrypted on disk.
 * Production registration methods are explicitly prohibited on staging.
 * Uses a PUBLIC publishable key; no service-role credentials are accepted.
 */
enum class StagingSessionState { CHECKING, SIGNED_OUT, SIGNED_IN, RETRYABLE_ERROR }

class StagingAuthClient(
    private val publishableKey: String,
    context: Context,
    val backend: SautiBackend = SautiBackend.STAGING
) {
    private fun canonicalPhone(value: String): String {
        val phone = normalizedSignupPhone(value)
        if (!validSignupPhone(phone)) {
            throw AuthRequestException("Enter a valid phone number including country code.")
        }
        return phone
    }

    private val vault = StagingSessionVault(context, backend)
    private val sessionLock = Mutex()
    private val baseUrl = "${backend.supabaseOrigin}/auth/v1"
    val configured: Boolean get() = publishableKey.startsWith("sb_publishable_")
    val restOrigin: String get() = backend.postgrestOrigin
    val mediaOrigin: String get() = backend.siteOrigin
    private var accessToken: String? = null
    private var currentUser by mutableStateOf<StagingAccount?>(null)
    val account: StagingAccount? get() = currentUser
    var sessionState by mutableStateOf(StagingSessionState.CHECKING)
        private set
    private var tokenExpiresAtMillis = 0L

    suspend fun signInWithPassword(email: String, password: String): StagingAccount {
        val response = request("/token?grant_type=password", "POST",
            JSONObject().put("email", email.trim()).put("password", password))
        return consumeSession(response)
    }

    /** Existing server bridge resolves usernames privately; email/password and OTP stay on Auth. */
    suspend fun signInWithUsername(username: String, password: String): StagingAccount {
        if (backend != SautiBackend.PRODUCTION) {
            throw AuthRequestException("Use your staging email to sign in.")
        }
        if (!validLoginUsername(username) || password.isEmpty() || password.length > 1024) {
            throw AuthRequestException("Incorrect email/username or password.")
        }
        val response = request("/functions/v1/sautilink-username-login", "POST",
            JSONObject().put("username", normalizeLoginUsername(username)).put("password", password),
            origin = backend.supabaseOrigin)
        val session = response.optJSONObject("data")?.optJSONObject("session")
        if (!response.optBoolean("ok") || session == null) {
            throw AuthRequestException("Sign-in did not return a renewable session. Try again.")
        }
        return consumeSession(session)
    }

    /** SautiLink signup uses 8-digit EMAIL OTP; the Auth server, not the app, creates the user. */
    suspend fun createAccount(
        email: String, password: String, username: String, displayName: String, phone: String
    ) {
        requireProductionRegistration()
        val data = JSONObject()
            .put("username", username.trim().lowercase())
            .put("full_name", displayName.trim())
        if (phone.isNotBlank()) data.put("sautilink_signup_phone", canonicalPhone(phone))
        val result = request("/signup", "POST", JSONObject()
            .put("email", email.trim().lowercase())
            .put("password", password)
            .put("data", data))
        val identities = result.optJSONObject("user")?.optJSONArray("identities")
        if (identities != null && identities.length() == 0) {
            throw AuthRequestException("This email may already be registered. Try signing in or recovering your account.")
        }
        // Standard production configuration returns no session until email OTP verification.
        if (result.optString("access_token").isNotBlank()) {
            consumeSession(result)
        }
    }

    suspend fun resendSignupEmailCode(email: String) {
        requireProductionRegistration()
        request("/resend", "POST", JSONObject().put("type", "signup")
            .put("email", email.trim().lowercase()))
    }

    suspend fun acceptSignupDocuments() {
        requireProductionRegistration()
        signedInRpc("accept_signup_terms", JSONObject())
    }

    suspend fun signupRequirements(): SignupRequirements {
        requireProductionRegistration()
        val data = signedInRpc("get_signup_requirements", JSONObject())
        return SignupRequirements(
            required = data.optBoolean("required", true),
            phoneVerified = data.optBoolean("phoneVerified", false),
            termsAccepted = data.optBoolean("termsAccepted", false),
            phoneRequired = data.optBoolean("phoneRequired", true)
        )
    }

    /** User metadata controls the existing trusted WhatsApp/SMS Send SMS Hook. */
    suspend fun sendSignupPhoneCode(phone: String, channel: String) {
        requireProductionRegistration()
        if (channel !in listOf("whatsapp", "sms")) throw AuthRequestException("Choose WhatsApp or SMS.")
        val normalizedPhone = canonicalPhone(phone)
        val token = activeAccessToken()
        request("/user", "PUT", JSONObject().put("data", JSONObject()
            .put("sautilink_phone_otp_channel", channel)), bearer = token)
        request("/user", "PUT", JSONObject().put("phone", normalizedPhone), bearer = token)
    }

    /** Phone-change verification is NOT the same as passwordless sign-in (type=sms). */
    suspend fun confirmSignupPhoneCode(phone: String, code: String) {
        requireProductionRegistration()
        val normalizedPhone = canonicalPhone(phone)
        val token = activeAccessToken()
        fun matchesVerifiedPhone(user: JSONObject): Boolean =
            user.optString("phone").removePrefix("+") == normalizedPhone.removePrefix("+") &&
                !user.isNull("phone_confirmed_at") && user.optString("phone_confirmed_at").isNotBlank()
        // Auth stores E.164 digits without '+'. Reconcile a previous successful
        // verification before attempting to consume its one-use code again.
        val existing = request("/user", "GET", bearer = token)
        if (matchesVerifiedPhone(existing) && signupRequirements().phoneVerified) {
            currentUser = currentUser?.copy(phone = normalizedPhone)
            return
        }
        request("/verify", "POST", JSONObject().put("phone", normalizedPhone)
            .put("token", code).put("type", "phone_change"), bearer = token)
        val user = request("/user", "GET", bearer = token)
        if (!matchesVerifiedPhone(user) || !signupRequirements().phoneVerified) {
            throw AuthRequestException("Phone verification is still pending. Try again after receiving a valid code.")
        }
        currentUser = currentUser?.copy(phone = normalizedPhone)
    }

    suspend fun finishSignup(username: String, displayName: String, birthDate: String, phone: String = "") {
        requireProductionRegistration()
        val requirements = signupRequirements()
        if (requirements.needsSetup(phone.isNotBlank())) {
            throw AuthRequestException(if (!requirements.termsAccepted) "Accept the account terms before finishing signup."
                else "Verify your phone before finishing signup.")
        }
        signedInRpc("complete_social_onboarding", JSONObject()
            .put("p_username", username.trim().lowercase())
            .put("p_display_name", displayName.trim()))
        // The authoritative profile is verified by a separate RLS-safe read.
        val own = loadOwnProfile()
        if (own == null) throw AuthRequestException("We could not confirm your new profile. Try again.")
        updatePrivateBirthDate(birthDate)
    }

    /** Account birth date is private; use OkHttp because Android HttpURLConnection may reject PATCH. */
    private suspend fun updatePrivateBirthDate(isoDate: String) {
        val token = activeAccessToken()
        val uid = account?.id ?: throw AuthRequestException("Sign in before continuing.")
        withContext(Dispatchers.IO) {
            try {
                withTimeout(20000L) {
                    val client = OkHttpClient.Builder()
                        .followRedirects(false)
                        .connectTimeout(10, TimeUnit.SECONDS)
                        .readTimeout(10, TimeUnit.SECONDS)
                        .build()
                    val body = JSONObject().put("birth_date", isoDate).toString()
                        .toRequestBody("application/json; charset=utf-8".toMediaType())
                    val call = Request.Builder()
                        .url("${backend.postgrestOrigin}account_profiles?id=eq.$uid&select=id,birth_date")
                        .header("apikey", publishableKey)
                        .header("Authorization", "Bearer $token")
                        .header("Prefer", "return=representation")
                        .patch(body)
                        .build()
                    client.newCall(call).execute().use { response ->
                        if (!response.isSuccessful) {
                            throw AuthRequestException("The account is created, but your date of birth could not be saved. Please update it in account settings.")
                        }
                        val rows = JSONArray(response.body?.string().orEmpty())
                        if (rows.length() != 1 || rows.getJSONObject(0).optString("id") != uid ||
                            rows.getJSONObject(0).optString("birth_date") != isoDate) {
                            throw AuthRequestException("The account is created, but your date of birth was not confirmed. Please try again.")
                        }
                    }
                }
            } catch (e: AuthRequestException) { throw e }
            catch (_: Exception) { throw AuthRequestException("The account is created, but your date of birth could not be saved. Please update it in account settings.") }
        }
    }

    /** Return only this user's private birth date so an interrupted signup can resume safely. */
    suspend fun loadOwnBirthDate(): String? {
        requireProductionRegistration()
        val token = activeAccessToken()
        val uid = account?.id ?: throw AuthRequestException("Sign in before continuing.")
        return withContext(Dispatchers.IO) {
            try {
                withTimeout(20000L) {
                    val connection = URL("${backend.postgrestOrigin}account_profiles?id=eq.$uid&select=id,birth_date&limit=1")
                        .openConnection() as HttpURLConnection
                    try {
                        connection.requestMethod = "GET"
                        connection.connectTimeout = 10000
                        connection.readTimeout = 10000
                        connection.instanceFollowRedirects = false
                        connection.setRequestProperty("apikey", publishableKey)
                        connection.setRequestProperty("Authorization", "Bearer $token")
                        connection.setRequestProperty("Accept", "application/json")
                        val status = connection.responseCode
                        if (status !in 200..299) throw AuthRequestException("Could not check account setup (HTTP $status).")
                        val rows = JSONArray(connection.inputStream.bufferedReader().use { it.readText().take(4096) })
                        if (rows.length() == 0) null else {
                            val row = rows.getJSONObject(0)
                            if (row.optString("id") != uid) throw AuthRequestException("Account identity did not match.")
                            row.optString("birth_date").takeUnless { it.isBlank() || it == "null" }
                        }
                    } finally { connection.disconnect() }
                }
            } catch (e: AuthRequestException) { throw e }
            catch (_: Exception) { throw AuthRequestException("Could not check account setup. Check internet and try again.") }
        }
    }

    /** Send the existing secure recovery link to the official SautiLink website. Never request an OTP. */
    suspend fun requestPasswordRecovery(email: String) {
        requireProductionRegistration()
        val callback = java.net.URLEncoder.encode("${backend.siteOrigin}/home?auth_action=recovery", "UTF-8")
        request("/recover?redirect_to=$callback", "POST", JSONObject()
            .put("email", email.trim().lowercase()))
    }

    private fun requireProductionRegistration() {
        if (backend != SautiBackend.PRODUCTION) throw AuthRequestException("Registration is available on production only.")
    }

    private suspend fun signedInRpc(name: String, params: JSONObject): JSONObject {
        val token = activeAccessToken()
        return withContext(Dispatchers.IO) {
            try {
                withTimeout(20000L) {
                    val connection = URL("${backend.postgrestOrigin}rpc/$name")
                        .openConnection() as HttpURLConnection
                    try {
                        connection.requestMethod = "POST"
                        connection.connectTimeout = 10000; connection.readTimeout = 10000
                        connection.instanceFollowRedirects = false; connection.useCaches = false
                        connection.setRequestProperty("apikey", publishableKey)
                        connection.setRequestProperty("Authorization", "Bearer $token")
                        connection.setRequestProperty("Content-Type", "application/json")
                        connection.setRequestProperty("Accept", "application/json")
                        connection.doOutput = true
                        connection.outputStream.use { it.write(params.toString().toByteArray(Charsets.UTF_8)) }
                        val status = connection.responseCode
                        if (status !in 200..299) {
                            throw AuthRequestException(when (status) {
                                401, 403 -> "Sign-in expired or a signup requirement is missing. Check your email, phone and agreement."
                                409 -> "That username may already be taken. Choose another username."
                                else -> "Could not complete account setup (HTTP $status)."
                            }, status)
                        }
                        val raw = connection.inputStream?.bufferedReader()?.use { it.readText().take(4096) }.orEmpty()
                        runCatching { JSONObject(raw) }.getOrElse { JSONObject() }
                    } finally { connection.disconnect() }
                }
            } catch (e: AuthRequestException) { throw e }
            catch (_: Exception) { throw AuthRequestException("Could not reach account setup. Check internet and try again.") }
        }
    }

    /** Sends an OTP only to a pre-existing account; no signup is initiated. */
    suspend fun requestEmailCode(email: String) {
        request("/otp", "POST", JSONObject().put("email", email.trim())
            .put("create_user", false))
    }

    /** Server-side channel preference selects WhatsApp or SMS; app never selects provider arbitrarily. */
    suspend fun requestPhoneCode(phone: String) {
        request("/otp", "POST", JSONObject().put("phone", phone.trim())
            .put("create_user", false))
    }

    suspend fun verifyEmailCode(email: String, code: String): StagingAccount = consumeSession(
        request("/verify", "POST", JSONObject().put("email", email.trim())
            .put("token", code).put("type", "email"))
    )

    suspend fun verifyPhoneCode(phone: String, code: String): StagingAccount = consumeSession(
        request("/verify", "POST", JSONObject().put("phone", phone.trim())
            .put("token", code).put("type", "sms"))
    )

    /**
     * On process start a new access token is requested from the staging Auth server.
     * An offline/server failure preserves the encrypted refresh token for a later retry.
     * An explicitly revoked/invalid refresh token signs the device out.
     */
    suspend fun restoreSession() {
        sessionLock.withLock {
            if (currentUser != null) return@withLock
            sessionState = StagingSessionState.CHECKING
            try {
                val stored = withContext(Dispatchers.IO) { vault.read() }
                if (stored == null) {
                    sessionState = StagingSessionState.SIGNED_OUT
                    return@withLock
                }
                refreshSession(stored)
            } catch (e: AuthRequestException) {
                if (e.httpStatus in listOf(400, 401, 403, 422)) {
                    clearLocalSession()
                } else {
                    sessionState = StagingSessionState.RETRYABLE_ERROR
                }
            } catch (_: Exception) {
                sessionState = StagingSessionState.RETRYABLE_ERROR
            }
        }
    }

    fun forgetSavedSession() {
        clearLocalSession()
    }

    private fun clearLocalSession() {
        accessToken = null
        tokenExpiresAtMillis = 0L
        currentUser = null
        vault.clear()
        sessionState = StagingSessionState.SIGNED_OUT
    }

    private suspend fun refreshSession(storedRefreshToken: String): StagingAccount {
        val session = request("/token?grant_type=refresh_token", "POST",
            JSONObject().put("refresh_token", storedRefreshToken))
        return consumeSession(session)
    }

    private suspend fun consumeSession(session: JSONObject): StagingAccount {
        val token = session.optString("access_token")
        val refresh = session.optString("refresh_token")
        if (token.isBlank() || refresh.isBlank()) {
            throw AuthRequestException("Authentication did not return a renewable session.")
        }
        // Refresh-token rotation: save the NEW refresh token before any extra request.
        try {
            withContext(Dispatchers.IO) { vault.save(refresh) }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            throw AuthRequestException("Secure session storage is unavailable on this device.")
        }
        // Trust the Auth server's /user endpoint, never decode JWT claims as proof of identity.
        val user = request("/user", "GET", bearer = token)
        val userId = user.optString("id")
        if (!userId.matches(Regex("^[0-9a-fA-F-]{36}$"))) {
            clearLocalSession()
            throw AuthRequestException("The ${backend.title.lowercase()} account could not be validated.")
        }
        val account = StagingAccount(
            id = userId,
            displayName = user.optString("email").ifBlank {
                user.optString("phone").ifBlank { "SautiLink member" }
            },
            email = user.optString("email"),
            phone = user.optString("phone"),
            suggestedUsername = user.optJSONObject("user_metadata")?.optString("username").orEmpty(),
            suggestedName = user.optJSONObject("user_metadata")?.optString("full_name").orEmpty(),
            signupPhone = user.optJSONObject("user_metadata")?.optString("sautilink_signup_phone").orEmpty()
        )
        accessToken = token
        val seconds = session.optLong("expires_in", 3600L).coerceIn(30L, 86_400L)
        tokenExpiresAtMillis = System.currentTimeMillis() + seconds * 1000L
        currentUser = account
        sessionState = StagingSessionState.SIGNED_IN
        return account
    }

    /** Refresh access tokens before they expire. Locks avoid concurrent refresh-token reuse. */
    private suspend fun activeAccessToken(): String = sessionLock.withLock {
        val token = accessToken
        if (token != null && System.currentTimeMillis() + 60_000L < tokenExpiresAtMillis) {
            return@withLock token
        }
        val saved = withContext(Dispatchers.IO) { vault.read() }
            ?: throw AuthRequestException("Your ${backend.title.lowercase()} session has ended. Sign in again.")
        try {
            refreshSession(saved)
        } catch (e: AuthRequestException) {
            if (e.httpStatus in listOf(400, 401, 403, 422)) clearLocalSession()
            throw e
        }
        accessToken ?: throw AuthRequestException("Could not renew the ${backend.title.lowercase()} session.")
    }

    /** Short-lived token for environment-scoped RLS reads/writes; never log or persist it. */
    suspend fun accessTokenForStagingRead(): String = activeAccessToken()

    /**
     * Read-only snapshot for optional monitoring. This never refreshes credentials, reads
     * the session vault, or changes auth state. Normal app requests own session renewal.
     */
    fun cachedAccessTokenForObservation(expectedAccountId: String): String? {
        if (sessionState != StagingSessionState.SIGNED_IN || currentUser?.id != expectedAccountId) return null
        val nowMillis = System.currentTimeMillis()
        if (nowMillis <= 0L || tokenExpiresAtMillis <= nowMillis ||
            tokenExpiresAtMillis - nowMillis <= 180_000L) return null
        return accessToken?.takeIf { it.isNotBlank() }
    }

    /** Public (non-secret) staging publishable key, for API request headers only. */
    fun stagingPublishableKeyForRead(): String = publishableKey

    fun publicKeyForRead(): String = publishableKey

    /** Reads ONLY the current signed-in staging user's own social profile under Supabase RLS. */
    suspend fun loadOwnProfile(): StagingProfile? {
        val token = activeAccessToken()
        val accountId = currentUser?.id ?: throw AuthRequestException("${backend.title} account is unavailable.")
        if (!accountId.matches(Regex("^[0-9a-fA-F-]{36}$"))) {
            throw AuthRequestException("The account ID is invalid.")
        }
        return withContext(Dispatchers.IO) {
            try {
                withTimeout(20000L) {
                    val route = "?id=eq.$accountId&select=id,username,display_name,bio,location,created_at,is_discoverable&limit=1"
                    val connection = URL("${backend.postgrestOrigin}social_profiles$route")
                        .openConnection() as HttpURLConnection
                    try {
                        connection.requestMethod = "GET"
                        connection.connectTimeout = 10000
                        connection.readTimeout = 10000
                        connection.useCaches = false
                        connection.instanceFollowRedirects = false
                        connection.setRequestProperty("Accept", "application/json")
                        connection.setRequestProperty("apikey", publishableKey)
                        connection.setRequestProperty("Authorization", "Bearer $token")
                        connection.setRequestProperty("Cache-Control", "no-store")
                        val status = connection.responseCode
                        if (status !in 200..299) {
                            throw AuthRequestException(when (status) {
                                401, 403 -> "Session is no longer authorized. Sign out and sign in again."
                                429 -> "Too many requests. Try again shortly."
                                in 500..599 -> "Profile service is temporarily unavailable."
                                else -> "Could not load profile (HTTP $status)."
                            })
                        }
                        val body = connection.inputStream.bufferedReader().use { it.readText().take(32768) }
                        val records = JSONArray(body)
                        if (records.length() == 0) null else {
                            val item = records.getJSONObject(0)
                            // Defend against unexpected/incorrectly configured backend responses.
                            if (!item.optString("id").equals(accountId, ignoreCase = true)) {
                                throw AuthRequestException("The staging profile identity did not match.")
                            }
                            StagingProfile(
                                displayName = item.optString("display_name").ifBlank { item.optString("username") },
                                username = item.optString("username"),
                                bio = item.optString("bio").takeUnless { it == "null" }.orEmpty(),
                                location = item.optString("location").takeUnless { it == "null" }.orEmpty(),
                                joinedAt = item.optString("created_at"),
                                discoverable = item.optBoolean("is_discoverable", false)
                            )
                        }
                    } finally { connection.disconnect() }
                }
            } catch (e: AuthRequestException) {
                throw e
            } catch (_: Exception) {
                throw AuthRequestException("Could not load staging profile. Check internet and try again.")
            }
        }
    }

    suspend fun signOut() {
        val token = accessToken
        // Explicit sign-out always clears local auth BEFORE making a network request.
        sessionLock.withLock { withContext(Dispatchers.IO) { clearLocalSession() } }
        if (token != null) runCatching { request("/logout", "POST", JSONObject(), bearer = token) }
    }

    private suspend fun request(
        route: String,
        method: String,
        payload: JSONObject? = null,
        bearer: String? = null,
        origin: String = baseUrl
    ): JSONObject = withContext(Dispatchers.IO) {
        if (!configured) throw AuthRequestException("${backend.title} publishable key is not configured.")
        val started = System.nanoTime()
        var phase = SautiNetworkPhase.EXECUTE
        var seenStatus: Int? = null
        fun recordFailure(error: Exception) {
            runCatching { Log.w("SautiAuthNet", sautiNetworkFailureDiagnostic(error, method, SautiNetworkSite.AUTH,
                (System.nanoTime() - started) / 1_000_000, seenStatus, phase)) }
        }
        try {
            authRequestWithinDeadline {
                val connection = URL(origin + route).openConnection() as HttpURLConnection
                try {
                    connection.requestMethod = method
                    connection.connectTimeout = 10000
                    connection.readTimeout = 10000
                    connection.instanceFollowRedirects = false
                    connection.useCaches = false
                    connection.setRequestProperty("Accept", "application/json")
                    connection.setRequestProperty("apikey", publishableKey)
                    if (bearer != null) connection.setRequestProperty("Authorization", "Bearer $bearer")
                    if (payload != null) {
                        connection.doOutput = true
                        connection.setRequestProperty("Content-Type", "application/json")
                        connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
                    }
                    val status = connection.responseCode
                    seenStatus = status
                    phase = SautiNetworkPhase.RESPONSE_BODY
                    val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                    val body = stream?.bufferedReader()?.use { it.readText().take(8192) }.orEmpty()
                    val json = runCatching { JSONObject(body) }.getOrElse { JSONObject() }
                    if (status !in 200..299) {
                        phase = SautiNetworkPhase.HTTP_STATUS
                        val expiredCode = status in listOf(400, 401, 403, 422) && route == "/verify" && (
                            json.optString("error_code") == "otp_expired" ||
                            json.optString("code") == "otp_expired")
                        val message = if (route == "/functions/v1/sautilink-username-login" && status in listOf(400, 401, 403, 422)) {
                            "Incorrect email/username or password."
                        } else if (expiredCode) {
                            "This verification code is invalid or has expired. Request a new code and try again."
                        } else when (status) {
                            400, 401, 403, 422 -> "Verification failed or this account is unavailable. Check your details."
                            429 -> "Too many attempts. Wait a little before trying again."
                            in 500..599 -> "Authentication service is temporarily unavailable."
                            else -> "Sign-in could not complete (HTTP $status)."
                        }
                        throw AuthRequestException(message, httpStatus = status)
                    }
                    json
                } finally { connection.disconnect() }
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (e: AuthRequestException) {
            if (e.httpStatus != null) recordFailure(e)
            throw e
        } catch (e: Exception) {
            recordFailure(e)
            throw AuthRequestException("Connection failed. Check internet and ${backend.title.lowercase()} availability.", cause = e)
        }
    }
}

data class StagingAccount(val id: String, val displayName: String, val email: String, val phone: String, val suggestedUsername: String = "", val suggestedName: String = "", val signupPhone: String = "")
data class StagingProfile(
    val displayName: String,
    val username: String,
    val bio: String,
    val location: String,
    val joinedAt: String,
    val discoverable: Boolean
)
class AuthRequestException(message: String, val httpStatus: Int? = null, cause: Throwable? = null) : Exception(message, cause)
