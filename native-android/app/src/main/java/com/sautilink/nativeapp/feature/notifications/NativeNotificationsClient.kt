package com.sautilink.nativeapp.feature.notifications

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.concurrent.TimeUnit

data class NativeNotification(
    val id: String, val type: String, val actorHandle: String, val actorName: String,
    val actorVerified: Boolean, val actorBadgeType: String,
    val circleSlug: String, val circleName: String, val circleEvent: String,
    val postId: String, val createdAt: String, val isRead: Boolean,
)

/** RLS-protected notifications; writes are scoped to the current recipient. */
class NativeNotificationsClient(private val auth: StagingAuthClient) {
    private val http = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build()
    private val uuid = Regex("^[0-9a-fA-F-]{36}$")
    private val numericId = Regex("^[0-9]{1,20}$")
    private val jsonType = "application/json".toMediaType()

    private fun viewer(): String = auth.account?.id?.takeIf(uuid::matches)
        ?: throw AuthRequestException("Sign in to see notifications.")

    private suspend fun rest(path: String, patch: JSONObject? = null): JSONArray {
        val token = auth.accessTokenForStagingRead()
        return withContext(Dispatchers.IO) {
            val request = Request.Builder().url(auth.restOrigin + path)
                .header("apikey", auth.publicKeyForRead()).header("Authorization", "Bearer $token")
                .header("Accept", "application/json").header("Cache-Control", "no-store")
                .apply {
                    if (patch == null) get() else {
                        header("Prefer", "return=representation")
                        patch(patch.toString().toRequestBody(jsonType))
                    }
                }.build()
            try {
                http.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) throw AuthRequestException(when (response.code) {
                        401, 403 -> "Notifications access denied. Sign in again."
                        429 -> "Too many notification requests. Try again shortly."
                        in 500..599 -> "Notifications are temporarily unavailable."
                        else -> "Notifications request failed (HTTP ${response.code})."
                    }, response.code)
                    val body = response.body?.string()?.take(500_000).orEmpty()
                    if (body.isBlank()) JSONArray() else JSONArray(body)
                }
            } catch (e: AuthRequestException) { throw e }
            catch (_: Exception) { throw AuthRequestException("Could not connect to notifications.") }
        }
    }

    suspend fun load(): List<NativeNotification> {
        val own = viewer()
        val rows = rest("social_notifications?recipient_id=eq.$own&select=id,actor_id,post_id,circle_id,circle_event,notification_type,read_at,created_at&order=created_at.desc,id.desc&limit=50")
            .objects()
        val actorIds = rows.mapNotNull { it.optString("actor_id").takeIf(uuid::matches) }.distinct()
        val circleIds = rows.mapNotNull { it.optString("circle_id").takeIf(uuid::matches) }.distinct()
        val actors = if (actorIds.isEmpty()) emptyMap() else rest(
            "social_profiles?id=in.(${actorIds.joinToString(",")})&select=id,username,display_name,is_verified,verification_badge_type"
        ).objects().associateBy { it.optString("id") }
        val circles = if (circleIds.isEmpty()) emptyMap() else rest(
            "social_circles?id=in.(${circleIds.joinToString(",")})&select=id,slug,name"
        ).objects().associateBy { it.optString("id") }
        return rows.mapNotNull { row ->
            val id = row.optString("id")
            if (!numericId.matches(id)) return@mapNotNull null
            val actor = actors[row.optString("actor_id")]
            val circle = circles[row.optString("circle_id")]
            val handle = actor?.optString("username").orEmpty()
            NativeNotification(id, row.optString("notification_type"), handle,
                actor?.optString("display_name")?.takeUnless { it.isBlank() || it == "null" }
                    ?: handle.ifBlank { "SautiLink" },
                actor?.optBoolean("is_verified", false) == true,
                actor?.optString("verification_badge_type", "standard") ?: "standard",
                circle?.optString("slug").orEmpty(), circle?.optString("name").orEmpty(),
                row.optString("circle_event"), row.optString("post_id").takeIf(uuid::matches).orEmpty(),
                row.optString("created_at"), !row.isNull("read_at"))
        }
    }

    suspend fun markRead(id: String) {
        val own = viewer()
        if (!numericId.matches(id)) return
        rest("social_notifications?id=eq.$id&recipient_id=eq.$own&read_at=is.null",
            JSONObject().put("read_at", Instant.now().toString()))
    }

    suspend fun markAllRead() {
        val own = viewer()
        rest("social_notifications?recipient_id=eq.$own&read_at=is.null",
            JSONObject().put("read_at", Instant.now().toString()))
    }
}

private fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull(::optJSONObject)
