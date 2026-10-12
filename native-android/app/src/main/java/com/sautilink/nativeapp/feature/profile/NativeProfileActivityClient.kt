package com.sautilink.nativeapp.feature.profile

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.FeedMedia
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Exact profile-activity RPCs shared with SautiLink Web, including its privacy gate. */
internal class NativeProfileActivityClient(private val auth: StagingAuthClient) {
    private val client = OkHttpClient.Builder().callTimeout(25, TimeUnit.SECONDS).build()
    private val handlePattern = Regex("^[a-z0-9][a-z0-9._]{2,29}$")
    private val tabs = setOf("posts", "reposts", "replies", "likes", "saves", "hashtags", "pins")

    private suspend fun rpc(name: String, payload: JSONObject): JSONObject {
        val token = auth.accessTokenForStagingRead()
        return withContext(Dispatchers.IO) {
            val req = Request.Builder().url("${auth.restOrigin}rpc/$name")
                .header("apikey", auth.publicKeyForRead())
                .header("Authorization", "Bearer $token")
                .header("Accept", "application/json")
                .header("Cache-Control", "no-store")
                .post(payload.toString().toRequestBody("application/json".toMediaType())).build()
            try {
                client.newCall(req).execute().use { result ->
                    val body = result.body?.string()?.take(850_000).orEmpty()
                    if (!result.isSuccessful) throw AuthRequestException(when (result.code) {
                        401, 403 -> "This profile activity is private or unavailable."
                        429 -> "Please wait before refreshing profile activity."
                        else -> "Profile activity couldn't load. Please try again."
                    }, result.code)
                    JSONObject(body)
                }
            } catch (e: AuthRequestException) { throw e }
            catch (_: Exception) { throw AuthRequestException("Could not load profile activity.") }
        }
    }

    private fun username(name: String): String =
        name.trim().lowercase().takeIf(handlePattern::matches)
            ?: throw AuthRequestException("This profile address is invalid.")

    suspend fun state(name: String): ProfileActivityState {
        val o = rpc("profile_activity_state_phase33", JSONObject().put("p_username", username(name)))
        if (!o.optBoolean("available")) throw AuthRequestException("Profile activity is unavailable.")
        val permissions = o.optJSONObject("tabs") ?: JSONObject()
        val prefs = o.optJSONObject("preferences")
        return ProfileActivityState(
            owner = o.optBoolean("owner"),
            allowed = tabs.filter { it != "pins" }.associateWith { permissions.optBoolean(it) },
            likesPrivacy = prefs?.optString("likes", "private") ?: "private",
            savesPrivacy = prefs?.optString("saves", "private") ?: "private",
            hashtagsPrivacy = prefs?.optString("hashtags", "private") ?: "private"
        )
    }

    suspend fun entries(name: String, tab: String, limit: Int = 12, offset: Int = 0): ProfileActivityFeed {
        if (tab !in tabs) throw AuthRequestException("Unsupported profile category.")
        val normalized = username(name)
        val query = JSONObject().put("p_username", normalized)
        val result = when (tab) {
            "hashtags" -> rpc("profile_hashtags_phase33", query)
            "reposts" -> rpc("profile_reposts_feed_phase35",
                query.put("p_limit", limit.coerceIn(1, 50)).put("p_offset", offset.coerceIn(0, 500)))
            else -> rpc("profile_activity_feed_phase33",
                query.put("p_tab", tab).put("p_limit", if (tab == "pins") 3 else limit.coerceIn(1, 50))
                    .put("p_offset", offset.coerceIn(0, 500)))
        }
        if (!result.optBoolean("allowed")) throw AuthRequestException("This profile activity is private.")
        val rows = result.optJSONArray("items") ?: JSONArray()
        return ProfileActivityFeed(
            entries = if (tab == "hashtags") emptyList() else (0 until rows.length()).mapNotNull {
                val p = rows.optJSONObject(it) ?: return@mapNotNull null
                val author = p.optJSONObject("author") ?: JSONObject()
                val id = p.optString("id")
                if (!Regex("^[0-9a-fA-F-]{36}$").matches(id)) return@mapNotNull null
                val m = p.optJSONArray("media") ?: JSONArray()
                ProfileActivityEntry(
                    id = id, authorId = p.optString("author_id"),
                    authorHandle = author.optString("username"),
                    authorName = author.optString("display_name")
                        .takeIf { it.isNotBlank() && it != "null" }
                        ?: author.optString("username").ifBlank { "SautiLink member" },
                    hasAvatar = author.optString("avatar_key").takeIf { it.isNotBlank() && it != "null" } != null,
                    verified = author.optBoolean("is_verified"),
                    badgeType = author.optString("verification_badge_type", "standard"),
                    body = p.optString("body").takeUnless { it == "null" }.orEmpty(),
                    postedAt = p.optString("created_at"),
                    likes = p.optInt("like_count").coerceAtLeast(0),
                    comments = p.optInt("comment_count").coerceAtLeast(0),
                    reposts = p.optInt("repost_count").coerceAtLeast(0),
                    liked = p.optBoolean("viewer_liked"),
                    saved = p.optBoolean("viewer_saved"),
                    reposted = p.optBoolean("viewer_reposted"),
                    pinned = p.optBoolean("is_pinned") || p.opt("pin_position") !in arrayOf(null, JSONObject.NULL),
                    media = (0 until m.length()).mapNotNull { idx ->
                        val media = m.optJSONObject(idx) ?: return@mapNotNull null
                        val kind = media.optString("kind")
                        if (kind !in listOf("image", "video")) null
                        else FeedMedia(media.optString("id"), kind, media.optInt("position"))
                    }.sortedBy { it.position }.take(4)
                )
            },
            hashtags = if (tab != "hashtags") emptyList() else (0 until rows.length()).mapNotNull {
                val h = rows.optJSONObject(it) ?: return@mapNotNull null
                h.optString("tag").takeIf { tag -> tag.isNotBlank() }
                    ?.let { ProfileHashtag(it.removePrefix("#"), h.optInt("count").coerceAtLeast(0)) }
            }
        )
    }

    suspend fun setPinned(postId: String, pinned: Boolean) {
        if (!Regex("^[0-9a-fA-F-]{36}$").matches(postId))
            throw AuthRequestException("Invalid post reference.")
        rpc("set_profile_pin_phase33", JSONObject()
            .put("p_post_id", postId).put("p_pinned", pinned))
    }

    suspend fun savePrivacy(likes: String, saves: String, hashtags: String) {
        val valid = setOf("private", "followers", "public")
        if (listOf(likes, saves, hashtags).any { it !in valid })
            throw AuthRequestException("Choose a valid visibility option.")
        rpc("update_profile_activity_preferences_phase33", JSONObject()
            .put("p_likes_visibility", likes)
            .put("p_saves_visibility", saves)
            .put("p_hashtags_visibility", hashtags))
    }
}

internal data class ProfileActivityState(
    val owner: Boolean, val allowed: Map<String, Boolean>,
    val likesPrivacy: String, val savesPrivacy: String, val hashtagsPrivacy: String
)
internal data class ProfileActivityEntry(
    val id: String, val authorId: String, val authorHandle: String, val authorName: String,
    val hasAvatar: Boolean, val verified: Boolean, val badgeType: String,
    val body: String, val postedAt: String, val likes: Int, val comments: Int,
    val reposts: Int, val liked: Boolean, val saved: Boolean, val reposted: Boolean,
    val pinned: Boolean, val media: List<FeedMedia>
)
internal data class ProfileHashtag(val label: String, val count: Int)
internal data class ProfileActivityFeed(val entries: List<ProfileActivityEntry>, val hashtags: List<ProfileHashtag>)
