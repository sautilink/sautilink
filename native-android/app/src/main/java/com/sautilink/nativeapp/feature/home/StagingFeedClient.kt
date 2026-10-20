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
    val width: Int = 0, val height: Int = 0, val durationMs: Long = 0L)

data class StagingFeedPage(val posts: List<StagingFeedPost>, val nextOffset: Int, val hasMore: Boolean)

/** Memory-only, account/environment-scoped rows. This never changes server verification. */
internal class StagingFeedCache {
    internal data class ReadStamp(val generation: Long, val verificationRemoval: Long)
    private data class CachedPage(val page: StagingFeedPage, val at: Long, val generation: Long)
    private val lock = Any()
    private val firstPages = mutableMapOf<String, CachedPage>()
    private val generations = mutableMapOf<String, Long>()
    private val verificationRemovals = mutableMapOf<String, Long>()
    private fun ownerKey(backend: String, owner: String) = "$backend:$owner:"
    private fun key(backend: String, owner: String, mode: String) = ownerKey(backend, owner) + mode

    fun readStamp(backend: String, owner: String?, mode: String): ReadStamp = synchronized(lock) {
        if (owner == null) ReadStamp(0L, 0L) else ReadStamp(
            generations[key(backend, owner, mode)] ?: 0L,
            verificationRemovals[ownerKey(backend, owner)] ?: 0L)
    }

    fun cached(backend: String, owner: String?, mode: String, maxAgeMs: Long,
        now: Long = System.currentTimeMillis()): StagingFeedPage? = synchronized(lock) {
        if (owner == null) return@synchronized null
        firstPages[key(backend, owner, mode)]?.takeIf { now - it.at <= maxAgeMs }?.page
    }

    fun ageMs(backend: String, owner: String?, mode: String,
        now: Long = System.currentTimeMillis()): Long? = synchronized(lock) {
        if (owner == null) return@synchronized null
        val cacheKey = key(backend, owner, mode)
        firstPages[cacheKey]?.let {
            if (it.generation != (generations[cacheKey] ?: 0L)) Long.MAX_VALUE else now - it.at
        }
    }

    fun invalidateFollowing(backend: String, owner: String?) = synchronized(lock) {
        if (owner == null) return@synchronized
        val cacheKey = key(backend, owner, "following")
        generations[cacheKey] = (generations[cacheKey] ?: 0L) + 1L
    }

    /** Call only after the server confirms this owner's removal. Keep offline rows, force revalidation. */
    fun confirmOwnVerificationRemoved(backend: String, owner: String,
        currentOwner: () -> String?): Boolean = synchronized(lock) {
        if (owner.isBlank() || currentOwner() != owner) return@synchronized false
        val prefix = ownerKey(backend, owner)
        verificationRemovals[prefix] = (verificationRemovals[prefix] ?: 0L) + 1L
        val modes = setOf("for_you", "following", "short_videos", "saved", "trending") +
            firstPages.keys.filter { it.startsWith(prefix) }.map { it.removePrefix(prefix) }
        modes.forEach { mode ->
            val cacheKey = key(backend, owner, mode)
            generations[cacheKey] = (generations[cacheKey] ?: 0L) + 1L
            firstPages[cacheKey]?.let { entry ->
                firstPages[cacheKey] = entry.copy(page = entry.page.copy(posts =
                    entry.page.posts.map { demoteOwnPost(it, owner) }))
            }
        }
        true
    }

    fun clear(backend: String) = synchronized(lock) {
        firstPages.keys.removeAll { it.startsWith("$backend:") }
    }

    /** The same guard covers rows returned to the UI and rows committed to the cache. */
    fun finishPage(backend: String, owner: String?, mode: String, offset: Int,
        page: StagingFeedPage, stamp: ReadStamp, currentOwner: () -> String?,
        now: Long = System.currentTimeMillis()): StagingFeedPage = synchronized(lock) {
        val result = if (removalOccurred(backend, owner, stamp))
            page.copy(posts = page.posts.map { demoteOwnPost(it, owner!!) }) else page
        if (offset == 0 && owner != null && currentOwner() == owner &&
            stamp.generation == (generations[key(backend, owner, mode)] ?: 0L)) {
            firstPages.keys.removeAll { it.startsWith("$backend:") &&
                !it.startsWith(ownerKey(backend, owner)) }
            firstPages[key(backend, owner, mode)] = CachedPage(result, now, stamp.generation)
        }
        result
    }

    fun finishPost(backend: String, owner: String?, post: StagingFeedPost?,
        stamp: ReadStamp): StagingFeedPost? = synchronized(lock) {
        if (post != null && removalOccurred(backend, owner, stamp)) demoteOwnPost(post, owner!!) else post
    }

    private fun removalOccurred(backend: String, owner: String?, stamp: ReadStamp): Boolean =
        owner != null && stamp.verificationRemoval != (verificationRemovals[ownerKey(backend, owner)] ?: 0L)

    private fun demoteOwnPost(post: StagingFeedPost, owner: String): StagingFeedPost =
        if (post.authorId == owner) post.copy(verified = false, badgeType = "standard") else post
}

class StagingFeedClient(private val auth: StagingAuthClient) {
    private val endpoint = auth.restOrigin
    private val uuid = Regex("^[0-9a-fA-F-]{36}$")
    private val batchSize = 15
    private companion object {
        val cache = StagingFeedCache()
    }

    /** Private, memory-only first-page cache. Account changes and sign-out invalidate it. */
    fun cached(mode: String, maxAgeMs: Long = 5 * 60_000L): StagingFeedPage? =
        cache.cached(auth.backend.id, auth.account?.id, mode, maxAgeMs)

    fun cacheAgeMs(mode: String): Long? = cache.ageMs(auth.backend.id, auth.account?.id, mode)

    /** A confirmed relationship change makes only this account's Following page stale.
     * Keep recent rows for offline fallback while rejecting older in-flight cache writes. */
    fun invalidateFollowing() = cache.invalidateFollowing(auth.backend.id, auth.account?.id)

    fun confirmOwnVerificationRemoved(ownerId: String): Boolean =
        cache.confirmOwnVerificationRemoved(auth.backend.id, ownerId) { auth.account?.id }

    fun clearCache() = cache.clear(auth.backend.id)

    /** Resolve a notification/deep-link post through the same RLS path as the feed. */
    suspend fun loadOne(postId: String): StagingFeedPost? {
        if (!uuid.matches(postId)) throw AuthRequestException("Invalid post link.")
        val token = auth.accessTokenForStagingRead()
        return withContext(Dispatchers.IO) {
            val owner = auth.account?.id
            val stamp = cache.readStamp(auth.backend.id, owner, "for_you")
            val post = getJsonArray("social_posts?id=eq.$postId&select=id,author_id,circle_id,body,created_at,like_count,comment_count,repost_count,media_count&limit=1", token)
                .optJSONObject(0) ?: return@withContext null
            val authorId = post.optString("author_id")
            val author = if (uuid.matches(authorId)) getJsonArray(
                "social_profiles?id=eq.$authorId&select=id,username,display_name,is_verified,verification_badge_type,avatar_key&limit=1", token
            ).optJSONObject(0) else null
            val handle = author?.optString("username").orEmpty()
            // Rooms already support five images; preserve the existing bound for other posts.
            val mediaLimit = if (uuid.matches(post.optString("circle_id"))) 5 else 4
            val mediaRows = getJsonArray(
                "social_post_media?post_id=eq.$postId&upload_status=eq.attached&select=id,media_kind,position,width,height,duration_ms&order=position.asc&limit=$mediaLimit", token
            )
            val media = (0 until mediaRows.length()).mapNotNull { index ->
                val row = mediaRows.optJSONObject(index) ?: return@mapNotNull null
                val id = row.optString("id")
                val kind = row.optString("media_kind")
                if (!uuid.matches(id) || kind !in listOf("image", "video")) null
                else FeedMedia(id, kind, row.optInt("position"),
                    row.optInt("width"), row.optInt("height"), row.optLong("duration_ms", 0L))
            }
            val result = StagingFeedPost(postId, authorId,
                author?.optString("display_name")?.takeUnless { it.isBlank() || it == "null" }
                    ?: handle.ifBlank { "SautiLink member" },
                handle, author?.optBoolean("is_verified", false) == true,
                author?.optString("verification_badge_type", "standard") ?: "standard",
                post.optString("body").takeUnless { it == "null" }.orEmpty(),
                post.optString("created_at"), post.optInt("like_count").coerceAtLeast(0),
                post.optInt("comment_count").coerceAtLeast(0), post.optInt("repost_count").coerceAtLeast(0),
                post.optInt("media_count").coerceAtLeast(0), media,
                author?.optString("avatar_key")?.takeIf { it.isNotBlank() && it != "null" } != null)
            cache.finishPost(auth.backend.id, owner, result, stamp)
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
            val stamp = cache.readStamp(auth.backend.id, userId, mode)
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
                return@withContext cache.finishPage(auth.backend.id, userId, mode, offset, page, stamp,
                    { auth.account?.id })
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
                    "social_post_media?post_id=in.(${ids.joinToString(",")})&upload_status=eq.attached&select=id,post_id,media_kind,position,width,height,duration_ms&order=position.asc", token
                )
                (0 until mediaRows.length()).mapNotNull { mediaRows.optJSONObject(it) }
                    .filter { uuid.matches(it.optString("id")) && uuid.matches(it.optString("post_id")) }
                    .groupBy { it.optString("post_id") }
                    .mapValues { (_, rows) -> rows.mapNotNull { media ->
                        val kind = media.optString("media_kind")
                        if (kind !in listOf("image", "video")) null
                        else FeedMedia(media.optString("id"), kind, media.optInt("position", 0),
                            media.optInt("width"), media.optInt("height"), media.optLong("duration_ms", 0L))
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
            val page = StagingFeedPage(results, offset + pointers.length(),
                pointers.length() == batchSize && (mode != "trending" || offset + pointers.length() < 20))
            cache.finishPage(auth.backend.id, userId, mode, offset, page, stamp, { auth.account?.id })
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
