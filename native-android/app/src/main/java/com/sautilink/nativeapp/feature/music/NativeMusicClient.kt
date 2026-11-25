package com.sautilink.nativeapp.feature.music

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import com.sautilink.nativeapp.ui.components.NativePublicAssets
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.concurrent.TimeUnit

const val MUSIC_ORIGIN = "https://music.sautilink.com"

data class NativeAudioSelection(val trackId: String, val title: String, val artist: String,
    val startMs: Long, val durationMs: Long) {
    fun json() = JSONObject().put("trackId", trackId).put("title", title).put("artist", artist)
        .put("startMs", startMs).put("durationMs", durationMs)
    fun previewUrl() = "$MUSIC_ORIGIN/v1/tracks/$trackId/preview?placement=feed&startMs=$startMs&durationMs=$durationMs"
    companion object {
        fun from(row: JSONObject?): NativeAudioSelection? {
            if (row == null) return null
            val id = row.optString("trackId")
            if (!Regex("[a-z0-9-]{1,80}").matches(id)) return null
            val start = row.optLong("startMs", -1)
            val duration = row.optLong("durationMs", -1)
            if (start < 0 || duration !in 1000..180000) return null
            return NativeAudioSelection(id, row.optString("title"), row.optString("artist"), start, duration)
        }
    }
}

data class NativeMusicTrack(val id: String, val title: String, val artist: String,
    val durationMs: Long, val windowStartMs: Long, val windowEndMs: Long, val maxClipMs: Long,
    val releasedOn: String?, val original: Boolean, val uses: Long = 0, val saved: Boolean = false) {
    fun selection(start: Long = windowStartMs, duration: Long = minOf(30_000L, maxClipMs)) =
        NativeAudioSelection(id, title, artist, start, minOf(duration, maxClipMs, windowEndMs - start))
    val isNew: Boolean get() = isNewMusicRelease(releasedOn)
}

internal fun isNewMusicRelease(releasedOn: String?, now: Instant = Instant.now()): Boolean =
    releasedOn?.let { date -> runCatching {
        val release = LocalDate.parse(date).atStartOfDay().toInstant(ZoneOffset.UTC)
        val age = java.time.Duration.between(release, now)
        !age.isNegative && age < java.time.Duration.ofDays(7)
    }.getOrDefault(false) } ?: false

class NativeMusicClient(private val auth: StagingAuthClient) {
    private val http = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build()

    private suspend fun rest(path: String, method: String = "GET", body: JSONObject? = null): JSONArray {
        val owner = auth.account?.id ?: throw AuthRequestException("Sign in to use your music library.")
        val token = auth.accessTokenForStagingRead()
        return withContext(Dispatchers.IO) {
            val request = Request.Builder().url(auth.restOrigin + path)
                .header("apikey", auth.publicKeyForRead()).header("Authorization", "Bearer $token")
                .header("Cache-Control", "no-store")
            when (method) {
                "POST" -> request.post(body.toString().toRequestBody("application/json".toMediaType()))
                "DELETE" -> request.delete()
            }
            http.newCall(request.build()).execute().use { response ->
                if (!response.isSuccessful) throw AuthRequestException("Your music library could not be updated. Try again.", response.code)
                if (auth.account?.id != owner) throw CancellationException("Music account changed")
                val raw = response.body?.string().orEmpty()
                if (raw.isBlank()) JSONArray() else JSONArray(raw)
            }
        }
    }

    suspend fun savedIds(): Set<String> {
        val owner = auth.account?.id ?: return emptySet()
        val rows = rest("social_saved_audio?owner_id=eq.$owner&select=track_id&order=saved_at.desc&limit=1000")
        return (0 until rows.length()).map { rows.getJSONObject(it).getString("track_id") }.toSet()
    }

    suspend fun save(trackId: String, save: Boolean) {
        require(Regex("[a-z0-9-]{1,80}").matches(trackId))
        val owner = auth.account?.id ?: throw AuthRequestException("Sign in to save audio.")
        if (save) {
            // Ignore a duplicate save, preserving idempotence without requiring UPDATE access.
            try { rest("social_saved_audio", "POST", JSONObject().put("owner_id", owner).put("track_id", trackId)) }
            catch (failure: AuthRequestException) { if (failure.httpStatus != 409) throw failure }
        } else rest("social_saved_audio?owner_id=eq.$owner&track_id=eq.$trackId", "DELETE")
    }

    suspend fun catalog(query: String = ""): List<NativeMusicTrack> = coroutineScope {
        val owner = auth.account?.id
        val savedRead = async { savedIds() }
        val tracks = withContext(Dispatchers.IO) {
            val collected = mutableListOf<NativeMusicTrack>()
            var offset = 0
            do {
                val url = "$MUSIC_ORIGIN/v1/tracks".toHttpUrl().newBuilder()
                    .addQueryParameter("placement", "feed").addQueryParameter("compact", "1").addQueryParameter("q", query.take(160))
                    .addQueryParameter("limit", "50").addQueryParameter("offset", offset.toString()).build()
                val more = NativePublicAssets.http.newCall(Request.Builder().url(url).build()).execute().use { response ->
                    if (!response.isSuccessful) throw AuthRequestException("Music could not load. Please try again.", response.code)
                    val result = JSONObject(response.body?.string().orEmpty())
                    val rows = result.optJSONArray("tracks") ?: JSONArray()
                    for (i in 0 until rows.length()) {
                        val row = rows.getJSONObject(i)
                        val grant = row.getJSONObject("license")
                        val id = row.getString("id")
                        if (!Regex("[a-z0-9-]{1,80}").matches(id)) continue
                        collected += NativeMusicTrack(id, row.getString("title"), row.getString("artist"),
                            row.getLong("durationMs"), grant.getLong("windowStartMs"), grant.getLong("windowEndMs"),
                            grant.getLong("maxClipMs"), row.optString("releasedOn").takeUnless { it.isBlank() || it == "null" },
                            row.optBoolean("originalAudio"))
                    }
                    if (result.isNull("nextOffset")) null else result.optInt("nextOffset")
                }
                if (more == null || more <= offset) break
                offset = more
            } while (offset < 1000)
            collected
        }
        val usage = mutableMapOf<String, Long>()
        for (batch in tracks.map { it.id }.chunked(50)) {
            val rows = rest("rpc/social_audio_usage", "POST", JSONObject().put("track_ids", JSONArray(batch)))
            for (i in 0 until rows.length()) rows.getJSONObject(i).let { usage[it.getString("track_id")] = it.getLong("uses") }
        }
        if (owner != auth.account?.id) throw CancellationException("Music account changed")
        val saved = savedRead.await()
        tracks.map { it.copy(uses = usage[it.id] ?: 0, saved = it.id in saved) }
    }
}
