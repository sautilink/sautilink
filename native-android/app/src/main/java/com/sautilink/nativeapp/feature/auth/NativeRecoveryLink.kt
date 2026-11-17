package com.sautilink.nativeapp.feature.auth

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.net.Uri

/** The production web reset expects the authenticated return from an emailed recovery link. */
internal object NativeRecoveryLink {
    private const val ORIGIN = "https://sautilink.com"
    private const val PATH = "/home"
    private const val RECOVERY = "recovery"

    fun from(intent: Intent?): RecoveryReturn? =
        intent?.takeIf { it.action == Intent.ACTION_VIEW }?.data?.let(::parse)

    fun openResetPage(context: Context, callback: Uri): Boolean {
        val target = parse(callback)?.browserUrl ?: return false
        // Resolve a general web URL so SautiLink's own verified /home link cannot win again.
        val browserProbe = Intent(Intent.ACTION_VIEW, Uri.parse("https://example.invalid/"))
            .addCategory(Intent.CATEGORY_BROWSABLE)
        val packages = context.packageManager
        val flags = PackageManager.MATCH_DEFAULT_ONLY or PackageManager.GET_RESOLVED_FILTER
        val browsers = packages.queryIntentActivities(browserProbe, flags)
            .filter { it.filter?.countDataAuthorities() == 0 && it.activityInfo.packageName != context.packageName }
            .map { it.activityInfo.packageName }.distinct()
        if (browsers.isEmpty()) return false

        fun browserIntent(packageName: String) = Intent(Intent.ACTION_VIEW, target)
            .addCategory(Intent.CATEGORY_BROWSABLE)
            .setPackage(packageName)
            .putExtras(Bundle().apply {
                putBinder("android.support.customtabs.extra.SESSION", null)
                putBoolean("android.support.customtabs.extra.SEND_TO_EXTERNAL_HANDLER", false)
            })

        val defaultPackage = packages.resolveActivity(browserProbe, PackageManager.MATCH_DEFAULT_ONLY)
            ?.activityInfo?.packageName
        val launch = when {
            defaultPackage in browsers -> browserIntent(requireNotNull(defaultPackage))
            browsers.size == 1 -> browserIntent(browsers.single())
            else -> Intent.createChooser(browserIntent(browsers.first()), "Open password recovery")
                .putExtra(Intent.EXTRA_INITIAL_INTENTS, browsers.drop(1).map(::browserIntent).toTypedArray())
        }
        return runCatching { context.startActivity(launch) }.isSuccess
    }

    private fun isTrustedOrigin(uri: Uri): Boolean =
        uri.isHierarchical && uri.scheme == "https" &&
            uri.encodedAuthority in setOf("sautilink.com", "www.sautilink.com")

    fun parse(uri: Uri): RecoveryReturn? {
        if (!isTrustedOrigin(uri) || uri.encodedPath != PATH || uri.toString().length > 16_384) return null
        val fragment = uri.encodedFragment?.let { Uri.parse("$ORIGIN/?$it") }
        val explicit = uri.getQueryParameter("auth_action") ?: uri.getQueryParameter("flow")
        val type = uri.getQueryParameter("type") ?: fragment?.getQueryParameter("type")
        if ((explicit ?: type) != RECOVERY) return null

        val isError = listOf("error", "error_code", "error_description").any { key ->
            uri.getQueryParameter(key) != null || fragment?.getQueryParameter(key) != null
        }
        if (isError) return RecoveryReturn(null)
        val callback = Uri.parse("$ORIGIN$PATH").buildUpon().appendQueryParameter("auth_action", RECOVERY)
        val tokenHash = uri.singleToken("token_hash")
        if (tokenHash != null && type == RECOVERY) {
            return RecoveryReturn(callback.appendQueryParameter("token_hash", tokenHash)
                .appendQueryParameter("type", RECOVERY).build())
        }

        val access = fragment?.singleToken("access_token") ?: return RecoveryReturn(null)
        val refresh = fragment.singleToken("refresh_token") ?: return RecoveryReturn(null)
        if (type != RECOVERY) return RecoveryReturn(null)

        // Keep the session credentials in the fragment so the server never sees them as query parameters.
        val credentials = Uri.Builder().appendQueryParameter("access_token", access)
            .appendQueryParameter("refresh_token", refresh)
            .appendQueryParameter("type", RECOVERY)
            .appendQueryParameter("token_type", "bearer")
        for (key in listOf("expires_in", "expires_at")) {
            fragment.getQueryParameters(key).singleOrNull()?.takeIf { it.toLongOrNull() != null }?.let {
                credentials.appendQueryParameter(key, it)
            }
        }
        return RecoveryReturn(callback.encodedFragment(credentials.build().encodedQuery).build())
    }

    private fun Uri.singleToken(key: String): String? =
        getQueryParameters(key).singleOrNull()?.takeIf { value ->
            value.length in 1..8192 && value.all { it.isLetterOrDigit() || it in "-_." }
        }
}

/** A recognized return with no URL needs a fresh recovery request. */
internal class RecoveryReturn(val browserUrl: Uri?)
