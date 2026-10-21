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

internal enum class NativeVideoStartupStage { VIEWPORT_INTENT, TOKEN_BEGIN, TOKEN_READY,
    DESCRIPTOR_BEGIN, DESCRIPTOR_HEADERS, DESCRIPTOR_READY, RESOURCES_BEGIN, RESOURCES_READY, PLAYER_BEGIN, PLAYER_READY, SOURCE_PREPARE, FIRST_FRAME,
    HTTP_BEGIN, HTTP_HEADERS, HTTP_FIRST_BYTE, HTTP_COMPLETE, BOOTSTRAP_HIT, FAILURE }
internal enum class NativeVideoStartupRequest { NONE, MANIFEST, SEGMENT, MP4 }
internal enum class NativeVideoServerTiming { RLS, READY, HLS, EDGE }
internal data class NativeVideoStartupEvent(val mediaId: String, val stage: NativeVideoStartupStage,
    val request: NativeVideoStartupRequest, val requestId: Long, val elapsedNanos: Long,
    val durationMillis: Long, val bytes: Long, val status: Int,
    val serverTiming: Map<NativeVideoServerTiming, Double> = emptyMap())

internal fun nativeVideoServerTimings(headers: Map<String, List<String>>): Map<NativeVideoServerTiming, Double> {
    val text = headers.entries.firstOrNull { it.key.equals("Server-Timing", true) }?.value?.joinToString(",") ?: return emptyMap()
    if (text.length > 4_096) return emptyMap()
    val result = linkedMapOf<NativeVideoServerTiming, Double>()
    val metric = Regex("(rls|ready|hls|edge)\\s*;\\s*dur=([0-9]{1,7}(?:\\.[0-9]{1,3})?)")
    for (part in text.split(',').take(16)) {
        val match = metric.matchEntire(part.trim()) ?: continue
        val value = match.groupValues[2].toDoubleOrNull()?.takeIf { it.isFinite() && it in 0.0..600_000.0 } ?: continue
        val phase = NativeVideoServerTiming.valueOf(match.groupValues[1].uppercase())
        result.putIfAbsent(phase, value)
    }
    return result
}

/** Disabled unless an operator instrumentation test installs a memory-only sink.
 * Events have fixed stages/numbers; URLs, queries, credentials and bodies cannot
 * enter this contract. Normal app runs produce no startup logs or timing work.
 */
internal object NativeVideoStartupProbe {
    @Volatile var observer: ((NativeVideoStartupEvent) -> Unit)? = null
    private val requests = java.util.concurrent.atomic.AtomicLong()
    fun mark(mediaId: String, stage: NativeVideoStartupStage,
        request: NativeVideoStartupRequest = NativeVideoStartupRequest.NONE, requestId: Long = 0L,
        durationMillis: Long = 0L, bytes: Long = 0L, status: Int = 0,
        serverTiming: Map<NativeVideoServerTiming, Double> = emptyMap()) {
        val sink = observer ?: return
        runCatching { sink(NativeVideoStartupEvent(mediaId, stage, request, requestId,
            System.nanoTime(), durationMillis.coerceAtLeast(0L), bytes.coerceAtLeast(0L),
            status.takeIf { it in 100..599 } ?: 0,
            serverTiming.filterValues { it.isFinite() && it in 0.0..600_000.0 })) }
    }
    fun nextRequestId(): Long = if (observer == null) 0L else requests.incrementAndGet()
}

/** The backend chooses HLS explicitly after processing. A URL suffix never guesses its type. */
internal data class NativeVideoSource(
    val mediaId: String,
    val url: String,
    val hls: Boolean,
    val expiresAtMillis: Long? = null,
    val qualities: List<Int> = emptyList(),
    val cacheKey: String? = null,
    val bootstrap: NativePlaybackBootstrap? = null,
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
            NativeVideoSource(mediaId, url, true, expiry, qualities, cacheKey,
                parseNativePlaybackBootstrap(origin, contentPath, url, data.optJSONObject("bootstrap"), nowMillis))
        }
        "mp4" -> {
            require(metadataPath.startsWith("/api/sauti-media/") && url == origin + contentPath && authenticatedVideoUrl(origin, url)) { "Untrusted MP4 fallback" }
            NativeVideoSource(mediaId, url, false)
        }
        else -> throw IOException("Unsupported playback format")
    }
}

/** A descriptor can carry its already-authorized rewritten playlists once. Never
 * a segment, persistent cache, alternate origin or generic HTTP response cache.
 */
internal class NativePlaybackBootstrap internal constructor(
    private val entries: MutableMap<String, ByteArray>,
    private val receivedAtMillis: Long,
    private val receivedAtNanos: Long = System.nanoTime(),
) {
    @Synchronized internal fun consume(url: String, grantExpiry: Long, nowMillis: Long): ByteArray? {
        val elapsedNanos = System.nanoTime() - receivedAtNanos
        if (nowMillis < receivedAtMillis || nowMillis >= minOf(receivedAtMillis + 5_000L, grantExpiry) ||
            elapsedNanos < 0L || elapsedNanos >= 5_000_000_000L) {
            clear(); return null
        }
        return entries.remove(url)
    }
    @Synchronized internal fun clear() { entries.values.forEach { it.fill(0) }; entries.clear() }
}

internal fun parseNativePlaybackBootstrap(origin: String, contentPath: String, masterUrl: String,
    value: JSONObject?, nowMillis: Long): NativePlaybackBootstrap? {
    if (value == null) return null
    return runCatching {
    val rows = requireNotNull(value.optJSONArray("playlists"))
    require(rows.length() in 1..9)
    val entries = linkedMapOf<String, ByteArray>()
    var total = 0
    fun canonicalGateway(value: String): String? {
        val url = if (value.startsWith('/') && !value.startsWith("//")) origin + value else value
        return url.takeIf { authenticatedHlsUrl(origin, it) && URI(it).rawPath.startsWith("$contentPath/hls/") }
    }
    for (index in 0 until rows.length()) {
        val row = rows.getJSONObject(index)
        val url = requireNotNull(canonicalGateway(row.getString("url")))
        val text = row.getString("body")
        require(URI(url).rawPath.substringAfterLast('/').startsWith("m_") && !entries.containsKey(url))
        require(text.startsWith("#EXTM3U\n") || text.startsWith("#EXTM3U\r\n"))
        require(text.length <= 256 * 1024 && !text.contains('\u0000'))
        val bytes = text.toByteArray(Charsets.UTF_8)
        total += bytes.size; require(total <= 256 * 1024)
        for (rawLine in text.lineSequence()) {
            val line = rawLine.trim()
            if (line.isEmpty()) continue
            if (!line.startsWith('#')) require(canonicalGateway(line) != null)
            else if (line.contains("URI=", ignoreCase = true)) {
                val attributes = Regex("(?:^|[:,])\\s*URI=\"([^\"]+)\"").findAll(line).toList()
                require(attributes.size == Regex("URI=", RegexOption.IGNORE_CASE).findAll(line).count())
                attributes.forEach { require(canonicalGateway(it.groupValues[1]) != null) }
            }
        }
        entries[url] = bytes
    }
    require(entries.containsKey(masterUrl))
    NativePlaybackBootstrap(entries, nowMillis)
}.getOrNull()
}

/** Short-lived grant metadata stays in memory; cache reads cannot outlive authorization. */
internal class NativeHlsGrantRegistry(private val now: () -> Long = System::currentTimeMillis) {
    private data class Grant(val expiry: Long, val cacheKey: String?, val bootstrap: NativePlaybackBootstrap?)
    private val grants = linkedMapOf<String, Grant>()
    @Synchronized fun authorize(source: NativeVideoSource) {
        val prefix = source.gatewayPrefix ?: return
        val expiry = source.expiresAtMillis ?: return
        grants.entries.removeAll { it.value.expiry <= now() }
        grants.remove(prefix)
        if (expiry > now()) grants[prefix] = Grant(expiry, source.cacheKey?.takeIf { Regex(playbackUuid).matches(it) }, source.bootstrap)
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
    @Synchronized fun consumeBootstrap(url: String): ByteArray? {
        if (!allows(url)) return null
        val uri = URI(url)
        val prefix = "${uri.scheme}://${uri.host}" + uri.rawPath.substringBeforeLast('/') + "/"
        val grant = grants[prefix] ?: return null
        return grant.bootstrap?.consume(url, grant.expiry, now())
    }
    @Synchronized fun clear() { grants.values.forEach { it.bootstrap?.clear() }; grants.clear() }
}

internal class NativePlaybackRead {
    // Memory-only transport credential, replaced together with its authenticated
    // descriptor. Never part of a source URL, data class, cache key or log.
    internal var bearer by mutableStateOf<String?>(null)
    internal var ownerId: String? = null
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

/** Only the open Story viewer owns this two-entry, memory-only handoff. Preparing
 * the next descriptor never starts a player or downloads its video segments.
 */
internal class NativeStoryPlaybackWindow {
    private val reads = linkedMapOf<String, NativePlaybackRead>()
    fun forStory(id: String): NativePlaybackRead {
        require(Regex(playbackUuid).matches(id))
        val read = reads.remove(id) ?: NativePlaybackRead()
        reads[id] = read
        while (reads.size > 2) reads.remove(reads.keys.first())
        return read
    }
}

internal fun nativePlaybackReusableDelay(read: NativePlaybackRead, owner: String, mediaId: String,
    origin: String, metadataPath: String, now: Long): Long? {
    val source = read.source ?: return null
    val token = read.bearer ?: return null
    if (read.ownerId != owner || source.mediaId != mediaId || !source.hls || read.denied ||
        !trustedPlaybackMetadataPath(metadataPath) || !authenticatedHlsUrl(origin, source.url) ||
        !URI(source.url).rawPath.startsWith(metadataPath.removeSuffix("/playback") + "/hls/")) return null
    val expiry = source.expiresAtMillis ?: return null
    if (expiry <= now + 45_000L) return null
    return nativePlaybackRefreshDelay(expiry, token, now).takeIf { it > 5_000L }
}

private class PlaybackMetadataFailure(val status: Int) : IOException("Playback metadata HTTP $status")
// A descriptor and its first manifest share the same HTTP/2 connection pool.
// Requests still carry their own current credential; no auth interceptor/cookie
// state from a particular player is installed on this common transport.
private val playbackMetadataClient = nativePlaybackHttpClient.newBuilder().followRedirects(false).followSslRedirects(false)
    .connectTimeout(6, TimeUnit.SECONDS).readTimeout(8, TimeUnit.SECONDS).callTimeout(10, TimeUnit.SECONDS)
    .cache(null).build()

/** Only foreground/current media obtains a grant. Refresh before expiry retains the same
 * player, position, speed and explicit pause intent. Stale account/content work is discarded.
 */
@Composable
internal fun rememberNativePlaybackSource(auth: StagingAuthClient, mediaId: String?, metadataPath: String?,
    enabled: Boolean, fallbackPath: String? = null, retainedRead: NativePlaybackRead? = null): NativePlaybackRead {
    val account = auth.account?.id
    val state = remember(auth, account, mediaId, metadataPath, retainedRead) {
        retainedRead?.takeIf { it.ownerId == null || it.ownerId == account } ?: NativePlaybackRead()
    }
    LaunchedEffect(auth, account, mediaId, metadataPath, enabled, state, state.attempt) {
        if (!enabled || account == null || mediaId == null || metadataPath == null) return@LaunchedEffect
        require(trustedPlaybackMetadataPath(metadataPath))
        if (state.source?.mediaId?.let { it != mediaId } == true) { state.source = null; state.bearer = null }
        if (state.source?.expiresAtMillis?.let { it <= System.currentTimeMillis() } == true) state.source = null
        state.loading = state.source == null
        state.denied = false
        state.failure = false
        // A preloaded next Story already has a server-authorized descriptor. Do
        // not repeat that sequential RTT when it becomes current. Every child
        // request still reauthorizes; near-expiry grants/tokens refresh first.
        if (retainedRead != null) nativePlaybackReusableDelay(state, account, mediaId,
            auth.mediaOrigin, metadataPath, System.currentTimeMillis())?.let { delay(it) }
        while (true) {
            try {
                NativeVideoStartupProbe.mark(mediaId, NativeVideoStartupStage.TOKEN_BEGIN)
                val token = auth.accessTokenForStagingRead()
                if (auth.account?.id != account) throw CancellationException("Playback account changed")
                NativeVideoStartupProbe.mark(mediaId, NativeVideoStartupStage.TOKEN_READY)
                val request = Request.Builder().url(auth.mediaOrigin + metadataPath)
                    .header("Authorization", "Bearer $token").header("Accept", "application/json")
                    .header("X-Sauti-Playback-Bootstrap", "1")
                    .header("Cache-Control", "no-store").get().build()
                NativeVideoStartupProbe.mark(mediaId, NativeVideoStartupStage.DESCRIPTOR_BEGIN)
                val bytes = awaitPlaybackMetadata(playbackMetadataClient.newCall(request), mediaId)
                val source = parseNativeVideoSource(auth.mediaOrigin, metadataPath, bytes, System.currentTimeMillis())
                if (auth.account?.id != account || source.mediaId != mediaId) throw CancellationException("Playback owner changed")
                state.ownerId = account
                state.bearer = token
                state.source = source
                state.loading = false
                state.failure = false
                NativeVideoStartupProbe.mark(mediaId, NativeVideoStartupStage.DESCRIPTOR_READY)
                // Processing MP4s are reconsidered only on a new view; do not interrupt a
                // healthy old video while its background Stream migration completes.
                if (!source.hls) return@LaunchedEffect
                delay(nativePlaybackRefreshDelay(source.expiresAtMillis ?: 0L, token, System.currentTimeMillis()))
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) {
                if (auth.account?.id != account) throw CancellationException("Playback owner changed")
                state.loading = false
                val status = (error as? PlaybackMetadataFailure)?.status
                NativeVideoStartupProbe.mark(mediaId, NativeVideoStartupStage.FAILURE, status = status ?: 0)
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

private suspend fun awaitPlaybackMetadata(call: Call, mediaId: String): String = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { call.cancel() }
    call.enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            if (continuation.isActive) continuation.resumeWithException(e)
        }
        override fun onResponse(call: Call, response: Response) {
            try {
                val text = response.use {
                    if (!it.isSuccessful) throw PlaybackMetadataFailure(it.code)
                    NativeVideoStartupProbe.mark(mediaId, NativeVideoStartupStage.DESCRIPTOR_HEADERS,
                        status = it.code, serverTiming = if (NativeVideoStartupProbe.observer != null && it.code in listOf(200, 206))
                            nativeVideoServerTimings(it.headers.toMultimap()) else emptyMap())
                    val body = it.body ?: throw IOException("Empty playback response")
                    if (body.contentLength() > 524_288L) throw IOException("Playback response too large")
                    val bytes = body.byteStream().use { stream ->
                        val output = java.io.ByteArrayOutputStream()
                        val buffer = ByteArray(4096)
                        while (continuation.isActive) {
                            val count = stream.read(buffer)
                            if (count < 0) break
                            if (output.size() + count > 524_288) throw IOException("Playback response too large")
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
