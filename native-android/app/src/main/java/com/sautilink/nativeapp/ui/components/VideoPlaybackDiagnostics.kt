package com.sautilink.nativeapp.ui.components

import android.util.Log
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.ExoPlaybackException
import java.net.URI
import java.security.MessageDigest
import org.json.JSONObject

internal enum class VideoPlaybackScope { HOME, SHORTS }
internal enum class VideoFailureOrigin { SOURCE, RENDERER, UNEXPECTED, REMOTE, UNKNOWN }
internal enum class VideoFailureQuality { ORIGINAL, P240, P360, P480, P720, P1080, UNKNOWN }
internal enum class VideoFailureContent { JSON, HTML, VIDEO, OTHER, NONE }

/** This value contains only diagnostic metadata, never a URI, header map, body or Throwable. */
internal data class VideoPlaybackFailureSnapshot(
    val scope: VideoPlaybackScope,
    val errorCode: Int,
    val origin: VideoFailureOrigin,
    val errorClass: String,
    val causeClasses: List<String>,
    val httpStatus: Int? = null,
    val rangePosition: Long? = null,
    val rangeLength: Long? = null,
    val positionMs: Long? = null,
    val durationMs: Long? = null,
    val seekable: Boolean? = null,
    val quality: VideoFailureQuality = VideoFailureQuality.UNKNOWN,
    val mediaSha256: String? = null,
    val content: VideoFailureContent = VideoFailureContent.NONE,
    val requestId: String? = null,
    val cfRay: String? = null,
    val serverCode: String? = null,
    val playbackState: Int? = null,
    val isPlaying: Boolean? = null,
    val playWhenReady: Boolean? = null,
    val playerErrorCode: Int? = null
)

/** Called once from onPlayerError; the two-argument Log overload never prints a stack/message. */
@androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])
internal fun logVideoPlaybackFailure(scope: VideoPlaybackScope, error: PlaybackException, player: Player) {
    val causes = ArrayList<Throwable>(8)
    var next: Throwable? = error
    while (causes.size < 8) {
        val current = next ?: break
        if (causes.any { it === current }) break
        causes.add(current)
        next = current.cause
    }
    val http = causes.filterIsInstance<HttpDataSource.InvalidResponseCodeException>().firstOrNull()
    val spec = causes.filterIsInstance<HttpDataSource.HttpDataSourceException>().firstOrNull()?.dataSpec
    val item = videoPlayerValue { player.currentMediaItem }
    val reference = videoFailureReference(spec?.uri?.toString() ?: item?.localConfiguration?.uri?.toString(),
        if (spec == null) item?.mediaId else null)
    val headers = http?.headerFields.orEmpty()
    val content = videoFailureContent(videoFailureHeader(headers, "Content-Type"))
    val origin = when ((error as? ExoPlaybackException)?.type) {
        ExoPlaybackException.TYPE_SOURCE -> VideoFailureOrigin.SOURCE
        ExoPlaybackException.TYPE_RENDERER -> VideoFailureOrigin.RENDERER
        ExoPlaybackException.TYPE_UNEXPECTED -> VideoFailureOrigin.UNEXPECTED
        ExoPlaybackException.TYPE_REMOTE -> VideoFailureOrigin.REMOTE
        else -> VideoFailureOrigin.UNKNOWN
    }
    val snapshot = VideoPlaybackFailureSnapshot(scope, error.errorCode, origin, error.javaClass.simpleName,
        causes.drop(1).map { it.javaClass.simpleName }, http?.responseCode, spec?.position, spec?.length,
        videoPlayerValue { player.currentPosition }, videoPlayerValue { player.duration },
        videoPlayerValue { player.isCurrentMediaItemSeekable }, reference.second, reference.first, content,
        videoFailureHeader(headers, "X-Request-ID"), videoFailureHeader(headers, "CF-Ray"),
        if (content == VideoFailureContent.JSON) videoFailureBodyCode(http?.responseBody) else null,
        playbackState = videoPlayerValue { player.playbackState },
        isPlaying = videoPlayerValue { player.isPlaying },
        playWhenReady = videoPlayerValue { player.playWhenReady },
        playerErrorCode = videoPlayerValue { player.playerError?.errorCode })
    Log.w("SautiVideoFailure", formatVideoPlaybackFailure(snapshot))
}

private inline fun <T> videoPlayerValue(read: () -> T): T? = try { read() } catch (_: RuntimeException) { null }

private fun videoFailureHeader(headers: Map<String, List<String>>, name: String): String? =
    headers.entries.filter { it.key.equals(name, ignoreCase = true) }.flatMap { it.value }.singleOrNull()

internal fun videoFailureContent(value: String?): VideoFailureContent {
    val mime = value?.substringBefore(';')?.trim()?.lowercase()
    return when (mime) {
        null, "" -> VideoFailureContent.NONE
        "application/json", "application/problem+json" -> VideoFailureContent.JSON
        "text/html", "application/xhtml+xml" -> VideoFailureContent.HTML
        else -> if (mime.startsWith("video/")) VideoFailureContent.VIDEO else VideoFailureContent.OTHER
    }
}

private val videoUuid = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
private val videoPublishedPath = Regex("/api/sauti-media/($videoUuid)")
private val videoPendingPath = Regex("/api/rooms/$videoUuid/post-submissions/$videoUuid/media/($videoUuid)")

/** The requested URI quality is not proof of the rendition delivered by a cold server fallback. */
internal fun videoFailureReference(uriText: String?, fallbackMediaId: String? = null): Pair<String?, VideoFailureQuality> {
    val uri = try { uriText?.let(::URI) } catch (_: Exception) { null }
    val pathId = uri?.rawPath?.let { path ->
        videoPublishedPath.matchEntire(path)?.groupValues?.get(1) ?: videoPendingPath.matchEntire(path)?.groupValues?.get(1)
    }
    val id = pathId ?: fallbackMediaId?.takeIf(videoUuid::matches)
    val hash = id?.lowercase()?.toByteArray(Charsets.UTF_8)?.let { bytes ->
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    }
    if (pathId == null) return hash to VideoFailureQuality.UNKNOWN
    val qualities = uri?.rawQuery?.split('&')?.filter { it.substringBefore('=') == "quality" }.orEmpty()
    val quality = when {
        qualities.isEmpty() -> VideoFailureQuality.ORIGINAL
        qualities.size != 1 -> VideoFailureQuality.UNKNOWN
        else -> when (qualities.single().substringAfter('=', "")) {
            "240" -> VideoFailureQuality.P240
            "360" -> VideoFailureQuality.P360
            "480" -> VideoFailureQuality.P480
            "720" -> VideoFailureQuality.P720
            "1080" -> VideoFailureQuality.P1080
            else -> VideoFailureQuality.UNKNOWN
        }
    }
    return hash to quality
}

private val videoServerCodes = setOf("INTERNAL_ERROR", "AUTH_REQUIRED", "MEDIA_NOT_FOUND", "MEDIA_NOT_READY",
    "UPLOAD_NOT_FOUND", "UPLOAD_EXPIRED", "RATE_LIMITED", "RATE_LIMIT_NOT_READY", "METHOD_NOT_ALLOWED")
internal fun videoFailureServerCode(value: String?): String = value?.takeIf { it in videoServerCodes } ?: "NONE"

private fun videoFailureBodyCode(body: ByteArray?): String? {
    if (body == null || body.isEmpty() || body.size > 8192) return null
    return try {
        val code = JSONObject(body.toString(Charsets.UTF_8)).optJSONObject("error")?.optString("code")
        code?.takeIf { it in videoServerCodes }
    } catch (_: Exception) { null }
}

/** Defense in depth: every string field must still satisfy its fixed output grammar. */
internal fun formatVideoPlaybackFailure(value: VideoPlaybackFailureSnapshot): String {
    fun type(name: String) = name.takeIf { it.matches(Regex("[A-Za-z_$][A-Za-z0-9_$]{0,95}")) } ?: "UNKNOWN"
    fun number(number: Long?) = number?.takeIf { it >= 0 }?.toString() ?: "UNSET"
    val requestId = value.requestId?.takeIf { videoUuid.matches(it) || it.matches(Regex("[0-9a-fA-F]{32}")) } ?: "NONE"
    val ray = value.cfRay?.takeIf { it.matches(Regex("[0-9a-fA-F]{16,32}(?:-[A-Z]{3})?")) } ?: "NONE"
    val hash = value.mediaSha256?.takeIf { it.matches(Regex("[0-9a-f]{64}")) } ?: "NONE"
    val state = when (value.playbackState) { 1 -> "IDLE"; 2 -> "BUFFERING"; 3 -> "READY"; 4 -> "ENDED"; else -> "UNKNOWN" }
    return "scope=${value.scope.name} error_code=${value.errorCode.coerceAtLeast(0)} origin=${value.origin.name} " +
        "error_class=${type(value.errorClass)} causes=${value.causeClasses.take(7).joinToString(",", transform = ::type).ifEmpty { "NONE" }} " +
        "http_status=${value.httpStatus?.takeIf { it in 100..599 } ?: "NONE"} range_position=${number(value.rangePosition)} " +
        "range_length=${number(value.rangeLength)} position_ms=${number(value.positionMs)} duration_ms=${number(value.durationMs)} " +
        "seekable=${value.seekable?.toString() ?: "UNKNOWN"} requested_quality=${value.quality.name} media_sha256=$hash " +
        "content=${value.content.name} request_id=$requestId cf_ray=$ray server_code=${videoFailureServerCode(value.serverCode)} " +
        "player_state=$state player_state_code=${value.playbackState?.takeIf { it in 1..4 } ?: "NONE"} " +
        "is_playing=${value.isPlaying?.toString() ?: "UNKNOWN"} play_when_ready=${value.playWhenReady?.toString() ?: "UNKNOWN"} " +
        "player_error_code=${value.playerErrorCode?.takeIf { it >= 0 } ?: "NONE"}"
}
