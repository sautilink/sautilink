package com.sautilink.nativeapp.feature.auth

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.content.pm.verify.domain.DomainVerificationManager
import android.content.pm.verify.domain.DomainVerificationUserState
import android.os.Build
import android.provider.Settings
import android.os.Bundle
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom

/** Use the existing web Google provider and verified Android /home app link. */
internal class NativeGoogleSignIn(context: Context) {
    private val pending = StagingSessionVault(context, SautiBackend.PRODUCTION, "google_pkce")

    fun linkSettingsIfNeeded(context: Context): Intent? {
        if (Build.VERSION.SDK_INT < 31) return null
        val verification = context.getSystemService(DomainVerificationManager::class.java)
            ?.getDomainVerificationUserState(context.packageName) ?: return null
        if (verification.isLinkHandlingAllowed &&
            verification.hostToStateMap["sautilink.com"] in setOf(
                DomainVerificationUserState.DOMAIN_STATE_VERIFIED,
                DomainVerificationUserState.DOMAIN_STATE_SELECTED
            )) return null
        return Intent(Settings.ACTION_APP_OPEN_BY_DEFAULT_SETTINGS,
            Uri.fromParts("package", context.packageName, null))
    }

    suspend fun startIntent(): Intent = withContext(Dispatchers.IO) {
        val verifier = randomChallenge()
        val state = randomChallenge()
        val callback = Uri.parse(CALLBACK).buildUpon().appendQueryParameter(STATE, state).build()
        val authUrl = Uri.parse("${SautiBackend.PRODUCTION.supabaseOrigin}/auth/v1/authorize")
            .buildUpon()
            .appendQueryParameter("provider", "google")
            .appendQueryParameter("redirect_to", callback.toString())
            .appendQueryParameter("code_challenge", encode(
                MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII))))
            .appendQueryParameter("code_challenge_method", "s256")
            .build()

        pending.save(JSONObject().put("state", state).put("verifier", verifier)
            .put("createdAt", System.currentTimeMillis()).toString())

        // Let the system browser handle Google credentials. Browsers with Custom Tabs
        // support display a tab over SautiLink and can hand the verified link back to it.
        Intent(Intent.ACTION_VIEW, authUrl).putExtras(Bundle().apply {
            putBinder("android.support.customtabs.extra.SESSION", null)
            putBoolean("android.support.customtabs.extra.SEND_TO_EXTERNAL_HANDLER", true)
        })
    }

    suspend fun finish(callback: Uri, auth: StagingAuthClient): Boolean {
        val result = readGoogleCallback(callback) ?: return false
        val verifier = withContext(Dispatchers.IO) {
            val saved = pending.read()?.let(::JSONObject) ?: return@withContext null
            val age = System.currentTimeMillis() - saved.optLong("createdAt")
            if (age !in 0..15 * 60_000L) {
                pending.clear()
                return@withContext null
            }
            if (!MessageDigest.isEqual(result.state.toByteArray(), saved.optString("state").toByteArray())) {
                return@withContext null
            }
            pending.clear()
            saved.getString("verifier")
        } ?: return false

        if (auth.sessionState != StagingSessionState.SIGNED_OUT) return false
        if (result.error != null) {
            val message = if (result.error == "access_denied") "Google sign-in was cancelled."
                else "Google sign-in couldn't finish. Please try again."
            throw AuthRequestException(message)
        }

        auth.exchangeGoogleCode(requireNotNull(result.code), verifier)
        return true
    }

    companion object {
        private const val CALLBACK = "https://sautilink.com/home"
        private const val STATE = "native_auth"
        private val urlToken = Regex("[A-Za-z0-9_-]{43}")
        private val random = SecureRandom()

        private fun encode(bytes: ByteArray): String =
            Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

        private fun randomChallenge(): String = encode(ByteArray(32).apply(random::nextBytes))

        fun callbackFrom(intent: Intent?): Uri? {
            if (intent?.action != Intent.ACTION_VIEW) return null
            return intent.data?.takeIf { readGoogleCallback(it) != null }
        }

        private fun readGoogleCallback(uri: Uri): GoogleCallback? {
            if (!uri.isHierarchical || uri.scheme != "https" || uri.encodedAuthority != "sautilink.com" ||
                uri.encodedPath != "/home") return null
            val state = uri.getQueryParameters(STATE).singleOrNull()?.takeIf(urlToken::matches) ?: return null
            val codes = uri.getQueryParameters("code")
            val errors = uri.getQueryParameters("error")
            if (codes.size + errors.size != 1) return null
            val code = codes.singleOrNull()?.takeIf { it.length in 1..256 }
            val error = errors.singleOrNull()?.takeIf { it.length in 1..64 }
            if (code == null && error == null) return null
            return GoogleCallback(state, code, error)
        }
    }
}

private data class GoogleCallback(val state: String, val code: String?, val error: String?)
