package com.sautilink.nativeapp.feature.home

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Environment-isolated, authenticated read-only feed; PostgREST enforces user RLS. */
data class StagingFeedPost(
    val id: String,
    val authorId: String,
    val authorName: String,
    val authorHandle: String,
    val verified: Boolean,
    val badgeType: String,
    val body: String,
    val createdAt: String,
    val likes: Int,
    val comments: Int,
    val reposts: Int,
    val mediaCount: Int,
    val media: List<FeedMedia>,
    val hasAvatar: Boolean
)

data class FeedMedia(val id: String, val kind: String, val position: Int,
    val width: Int = 0, val height: Int = 0)

data class StagingFeedPage(val posts: List<StagingFeedPost>, val nextOffset: Int, val hasMore: Boolean)

class StagingFeedClient(private val auth: StagingAuthClient) {
    private val endpoint = auth.restOrigin
    private val uuid = Regex("^[0-9a-fA-F-]{36}$")
    private val batchSize = 15
    private data class CachedPage(val owner: String, val page: StagingFeedPage, val at: Long)
    private companion object {
        val cacheLock = Any()
        val firstPages = mutableMapOf<String, CachedPage>()
    }
    private fun key(owner: String, mode: String) = "${auth.backend.id}:$owner:$mode"

    /** Private, memory-only first-page cache. Account changes and sign-out invalidate it. */
    fun cached(mode: String, maxAgeMs: Long = 5 * 60_000L): StagingFeedPage? = synchronized(cacheLock) {
        val owner = auth.account?.id ?: return@synchronized null
        val entry = firstPages[key(owner, mode)] ?: return@synchronized null
        entry.page.takeIf { entry.owner == owner && System.currentTimeMillis() - entry.at <= maxAgeMs }
    }

    fun cacheAgeMs(mode: String): Long? = synchronized(cacheLock) {
        val owner = auth.account?.id ?: return@synchronized null
        firstPages[key(owner, mode)]?.takeIf { it.owner == owner }?.let { System.currentTimeMillis() - it.at }
    }

    fun clearCache() = synchronized(cacheLock) {
        firstPages.keys.removeAll { it.startsWith("${auth.backend.id}:") }
    }

    private fun rememberPage(mode: String, offset: Int, page: StagingFeedPage, owner: String?) {
        if (offset != 0 || owner == null || auth.account?.id != owner) return
        synchronized(cacheLock) {
            firstPages.keys.removeAll { it.startsWith("${auth.backend.id}:") &&
                !it.startsWith("${auth.backend.id}:$owner:") }
            firstPages[key(owner, mode)] = CachedPage(owner, page, System.currentTimeMillis())
        }
    }

    /** Resolve a notification/deep-link post through the same RLS path as the feed. */
    suspend fun loadOne(postId: String): StagingFeedPost? {
        if (!uuid.matches(postId)) throw AuthRequestException("Invalid post link.")
        val token = auth.accessTokenForStagingRead()
        return withContext(Dispatchers.IO) {
            val post = getJsonArray("social_posts?id=eq.$postId&select=id,author_id,body,created_at,like_count,comment_count,repost_count,media_count&limit=1", token)
                .optJSONObject(0) ?: return@withContext null
            val authorId = post.optString("author_id")
            val author = if (uuid.matches(authorId)) getJsonArray(
                "social_profiles?id=eq.$authorId&select=id,username,display_name,is_verified,verification_badge_type,avatar_key&limit=1", token
            ).optJSONObject(0) else null
            val handle = author?.optString("username").orEmpty()
            val mediaRows = getJsonArray(
                "social_post_media?post_id=eq.$postId&upload_status=eq.attached&select=id,media_kind,position,width,height&order=position.asc&limit=4", token
            )
            val media = (0 until mediaRows.length()).mapNotNull { index ->
                val row = mediaRows.optJSONObject(index) ?: return@mapNotNull null
                val id = row.optString("id")
                val kind = row.optString("media_kind")
                if (!uuid.matches(id) || kind !in listOf("image", "video")) null
                else FeedMedia(id, kind, row.optInt("position"),
                    row.optInt("width"), row.optInt("height"))
            }
            StagingFeedPost(postId, authorId,
                author?.optString("display_name")?.takeUnless { it.isBlank() || it == "null" }
                    ?: handle.ifBlank { "SautiLink member" },
                handle, author?.optBoolean("is_verified", false) == true,
                author?.optString("verification_badge_type", "standard") ?: "standard",
                post.optString("body").takeUnless { it == "null" }.orEmpty(),
                post.optString("created_at"), post.optInt("like_count").coerceAtLeast(0),
                post.optInt("comment_count").coerceAtLeast(0), post.optInt("repost_count").coerceAtLeast(0),
                post.optInt("media_count").coerceAtLeast(0), media,
                author?.optString("avatar_key")?.takeIf { it.isNotBlank() && it != "null" } != null)
        }
    }

    suspend fun load(mode: String, offset: Int): StagingFeedPage {
        require(mode in setOf("for_you", "following", "short_videos", "saved", "trending")) { "Unsupported feed mode" }
        require(mode != "saved" || auth.backend == com.sautilink.nativeapp.feature.auth.SautiBackend.PRODUCTION) {
            "Saved posts are available only in the production account."
        }
        require(offset >= 0) { "Invalid feed offset" }
        // Auth client transparently refreshes a short-lived access token when required.
        val token = auth.accessTokenForStagingRead()
        return withContext(Dispatchers.IO) {
            // The standard SECURITY INVOKER feed RPC is chronological and visibility-aware.
            // Saved is a separate, RLS-protected, private bookmark listing for this user only.
            // Both paths only resolve post details through social_posts RLS, so vanished / blocked posts are omitted.
            val userId = auth.account?.id?.takeIf { uuid.matches(it) }
            if (mode == "saved" && userId == null) throw AuthRequestException("Sign in to see Saved posts.")
            val pointers = if (mode == "trending") {
                // Public posts from the last seven days, ranked by actual reactions/comments.
                // Collect leading candidates by several metrics, instead of privileging likes alone.
                // Every candidate remains subject to normal PostgREST RLS and blocks/mutes.
                val from = java.time.Instant.now().minus(7, java.time.temporal.ChronoUnit.DAYS)
                    .toString()
                val base = "social_posts?select=id,author_id,like_count,comment_count,repost_count,created_at" +
                    "&visibility=eq.public&circle_id=is.null&reply_to_post_id=is.null" +
                    "&post_status=eq.published&deleted_at=is.null&created_at=gte.$from"
                val candidates = sequenceOf("like_count", "comment_count", "repost_count")
                    .flatMap { sort ->
                        val rows = getJsonArray("$base&order=$sort.desc,created_at.desc&limit=250", token)
                        (0 until rows.length()).mapNotNull { rows.optJSONObject(it) }.asSequence()
                    }.distinctBy { it.optString("id") }.toList()
                val blocked = if (userId != null) {
                    val rows = getJsonArray(
                        "social_blocks?blocker_id=eq.$userId&select=blocked_id&limit=1000", token)
                    (0 until rows.length()).mapNotNull {
                        rows.optJSONObject(it)?.optString("blocked_id")
                    }.toSet()
                } else emptySet()
                val muted = if (userId != null) {
                    val rows = getJsonArray(
                        "social_mutes?muter_id=eq.$userId&select=muted_id&limit=1000", token)
                    (0 until rows.length()).mapNotNull {
                        rows.optJSONObject(it)?.optString("muted_id")
                    }.toSet()
                } else emptySet()
                val ranked = candidates.filter { p ->
                    uuid.matches(p.optString("id")) &&
                        p.optString("author_id") !in blocked &&
                        p.optString("author_id") !in muted
                }.sortedWith(compareByDescending<JSONObject> {
                    it.optLong("like_count").coerceAtLeast(0) +
                        2L * it.optLong("comment_count").coerceAtLeast(0) +
                        it.optLong("repost_count").coerceAtLeast(0)
                }.thenByDescending { it.optString("created_at") }).take(20)
                JSONArray().apply {
                    ranked.drop(offset).take(batchSize).forEach { post ->
                        put(JSONObject().put("post_id", post.optString("id")))
                    }
                }
            } else if (mode == "saved") {
                getJsonArray("social_saved_posts?user_id=eq.$userId&select=post_id,saved_at&order=saved_at.desc,post_id.desc&limit=$batchSize&offset=$offset", token)
            } else {
                getJsonArray("rpc/social_home_feed?p_mode=$mode&p_limit=$batchSize&p_offset=$offset", token)
            }
            val ids = (0 until pointers.length()).mapNotNull { i ->
                pointers.optJSONObject(i)?.optString("post_id")?.takeIf { uuid.matches(it) }
            }.distinct()
            if (ids.isEmpty()) {
                val page = StagingFeedPage(emptyList(), offset + pointers.length(),
                    pointers.length() == batchSize && (mode != "trending" || offset + pointers.length() < 20))
                rememberPage(mode, offset, page, userId)
                return@withContext page
            }

            val postRows = getJsonArray(
                "social_posts?id=in.(${ids.joinToString(",")})&select=id,author_id,body,created_at,like_count,comment_count,repost_count,media_count", token
            )
            val byId = (0 until postRows.length()).mapNotNull { postRows.optJSONObject(it) }
                .associateBy { it.optString("id") }
            val authorIds = byId.values.mapNotNull { it.optString("author_id").takeIf(uuid::matches) }.distinct()
            val authors = if (authorIds.isEmpty()) emptyMap() else {
                val rows = getJsonArray(
                    "social_profiles?id=in.(${authorIds.joinToString(",")})&select=id,username,display_name,is_verified,verification_badge_type,avatar_key", token
                )
                (0 until rows.length()).mapNotNull { rows.optJSONObject(it) }
                    .associateBy { it.optString("id") }
            }
            // Resolve only media metadata visible to this user under Supabase RLS.
            val mediaByPost = if (ids.isEmpty()) emptyMap() else {
                val mediaRows = getJsonArray(
                    "social_post_media?post_id=in.(${ids.joinToString(",")})&upload_status=eq.attached&select=id,post_id,media_kind,position,width,height&order=position.asc", token
                )
                (0 until mediaRows.length()).mapNotNull { mediaRows.optJSONObject(it) }
                    .filter { uuid.matches(it.optString("id")) && uuid.matches(it.optString("post_id")) }
                    .groupBy { it.optString("post_id") }
                    .mapValues { (_, rows) -> rows.mapNotNull { media ->
                        val kind = media.optString("media_kind")
                        if (kind !in listOf("image", "video")) null
                        else FeedMedia(media.optString("id"), kind, media.optInt("position", 0),
                            media.optInt("width"), media.optInt("height"))
                    }.sortedBy { it.position }.take(4) }
            }
            val results = ids.mapNotNull { postId ->
                val p = byId[postId] ?: return@mapNotNull null // May disappear due to RLS/moderation after RPC.
                val a = authors[p.optString("author_id")]
                val handle = a?.optString("username").orEmpty()
                StagingFeedPost(
                    id = postId,
                    authorId = p.optString("author_id"),
                    authorName = a?.optString("display_name")?.takeUnless { it.isBlank() || it == "null" }
                        ?: handle.ifBlank { "SautiLink member" },
                    authorHandle = handle,
                    verified = a?.optBoolean("is_verified", false) == true,
                    badgeType = a?.optString("verification_badge_type", "standard") ?: "standard",
                    body = p.optString("body").takeUnless { it == "null" }.orEmpty(),
                    createdAt = p.optString("created_at"),
                    likes = p.optInt("like_count", 0).coerceAtLeast(0),
                    comments = p.optInt("comment_count", 0).coerceAtLeast(0),
                    reposts = p.optInt("repost_count", 0).coerceAtLeast(0),
                    mediaCount = p.optInt("media_count", 0).coerceAtLeast(0),
                    media = mediaByPost[postId].orEmpty(),
                    hasAvatar = a?.optString("avatar_key")?.takeIf { it.isNotBlank() && it != "null" } != null
                )
            }
            StagingFeedPage(results, offset + pointers.length(),
                pointers.length() == batchSize && (mode != "trending" || offset + pointers.length() < 20)).also {
                rememberPage(mode, offset, it, userId)
            }
        }
    }

    /** The only feed network operation is HTTP GET; no post/like/comment state is changed. */
    private fun getJsonArray(route: String, token: String): JSONArray {
        val connection = URL(endpoint + route).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "GET"
            connection.connectTimeout = 10_000
            connection.readTimeout = 12_000
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.setRequestProperty("apikey", auth.publicKeyForRead())
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Cache-Control", "no-store")
            val status = connection.responseCode
            if (status !in 200..299) throw AuthRequestException(when (status) {
                401, 403 -> "Session expired or feed permission denied. Sign in again."
                404 -> "Feed endpoint is unavailable."
                429 -> "Too many requests. Try again shortly."
                in 500..599 -> "Feed server is temporarily unavailable."
                else -> "Could not load posts (HTTP $status)."
            }, status)
            val body = connection.inputStream.bufferedReader().use { reader -> reader.readText().take(400_000) }
            return JSONArray(body)
        } catch (e: AuthRequestException) {
            throw e
        } catch (_: Exception) {
            throw AuthRequestException("Could not load feed. Check internet and try again.")
        } finally {
            connection.disconnect()
        }
    }
}
