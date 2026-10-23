package com.sautilink.nativeapp.feature.explore

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.StagingFeedClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import com.sautilink.nativeapp.ui.text.normalizeExploreQuery
import com.sautilink.nativeapp.ui.text.exploreLiteralPattern
import java.util.concurrent.TimeUnit

data class ExplorePerson(val id: String, val username: String, val name: String, val bio: String,
    val followers: Int, val verified: Boolean, val badgeType: String,
    val hasAvatar: Boolean)
data class ExplorePost(val id: String, val authorHandle: String, val authorName: String,
    val body: String, val createdAt: String, val likes: Int, val comments: Int, val mediaCount: Int,
    val verified: Boolean, val badgeType: String)
data class ExploreResults(val people: List<ExplorePerson>, val posts: List<ExplorePost>, val trending: Boolean = false)

internal fun discoveryTrendingPosts(posts: List<com.sautilink.nativeapp.feature.home.StagingFeedPost>): List<ExplorePost> =
    posts.distinctBy { it.id }.take(5).map { post ->
        ExplorePost(post.id, post.authorHandle, post.authorName, post.body, post.createdAt,
            post.likes, post.comments, post.mediaCount, post.verified, post.badgeType)
    }

/** Search mirrors production Discover filters; every read is still subject to PostgREST RLS. */
class NativeExploreClient(private val auth: StagingAuthClient) {
    private val http = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build()
    private val uuid = Regex("^[0-9a-fA-F-]{36}$")

    private fun url(table: String, block: HttpUrl.Builder.() -> Unit): String =
        auth.restOrigin.toHttpUrl().newBuilder().addPathSegment(table).apply(block).build().toString()

    private fun rows(url: String, token: String): JSONArray {
        val request = Request.Builder().url(url).header("apikey", auth.publicKeyForRead())
            .header("Authorization", "Bearer $token").header("Accept", "application/json")
            .header("Cache-Control", "no-store").build()
        try {
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) throw AuthRequestException(when (response.code) {
                    401, 403 -> "Search access denied. Sign in again."
                    429 -> "Too many searches. Try again shortly."
                    in 500..599 -> "Search service is temporarily unavailable."
                    else -> "Search failed (HTTP ${response.code})."
                }, response.code)
                return JSONArray(response.body?.string()?.take(300_000).orEmpty())
            }
        } catch (e: AuthRequestException) { throw e }
        catch (_: Exception) { throw AuthRequestException("Could not connect to search.") }
    }

    suspend fun search(rawQuery: String): ExploreResults {
        val ownId = auth.account?.id?.takeIf(uuid::matches)
            ?: throw AuthRequestException("Sign in to explore SautiLink.")
        // The wildcard syntax belongs to the app; user input cannot turn into a broad PostgREST pattern.
        val query = normalizeExploreQuery(rawQuery)
        val pattern = exploreLiteralPattern(query)
        val token = auth.accessTokenForStagingRead()
        return withContext(Dispatchers.IO) {
            val blocked = rows(url("social_blocks") {
                addQueryParameter("blocker_id", "eq.$ownId")
                addQueryParameter("select", "blocked_id")
            }, token).objects().mapNotNull { it.optString("blocked_id").takeIf(uuid::matches) }.toSet()
            val muted = rows(url("social_mutes") {
                addQueryParameter("muter_id", "eq.$ownId")
                addQueryParameter("select", "muted_id")
            }, token).objects().mapNotNull { it.optString("muted_id").takeIf(uuid::matches) }.toSet()
            val personSelect = "id,username,display_name,bio,followers_count,is_verified,verification_badge_type,avatar_key"
            val personRows = (if (query.isBlank()) listOf("" ) else listOf("username", "display_name"))
                .flatMap { column -> rows(url("social_profiles") {
                    addQueryParameter("select", personSelect)
                    addQueryParameter("is_discoverable", "eq.true")
                    addQueryParameter("id", "neq.$ownId")
                    if (column.isNotBlank()) addQueryParameter(column, "ilike.$pattern")
                    addQueryParameter("order", "followers_count.desc,created_at.desc")
                    addQueryParameter("limit", "12")
                }, token).objects() }
            val people = personRows.asSequence().filter { it.optString("id") !in blocked }
                .filter { query.isNotBlank() || it.optString("id") !in muted }
                .distinctBy { it.optString("id") }.take(12).map { row ->
                    ExplorePerson(row.optString("id"), row.optString("username"),
                        row.optString("display_name").takeUnless { it.isBlank() || it == "null" }
                            ?: row.optString("username"),
                        row.optString("bio").takeUnless { it == "null" }.orEmpty(),
                        row.optInt("followers_count").coerceAtLeast(0), row.optBoolean("is_verified"),
                        row.optString("verification_badge_type", "standard"),
                        row.optString("avatar_key").takeIf { it.isNotBlank() && it != "null" } != null)
                }.toList()
            if (query.isBlank()) {
                // Use Home's existing public/RLS/block/mute-aware ranking, not a
                // chronological list presented as trending or invented metrics.
                val page = StagingFeedClient(auth).load("trending", 0)
                if (auth.account?.id != ownId) throw CancellationException("Explore account changed")
                return@withContext ExploreResults(people, discoveryTrendingPosts(page.posts), trending = true)
            }
            val postRows = rows(url("social_posts") {
                addQueryParameter("select", "id,author_id,body,created_at,like_count,comment_count,media_count")
                addQueryParameter("visibility", "eq.public")
                addQueryParameter("circle_id", "is.null")
                addQueryParameter("reply_to_post_id", "is.null")
                if (query.isNotBlank()) addQueryParameter("body", "ilike.$pattern")
                addQueryParameter("order", "created_at.desc")
                addQueryParameter("limit", "30")
            }, token).objects().filter { row ->
                val author = row.optString("author_id")
                author !in blocked && (query.isNotBlank() || author !in muted)
            }
            val authorIds = postRows.mapNotNull { it.optString("author_id").takeIf(uuid::matches) }.distinct()
            val authorById = if (authorIds.isEmpty()) emptyMap() else rows(url("social_profiles") {
                addQueryParameter("select", "id,username,display_name,is_verified,verification_badge_type")
                addQueryParameter("id", "in.(${authorIds.joinToString(",")})")
            }, token).objects().associateBy { it.optString("id") }
            val posts = postRows.mapNotNull { row ->
                val id = row.optString("id")
                if (!uuid.matches(id)) return@mapNotNull null
                val author = authorById[row.optString("author_id")]
                val handle = author?.optString("username").orEmpty()
                ExplorePost(id, handle, author?.optString("display_name")
                    ?.takeUnless { it.isBlank() || it == "null" } ?: handle.ifBlank { "SautiLink member" },
                    row.optString("body").takeUnless { it == "null" }.orEmpty(),
                    row.optString("created_at"), row.optInt("like_count").coerceAtLeast(0),
                    row.optInt("comment_count").coerceAtLeast(0), row.optInt("media_count").coerceAtLeast(0),
                    author?.optBoolean("is_verified", false) == true,
                    author?.optString("verification_badge_type", "standard") ?: "standard")
            }
            if (auth.account?.id != ownId) throw CancellationException("Explore account changed")
            ExploreResults(people, posts)
        }
    }
}

private fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull(::optJSONObject)
