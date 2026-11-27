package com.sautilink.nativeapp.feature.settings

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
import java.util.UUID
import java.util.concurrent.TimeUnit

data class NativeAccountSettings(
    val handle: String, val displayName: String, val discoverable: Boolean,
    val externalIndexing: Boolean, val dmAccess: String, val readReceipts: Boolean,
    val activityStatus: Boolean, val notifyPosts: Boolean, val notifyMessages: Boolean,
    val notifyFollowers: Boolean, val notifySautify: Boolean, val emailDigest: String,
    val exportStatus: String, val deletionStatus: String, val deletionDeadline: String,
    val blocked: List<SafetyAccount>, val muted: List<SafetyAccount>,
)

data class SafetyAccount(val id: String, val label: String)

/** Owner-scoped production settings and account-control APIs. */
class NativeSettingsClient(private val auth: StagingAuthClient) {
    private val http = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build()
    private val uuid = Regex("^[0-9a-fA-F-]{36}$")
    private val jsonType = "application/json".toMediaType()
    private val profileBooleans = setOf("is_discoverable", "allow_external_indexing")
    private val preferenceBooleans = setOf("read_receipts", "activity_status", "notify_post_activity",
        "notify_messages", "notify_followers", "notify_sautify")

    private fun viewer(): String = auth.account?.id?.takeIf(uuid::matches)
        ?: throw AuthRequestException("Sign in to see account settings.")

    private suspend fun request(url: String, method: String = "GET", payload: JSONObject? = null): String {
        val jwt = auth.accessTokenForStagingRead()
        return withContext(Dispatchers.IO) {
            val builder = Request.Builder().url(url)
                .header("Authorization", "Bearer $jwt").header("Accept", "application/json")
                .header("Cache-Control", "no-store")
            if (url.startsWith(auth.restOrigin)) builder.header("apikey", auth.publicKeyForRead())
            if (method != "GET") {
                val body = (payload ?: JSONObject()).toString().toRequestBody(jsonType)
                when (method) {
                    "PATCH" -> builder.header("Prefer", "return=representation").patch(body)
                    "POST" -> builder.post(body)
                    "DELETE" -> if (payload == null) builder.delete() else builder.delete(body)
                    else -> throw IllegalArgumentException("Unsupported settings operation")
                }
            }
            try {
                http.newCall(builder.build()).execute().use { response ->
                    val text = response.body?.string()?.take(300_000).orEmpty()
                    if (!response.isSuccessful) throw AuthRequestException(when (response.code) {
                        401, 403 -> "Account settings access denied. Sign in again."
                        409 -> "This setting conflicts with your current account state. Refresh and retry."
                        429 -> "Please try again shortly."
                        in 500..599 -> "Account settings are temporarily unavailable."
                        else -> "Could not save account settings (HTTP ${response.code})."
                    }, response.code)
                    text
                }
            } catch (e: AuthRequestException) { throw e }
            catch (_: Exception) { throw AuthRequestException("Could not connect to account settings.") }
        }
    }

    private suspend fun api(path: String, method: String = "GET", payload: JSONObject? = null): JSONObject {
        val response = JSONObject(request(auth.mediaOrigin + path, method, payload))
        if (!response.optBoolean("ok", false))
            throw AuthRequestException(response.optJSONObject("error")?.optString("message")
                ?: "Account request failed.")
        return response.optJSONObject("data") ?: JSONObject()
    }

    suspend fun load(): NativeAccountSettings {
        val own = viewer()
        val profile = JSONArray(request(auth.restOrigin +
            "social_profiles?id=eq.$own&select=username,display_name,is_discoverable,allow_external_indexing,dm_access&limit=1"))
            .optJSONObject(0) ?: throw AuthRequestException("Your profile is unavailable.")
        val prefs = JSONArray(request(auth.restOrigin +
            "social_member_preferences?user_id=eq.$own&select=read_receipts,activity_status,notify_post_activity,notify_messages,notify_followers,notify_sautify,email_digest&limit=1"))
            .optJSONObject(0) ?: throw AuthRequestException("Your preferences are unavailable.")
        val export = api("/api/account/export").optJSONObject("request")
        val deletion = api("/api/safety/deletion-request").optJSONObject("request")
        val blockRows = JSONArray(request(auth.restOrigin +
            "social_blocks?blocker_id=eq.$own&select=blocked_id,created_at&order=created_at.desc&limit=100"))
        val muteRows = JSONArray(request(auth.restOrigin +
            "social_mutes?muter_id=eq.$own&select=muted_id,created_at&order=created_at.desc&limit=100"))
        val ids = (0 until blockRows.length()).mapNotNull { blockRows.optJSONObject(it)?.optString("blocked_id") }
            .plus((0 until muteRows.length()).mapNotNull { muteRows.optJSONObject(it)?.optString("muted_id") })
            .filter(uuid::matches).distinct()
        val labels = if (ids.isEmpty()) emptyMap() else runCatching {
            val profiles = JSONArray(request(auth.restOrigin +
                "social_profiles?id=in.(${ids.joinToString(",")})&select=id,username,display_name&limit=100"))
            (0 until profiles.length()).mapNotNull { profiles.optJSONObject(it) }.associate {
                val label = it.optString("display_name").ifBlank { it.optString("username") }
                it.optString("id") to label
            }
        }.getOrDefault(emptyMap())
        fun entries(rows: JSONArray, targetColumn: String) = (0 until rows.length()).mapNotNull { index ->
            rows.optJSONObject(index)?.optString(targetColumn)?.takeIf(uuid::matches)?.let { id ->
                SafetyAccount(id, labels[id]?.takeIf(String::isNotBlank) ?: "Account ${id.take(8)}…")
            }
        }
        return NativeAccountSettings(profile.optString("username"), profile.optString("display_name"),
            profile.optBoolean("is_discoverable"), profile.optBoolean("allow_external_indexing"),
            profile.optString("dm_access").ifBlank { "following" },
            prefs.optBoolean("read_receipts"), prefs.optBoolean("activity_status"),
            prefs.optBoolean("notify_post_activity"), prefs.optBoolean("notify_messages"),
            prefs.optBoolean("notify_followers"), prefs.optBoolean("notify_sautify"),
            prefs.optString("email_digest").ifBlank { "off" },
            export?.optString("status").orEmpty(), deletion?.optString("status").orEmpty(),
            deletion?.optString("scheduled_for").orEmpty(),
            entries(blockRows, "blocked_id"), entries(muteRows, "muted_id"))
    }

    suspend fun setProfileBoolean(column: String, value: Boolean) {
        val own = viewer()
        if (column !in profileBooleans) throw IllegalArgumentException("Unsupported profile setting")
        request(auth.restOrigin + "social_profiles?id=eq.$own", "PATCH", JSONObject().put(column, value))
    }

    suspend fun setDmAccess(value: String) {
        val own = viewer()
        if (value !in setOf("following", "everyone", "none")) throw IllegalArgumentException("Invalid message setting")
        request(auth.restOrigin + "social_profiles?id=eq.$own", "PATCH", JSONObject().put("dm_access", value))
    }

    suspend fun setPreferenceBoolean(column: String, value: Boolean) {
        val own = viewer()
        if (column !in preferenceBooleans) throw IllegalArgumentException("Unsupported preference")
        request(auth.restOrigin + "social_member_preferences?user_id=eq.$own", "PATCH",
            JSONObject().put(column, value))
    }

    suspend fun setEmailDigest(value: String) {
        val own = viewer()
        if (value !in setOf("off", "daily", "weekly")) throw IllegalArgumentException("Invalid digest setting")
        request(auth.restOrigin + "social_member_preferences?user_id=eq.$own", "PATCH",
            JSONObject().put("email_digest", value))
    }

    suspend fun requestExport(): String = api("/api/account/export", "POST",
        JSONObject().put("request_id", UUID.randomUUID().toString()))
        .optJSONObject("request")?.optString("status").orEmpty()

    suspend fun cancelExport(): String = api("/api/account/export", "DELETE")
        .optJSONObject("request")?.optString("status").orEmpty()

    suspend fun requestDeletion(confirmation: String): String {
        if (confirmation.trim().uppercase() != "DELETE") throw IllegalArgumentException("Type DELETE to continue.")
        return api("/api/safety/deletion-request", "POST", JSONObject().put("confirmation", "DELETE"))
            .optJSONObject("request")?.optString("status").orEmpty()
    }

    suspend fun cancelDeletion(): String = api("/api/safety/deletion-request", "DELETE")
        .optJSONObject("request")?.optString("status").orEmpty()

    suspend fun removeSafetyTarget(block: Boolean, targetId: String) {
        val own = viewer()
        if (!uuid.matches(targetId)) throw IllegalArgumentException("Invalid account.")
        val table = if (block) "social_blocks" else "social_mutes"
        val owner = if (block) "blocker_id" else "muter_id"
        val target = if (block) "blocked_id" else "muted_id"
        request(auth.restOrigin + "$table?$owner=eq.$own&$target=eq.$targetId", "DELETE")
    }
}
