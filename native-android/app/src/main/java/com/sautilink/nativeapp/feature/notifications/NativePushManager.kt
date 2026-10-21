package com.sautilink.nativeapp.feature.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.content.Intent
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Native FCM transport. Supabase `social_notifications` remains the canonical feed. */
object NativePushManager {
    const val CHANNEL_ID = "sautilink_updates"
    private val http = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build()
    private val uuid = Regex("(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    private val handle = Regex("^[a-zA-Z0-9][a-zA-Z0-9._]{2,29}$")
    private val roomSlug = Regex("^[a-z0-9][a-z0-9-]{2,49}$")

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(
        "sautilink_native_push_v1", Context.MODE_PRIVATE)

    fun configured(context: Context): Boolean = FirebaseApp.getApps(context.applicationContext).isNotEmpty()

    fun permissionGranted(context: Context): Boolean = Build.VERSION.SDK_INT < 33 ||
        context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "SautiLink notifications",
            NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Activity, messages and important SautiLink updates"
            lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
        })
    }

    fun safeRoute(raw: String?): String? {
        val route = raw?.trim()?.take(180).orEmpty()
        if (route.isEmpty() || !route.startsWith('/') || route.contains("//")) return null
        val path = route.substringBefore('?').trimEnd('/')
        val query = route.substringAfter('?', "")
        val allowedQuery = query.isEmpty() || query.matches(Regex("^(?:view=post|from=notification|message=[0-9]{1,20})$"))
        if (!allowedQuery) return null
        return when {
            path in setOf("/home", "/explore", "/videos", "/stories", "/rooms", "/profile",
                "/notifications", "/settings", "/messages") -> route
            path.startsWith("/u/") && handle.matches(path.removePrefix("/u/")) -> route
            path.startsWith("/post/") && uuid.matches(path.removePrefix("/post/")) -> route
            path.startsWith("/stories/") && uuid.matches(path.removePrefix("/stories/")) -> route
            path.startsWith("/rooms/") && roomSlug.matches(path.removePrefix("/rooms/")) -> route
            path.startsWith("/messages/") && uuid.matches(path.removePrefix("/messages/")) -> route
            else -> null
        }
    }

    /** Accept only SautiLink web links and the app's own scheme. Never trust arbitrary URL hosts. */
    fun routeFromIntent(intent: Intent?): String? {
        if (intent == null) return null
        if (intent.action != Intent.ACTION_VIEW) {
            // Background notification + data messages launch the Activity with FCM's
            // data keys as extras. Foreground notifications use our own pending intent.
            return safeRoute(intent.getStringExtra("sautilink_push_route"))
                ?: safeRoute(intent.getStringExtra("route"))
        }
        val uri = intent.data ?: return null
        if (uri.fragment != null || uri.userInfo != null) return null
        val validOrigin = when (uri.scheme?.lowercase()) {
            "https" -> uri.host?.lowercase() in setOf("sautilink.com", "www.sautilink.com") &&
                uri.port in setOf(-1, 443)
            "sautilink" -> uri.host?.lowercase() == "app" && uri.port == -1
            else -> false
        }
        if (!validOrigin) return null
        val route = uri.encodedPath.orEmpty() + (uri.encodedQuery?.let { "?$it" } ?: "")
        return safeRoute(route)
    }

    private fun installationId(context: Context): String {
        val store = prefs(context)
        val old = store.getString("installation_id", null)
        if (old != null && uuid.matches(old)) return old
        val created = UUID.randomUUID().toString()
        check(store.edit().putString("installation_id", created).commit())
        return created
    }

    suspend fun sync(context: Context, auth: StagingAuthClient): Boolean {
        val own = auth.account?.id?.takeIf(uuid::matches) ?: return false
        if (!configured(context) || !permissionGranted(context)) return false
        val token = withContext(Dispatchers.IO) {
            runCatching { Tasks.await(FirebaseMessaging.getInstance().token, 20, TimeUnit.SECONDS) }
                .getOrNull()?.trim().orEmpty()
        }
        if (token.length !in 32..4096) return false
        val store = prefs(context)
        val fresh = store.getString("registered_user", null) == own &&
            store.getString("registered_token", null) == token &&
            System.currentTimeMillis() - store.getLong("registered_at", 0) < 24L * 60 * 60 * 1000
        if (fresh) return true
        return try {
            rpc(auth, "register_push_device_token_v1", JSONObject()
                .put("p_installation_id", installationId(context)).put("p_token", token))
            store.edit().putString("registered_user", own).putString("registered_token", token)
                .putLong("registered_at", System.currentTimeMillis()).apply()
            true
        } catch (_: Exception) { false }
    }

    /** Call before Supabase sign-out so the RPC still has the user's JWT. */
    suspend fun unregister(context: Context, auth: StagingAuthClient) {
        if (auth.account != null && configured(context)) {
            runCatching { rpc(auth, "unregister_push_device_token_v1",
                JSONObject().put("p_installation_id", installationId(context))) }
        }
        prefs(context).edit().remove("registered_user").remove("registered_token")
            .remove("registered_at").apply()
        if (configured(context)) withContext(Dispatchers.IO) {
            runCatching { Tasks.await(FirebaseMessaging.getInstance().deleteToken()) }
        }
    }

    fun onNewToken(context: Context) {
        prefs(context).edit().remove("registered_token").remove("registered_at").apply()
    }

    private suspend fun rpc(auth: StagingAuthClient, name: String, payload: JSONObject) {
        val jwt = auth.accessTokenForStagingRead()
        withContext(Dispatchers.IO) {
            val request = Request.Builder().url(auth.restOrigin + "rpc/$name")
                .header("apikey", auth.publicKeyForRead()).header("Authorization", "Bearer $jwt")
                .post(payload.toString().toRequestBody("application/json".toMediaType())).build()
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) throw IllegalStateException("Push registration HTTP ${response.code}")
            }
        }
    }
}
