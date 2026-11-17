package com.sautilink.nativeapp.feature.dashboard

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import java.time.ZoneOffset

internal data class CreatorDaily(
    val day: LocalDate,
    val views: Long, val engagement: Long, val gained: Long,
    val lost: Long, val profileVisits: Long
) {
    val netFollows get() = gained - lost
}

internal data class CreatorPost(
    val id: String, val text: String, val createdAt: String, val views: Long,
    val engagement: Long, val likes: Long, val comments: Long,
    val media: CreatorPostMedia? = null
)
internal data class CreatorPostMedia(val id: String, val kind: String)
internal data class CreatorAnalytics(
    val days: List<CreatorDaily>, val topContent: List<CreatorPost>, val weeklyPosts: Long?
)

/** Native read-only frontend of the same owner-only metrics used by SautiLink Web Dashboard.
 * No guessed historical visits, no fake earnings, no new DB tables.
 */
internal class CreatorAnalyticsClient(private val auth: StagingAuthClient) {
    private val idRegex = Regex("^[0-9a-fA-F-]{36}$")
    private fun fetch(path: String, token: String): JSONArray = request(path, token) { connection ->
        val response = connection.inputStream.bufferedReader().use { it.readText().take(450_000) }
        JSONArray(response)
    }

    private fun count(path: String, token: String): Long? = request(path, token, count = true) { connection ->
        connection.getHeaderField("Content-Range")?.substringAfterLast('/')?.toLongOrNull()
    }

    private fun <T> request(path: String, token: String, count: Boolean = false,
        read: (HttpURLConnection) -> T): T {
        val url = URL(auth.restOrigin + path)
        val connection = url.openConnection() as HttpURLConnection
        try {
            connection.requestMethod = if (count) "HEAD" else "GET"
            if (count) connection.setRequestProperty("Prefer", "count=exact")
            connection.connectTimeout = 12_000
            connection.readTimeout = 14_000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("apikey", auth.publicKeyForRead())
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Cache-Control", "no-store")
            if (connection.responseCode !in 200..299)
                throw AuthRequestException("Dashboard data could not be loaded (HTTP ${connection.responseCode}).")
            return read(connection)
        } finally { connection.disconnect() }
    }

    suspend fun load(window: Int): CreatorAnalytics {
        require(window in setOf(1, 7, 28, 90))
        val own = auth.account?.id?.takeIf(idRegex::matches)
            ?: throw AuthRequestException("Sign in to view your Dashboard.")
        val token = auth.accessTokenForStagingRead()
        if (auth.account?.id != own) throw kotlinx.coroutines.CancellationException("Dashboard account changed")
        val today = LocalDate.now(ZoneOffset.UTC)
        val dayCount = maxOf(7, window * 2)
        val start = today.minusDays(dayCount - 1L)
        val weeklyStart = today.minusDays(6).atStartOfDay().toInstant(ZoneOffset.UTC)
        return withContext(Dispatchers.IO) {
            try {
                val metrics = fetch("social_creator_daily_metrics?user_id=eq.$own" +
                    "&metric_date=gte.$start" +
                    "&select=metric_date,profile_views,content_views,engagements,follows_gained,follows_lost" +
                    "&metric_date=lte.$today&order=metric_date.asc&limit=$dayCount", token)
                val days = (0 until metrics.length()).mapNotNull {
                    val m = metrics.optJSONObject(it) ?: return@mapNotNull null
                    val date = runCatching { LocalDate.parse(m.optString("metric_date")) }.getOrNull()
                        ?: return@mapNotNull null
                    CreatorDaily(date, m.optLong("content_views").coerceAtLeast(0),
                        m.optLong("engagements").coerceAtLeast(0),
                        m.optLong("follows_gained").coerceAtLeast(0),
                        m.optLong("follows_lost").coerceAtLeast(0),
                        m.optLong("profile_views").coerceAtLeast(0))
                }
                val ownedPosts = "social_posts?author_id=eq.$own&parent_post_id=is.null" +
                    "&circle_id=is.null&post_status=eq.published&deleted_at=is.null"
                val weeklyPosts = try { count("$ownedPosts&select=id&created_at=gte.$weeklyStart&limit=1", token) }
                catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
                catch (_: Exception) { null }
                val postRows = fetch(ownedPosts +
                    "&select=id,body,created_at,like_count,comment_count,repost_count" +
                    "&order=created_at.desc&limit=50", token)
                val posts = (0 until postRows.length()).mapNotNull { postRows.optJSONObject(it) }
                val postIds = posts.map { it.optString("id") }.filter(idRegex::matches)
                val views = if (postIds.isNotEmpty()) {
                    val rows = fetch("social_post_metrics?post_id=in.(${postIds.joinToString(",")})" +
                        "&select=post_id,view_count", token)
                    (0 until rows.length()).mapNotNull { rows.optJSONObject(it) }
                        .associate { it.optString("post_id") to it.optLong("view_count").coerceAtLeast(0) }
                } else emptyMap()
                val content = posts.mapNotNull {
                    val id = it.optString("id").takeIf(idRegex::matches) ?: return@mapNotNull null
                    val likes = it.optLong("like_count").coerceAtLeast(0)
                    val comments = it.optLong("comment_count").coerceAtLeast(0)
                    val reposts = it.optLong("repost_count").coerceAtLeast(0)
                    CreatorPost(id, it.optString("body").takeUnless { body -> body == "null" }.orEmpty(),
                        it.optString("created_at"), views[id] ?: 0,
                        likes + comments + reposts, likes, comments)
                }.sortedWith(compareByDescending<CreatorPost> { it.views + it.engagement }
                    .thenByDescending { it.createdAt }).take(5)
                val media = if (content.isEmpty()) emptyMap() else {
                    val rows = fetch("social_post_media?post_id=in.(${content.joinToString(",") { it.id }})" +
                        "&upload_status=eq.attached&select=id,post_id,media_kind,position&order=position.asc&limit=50", token)
                    creatorContentMedia(rows, content.map { it.id }.toSet())
                }
                if (auth.account?.id != own) throw kotlinx.coroutines.CancellationException("Dashboard account changed")
                CreatorAnalytics(days, content.map { it.copy(media = media[it.id]) }, weeklyPosts)
            } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled
            } catch (e: AuthRequestException) { throw e }
            catch (_: Exception) { throw AuthRequestException(
                "Dashboard analytics are temporarily unavailable. No values have been estimated."
            ) }
        }
    }
}
