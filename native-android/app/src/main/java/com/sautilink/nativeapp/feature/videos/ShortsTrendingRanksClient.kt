package com.sautilink.nativeapp.feature.videos

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.home.awaitFollowReadBytes
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.concurrent.TimeUnit

private val shortsRankUuid = Regex("[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}")

internal fun shortsTrendingRanks(candidates: List<JSONObject>, excludedAuthors: Set<String>): Map<String, ShortsTrendingRank> =
    candidates.asSequence().filter { shortsRankUuid.matches(it.optString("id")) &&
        shortsRankUuid.matches(it.optString("author_id")) && it.optString("author_id") !in excludedAuthors &&
        runCatching { Instant.parse(it.optString("created_at")) }.isSuccess }
        .distinctBy { it.optString("id") }.sortedWith(compareByDescending<JSONObject> {
            it.optLong("like_count").coerceAtLeast(0L) + 2L * it.optLong("comment_count").coerceAtLeast(0L) +
                it.optLong("repost_count").coerceAtLeast(0L)
        }.thenByDescending { it.optString("created_at") }).take(20).mapIndexed { index, row ->
            row.getString("id").let { it to ShortsTrendingRank(it, index + 1) }
        }.toMap()

/** Optional read-only badge metadata, never a prerequisite for video playback.
 * Same last-seven-days candidate union and score as Home Trending, with no media
 * byte/descriptor loads and no persisted rank or synthetic fallback.
 */
internal class ShortsTrendingRanksClient(private val auth: StagingAuthClient) {
    private val http = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .connectTimeout(6, TimeUnit.SECONDS).readTimeout(10, TimeUnit.SECONDS)
        .callTimeout(15, TimeUnit.SECONDS).cache(null).build()
    suspend fun load(): Map<String, ShortsTrendingRank> = coroutineScope {
        val owner = auth.account?.id?.takeIf(shortsRankUuid::matches)
            ?: throw AuthRequestException("Sign in to read Trending.")
        val token = auth.accessTokenForStagingRead()
        if (auth.account?.id != owner) throw CancellationException("Trending account changed")
        suspend fun rows(path: String): List<JSONObject> {
            currentCoroutineContext().ensureActive()
            if (auth.account?.id != owner) throw CancellationException("Trending account changed")
            val request = Request.Builder().url(auth.restOrigin + path).header("Authorization", "Bearer $token")
                .header("apikey", auth.publicKeyForRead()).header("Accept", "application/json")
                .header("Cache-Control", "no-store").get().build()
            val bytes = awaitFollowReadBytes(http.newCall(request), 180_000)
            if (auth.account?.id != owner) throw CancellationException("Trending account changed")
            val array = JSONArray(bytes.toString(Charsets.UTF_8))
            return (0 until array.length()).mapNotNull(array::optJSONObject)
        }
        val from = Instant.now().minus(7, ChronoUnit.DAYS)
        val base = "social_posts?select=id,author_id,like_count,comment_count,repost_count,created_at" +
            "&visibility=eq.public&circle_id=is.null&reply_to_post_id=is.null" +
            "&post_status=eq.published&deleted_at=is.null&created_at=gte.$from"
        val candidates = listOf("like_count", "comment_count", "repost_count").map { metric ->
            async { rows("$base&order=$metric.desc,created_at.desc&limit=250") }
        }
        val blocks = async { rows("social_blocks?blocker_id=eq.$owner&select=blocked_id&limit=1000") }
        val mutes = async { rows("social_mutes?muter_id=eq.$owner&select=muted_id&limit=1000") }
        val excluded = blocks.await().map { it.optString("blocked_id") }.toSet() +
            mutes.await().map { it.optString("muted_id") }.toSet()
        val ranked = shortsTrendingRanks(candidates.flatMap { it.await() }, excluded)
        if (auth.account?.id != owner) throw CancellationException("Trending account changed")
        ranked
    }
}
