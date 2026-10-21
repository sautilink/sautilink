package com.sautilink.nativeapp.ui.components

import androidx.compose.runtime.*
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import java.net.URI
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** The backend chooses HLS explicitly after processing. A URL suffix never guesses its type. */
internal data class NativeVideoSource(
    val mediaId: String,
    val url: String,
    val hls: Boolean,
    val expiresAtMillis: Long? = null,
    val qualities: List<Int> = emptyList(),
    val cacheKey: String? = null,
) {
    val gatewayPrefix: String? get() = if (hls) URI(url).let { it.scheme + "://" + it.host + it.rawPath.substringBeforeLast('/') + "/" } else null
}

private val playbackUuid = "[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}"
private val playbackOrigins = setOf("https://sautilink.com", "https://test.sautilink.com")

internal fun trustedPlaybackMetadataPath(path: String): Boolean =
    Regex("/api/sauti-media/$playbackUuid/playback").matches(path) ||
        Regex("/api/stories/$playbackUuid/playback").matches(path)

/** Gateway capabilities are unforgeable server grants, bound to account/content/expiry.
 * No CDN host, redirect, encoded slash, parent path or arbitrary request may receive a bearer.
 */
internal fun authenticatedHlsUrl(origin: String, url: String): Boolean {
    if (origin !in playbackOrigins) return false
    val uri = runCatching { URI(url) }.getOrNull() ?: return false
    if (uri.scheme != "https" || uri.host != URI(origin).host || uri.port != -1 || uri.userInfo != null || uri.fragment != null) return false
    return Regex("/api/(?:sauti-media|stories)/$playbackUuid/hls/[A-Za-z0-9_-]{1,2048}").matches(uri.rawPath.orEmpty()) &&
        Regex("c=[A-Za-z0-9_-]{1,4096}\\.[A-Za-z0-9_-]{43}").matches(uri.rawQuery.orEmpty())
}

internal fun parseNativeVideoSource(origin: String, metadataPath: String, body: String, nowMillis: Long): NativeVideoSource {
    require(origin in playbackOrigins && trustedPlaybackMetadataPath(metadataPath)) { "Unsupported playback endpoint" }
    val root = JSONObject(body)
    require(root.optBoolean("ok", false)) { "Playback response was not successful" }
    val data = root.getJSONObject("data")
    val contentPath = metadataPath.removeSuffix("/playback")
    val mediaId = contentPath.substringAfterLast('/')
    val supplied = data.getString("url")
    val url = if (supplied.startsWith("/") && !supplied.startsWith("//")) origin + supplied else supplied
    return when (data.getString("type")) {
        "hls" -> {
            require(authenticatedHlsUrl(origin, url) && URI(url).rawPath.startsWith("$contentPath/hls/")) { "Untrusted HLS source" }
            val expiry = java.time.Instant.parse(data.getString("expires_at")).toEpochMilli()
            require(expiry > nowMillis + 5_000L && expiry <= nowMillis + 15 * 60_000L) { "Playback grant expired or exceeds its lifetime" }
            val qualities = data.optJSONArray("qualities")?.let { values ->
                (0 until values.length()).map { values.optInt(it, 0) }.filter { it in 144..4320 }.distinct().sorted()
            }.orEmpty().take(16)
            val cacheKey = data.optString("cache_key").takeIf { Regex(playbackUuid).matches(it) }
            NativeVideoSource(mediaId, url, true, expiry, qualities, cacheKey)
        }
        "mp4" -> {
            require(metadataPath.startsWith("/api/sauti-media/") && url == origin + contentPath && authenticatedVideoUrl(origin, url)) { "Untrusted MP4 fallback" }
            NativeVideoSource(mediaId, url, false)
        }
        else -> throw IOException("Unsupported playback format")
    }
}

/** Short-lived grant metadata stays in memory; cache reads cannot outlive authorization. */
internal class NativeHlsGrantRegistry(private val now: () -> Long = System::currentTimeMillis) {
    private data class Grant(val expiry: Long, val cacheKey: String?)
    private val grants = linkedMapOf<String, Grant>()
    @Synchronized fun authorize(source: NativeVideoSource) {
        val prefix = source.gatewayPrefix ?: return
        val expiry = source.expiresAtMillis ?: return
        grants.entries.removeAll { it.value.expiry <= now() }
        grants.remove(prefix)
        if (expiry > now()) grants[prefix] = Grant(expiry, source.cacheKey?.takeIf { Regex(playbackUuid).matches(it) })
        while (grants.size > 4) grants.remove(grants.keys.first())
    }
    @Synchronized fun allows(url: String): Boolean {
        val uri = runCatching { URI(url) }.getOrNull() ?: return false
        val origin = "${uri.scheme}://${uri.host}"
        if (!authenticatedHlsUrl(origin, url)) return false
        val prefix = origin + uri.rawPath.substringBeforeLast('/') + "/"
        return (grants[prefix]?.expiry ?: 0L) > now()
    }
    @Synchronized fun cacheIdentity(url: String): String? {
        if (!allows(url)) return null
        val uri = URI(url)
        val opaque = uri.rawPath.substringAfterLast('/')
        if (!Regex("s_[A-Za-z0-9_-]{43}").matches(opaque)) return null
        val prefix = "${uri.scheme}://${uri.host}" + uri.rawPath.substringBeforeLast('/') + "/"
        val generation = grants[prefix]?.cacheKey ?: return null
        // No provider path/query or bearer enters the cache identity. The private
        // player adds its account-scoped salt, and each read still checks TTL.
        return "$prefix$generation/$opaque"
    }
    @Synchronized fun clear() { grants.clear() }
}

internal class NativePlaybackRead {
    // Memory-only transport credential, replaced together with its authenticated
    // descriptor. Never part of a source URL, data class, cache key or log.
    internal var bearer by mutableStateOf<String?>(null)
    var source by mutableStateOf<NativeVideoSource?>(null)
        internal set
    var loading by mutableStateOf(false)
        internal set
    var denied by mutableStateOf(false)
        internal set
    var failure by mutableStateOf(false)
        internal set
    internal var attempt by mutableIntStateOf(0)
    fun retry() { attempt++ }
}

private class PlaybackMetadataFailure(val status: Int) : IOException("Playback metadata HTTP $status")
private val playbackMetadataClient = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
    .connectTimeout(6, TimeUnit.SECONDS).readTimeout(8, TimeUnit.SECONDS).callTimeout(10, TimeUnit.SECONDS)
    .cache(null).build()

/** Only foreground/current media obtains a grant. Refresh before expiry retains the same
 * player, position, speed and explicit pause intent. Stale account/content work is discarded.
 */
@Composable
internal fun rememberNativePlaybackSource(auth: StagingAuthClient, mediaId: String?, metadataPath: String?,
    enabled: Boolean, fallbackPath: String? = null): NativePlaybackRead {
    val account = auth.account?.id
    val state = remember(auth, account, mediaId, metadataPath) { NativePlaybackRead() }
    LaunchedEffect(auth, account, mediaId, metadataPath, enabled, state.attempt) {
        if (!enabled || account == null || mediaId == null || metadataPath == null) return@LaunchedEffect
        require(trustedPlaybackMetadataPath(metadataPath))
        if (state.source?.expiresAtMillis?.let { it <= System.currentTimeMillis() } == true) state.source = null
        state.loading = state.source == null
        state.denied = false
        state.failure = false
        while (true) {
            try {
                val token = auth.accessTokenForStagingRead()
                if (auth.account?.id != account) throw CancellationException("Playback account changed")
                val request = Request.Builder().url(auth.mediaOrigin + metadataPath)
                    .header("Authorization", "Bearer $token").header("Accept", "application/json")
                    .header("Cache-Control", "no-store").get().build()
                val bytes = awaitPlaybackMetadata(playbackMetadataClient.newCall(request))
                val source = parseNativeVideoSource(auth.mediaOrigin, metadataPath, bytes, System.currentTimeMillis())
                if (auth.account?.id != account || source.mediaId != mediaId) throw CancellationException("Playback owner changed")
                state.bearer = token
                state.source = source
                state.loading = false
                state.failure = false
                // Processing MP4s are reconsidered only on a new view; do not interrupt a
                // healthy old video while its background Stream migration completes.
                if (!source.hls) return@LaunchedEffect
                delay(nativePlaybackRefreshDelay(source.expiresAtMillis ?: 0L, token, System.currentTimeMillis()))
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) {
                if (auth.account?.id != account) throw CancellationException("Playback owner changed")
                state.loading = false
                val status = (error as? PlaybackMetadataFailure)?.status
                state.denied = status == 401 || status == 403 || status == 410
                state.failure = true
                if (state.denied) { state.source = null; return@LaunchedEffect }
                // A rolling backend deployment or temporary metadata failure still uses
                // the existing MP4 authorization endpoint, never a private CDN URL.
                if (state.source == null && fallbackPath != null &&
                    authenticatedVideoUrl(auth.mediaOrigin, auth.mediaOrigin + fallbackPath)) {
                    state.source = NativeVideoSource(mediaId, auth.mediaOrigin + fallbackPath, false)
                    return@LaunchedEffect
                }
                if (state.source?.hls != true) return@LaunchedEffect
                // Keep the existing valid grant on a transient refresh failure. The
                // data source itself rejects it after expiry, even from local cache.
                delay(5_000L)
            }
        }
    }
    return state
}

/** Reading exp schedules an already-authenticated request only; it grants no
 * permission. Ask Auth inside its existing 60-second renewal window so a long
 * looping video does not keep sending a captured, expired bearer.
 */
internal fun nativePlaybackRefreshDelay(sourceExpiry: Long, token: String, now: Long): Long {
    val tokenExpiry = runCatching {
        val payload = token.split('.').takeIf { it.size == 3 }?.get(1) ?: return@runCatching null
        val seconds = JSONObject(String(java.util.Base64.getUrlDecoder().decode(payload), Charsets.UTF_8)).optLong("exp", 0L)
        seconds.takeIf { it in 1..Long.MAX_VALUE / 1000L }?.times(1000L)
    }.getOrNull()
    return minOf(sourceExpiry - now - 45_000L, tokenExpiry?.minus(now)?.minus(50_000L) ?: Long.MAX_VALUE).coerceIn(5_000L, 255_000L)
}

private suspend fun awaitPlaybackMetadata(call: Call): String = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { call.cancel() }
    call.enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            if (continuation.isActive) continuation.resumeWithException(e)
        }
        override fun onResponse(call: Call, response: Response) {
            try {
                val text = response.use {
                    if (!it.isSuccessful) throw PlaybackMetadataFailure(it.code)
                    val body = it.body ?: throw IOException("Empty playback response")
                    if (body.contentLength() > 32_768L) throw IOException("Playback response too large")
                    val bytes = body.byteStream().use { stream ->
                        val output = java.io.ByteArrayOutputStream()
                        val buffer = ByteArray(4096)
                        while (continuation.isActive) {
                            val count = stream.read(buffer)
                            if (count < 0) break
                            if (output.size() + count > 32_768) throw IOException("Playback response too large")
                            output.write(buffer, 0, count)
                        }
                        output.toByteArray()
                    }
                    bytes.toString(Charsets.UTF_8)
                }
                if (continuation.isActive) continuation.resume(text)
            } catch (error: Exception) { if (continuation.isActive) continuation.resumeWithException(error) }
        }
    })
}
