package com.sautilink.nativeapp.ui.components

fun main() {
    var checks = 0
    fun verify(ok: Boolean, label: String) { check(ok) { label }; checks++; println("PASS: $label") }
    val mediaId = "11111111-2222-3333-4444-555555555555"
    val expectedHash = "666ff6ccaa5b3c07feaa3a95d3a4bd2c46ac9e9abdb09ca9133528d3dc1e8952"
    val reference = videoFailureReference("https://media.invalid/api/sauti-media/$mediaId?quality=720&private=REDACTED")
    verify(reference.first == expectedHash && reference.second == VideoFailureQuality.P720,
        "a failed request is identified by SHA256 and its requested quality only")
    verify(videoFailureReference("https://other.invalid/api/sauti-media/$mediaId").first == expectedHash,
        "the same media identity correlates across origins without retaining either origin")
    verify(videoFailureReference("https://media.invalid/api/sauti-media/$mediaId").second == VideoFailureQuality.ORIGINAL,
        "a known media route without a rendition selects original")
    listOf("240", "360", "480", "720", "1080").forEach { quality ->
        verify(videoFailureReference("https://media.invalid/api/sauti-media/$mediaId?quality=$quality").second.name == "P$quality",
            "recognize the supported $quality rendition")
    }
    listOf("quality=REDACTED", "quality=720&quality=360", "quality=", "quality=720%0AREDACTED").forEachIndexed { index, query ->
        verify(videoFailureReference("https://media.invalid/api/sauti-media/$mediaId?$query").second == VideoFailureQuality.UNKNOWN,
            "unknown or ambiguous quality $index fails closed")
    }
    val pending = videoFailureReference("https://media.invalid/api/rooms/$mediaId/post-submissions/$mediaId/media/$mediaId")
    verify(pending.first == expectedHash && pending.second == VideoFailureQuality.ORIGINAL,
        "protected pending media uses only its own media UUID")
    listOf("https://media.invalid/private/$mediaId", "https://media.invalid/api/sauti-media/REDACTED",
        "https://media.invalid/api/sauti-media/$mediaId/poster", "not a uri REDACTED").forEachIndexed { index, uri ->
        verify(videoFailureReference(uri).first == null && videoFailureReference(uri).second == VideoFailureQuality.UNKNOWN,
            "unrecognized resource $index cannot masquerade as a known media route")
    }
    verify(videoFailureReference(null, mediaId).first == expectedHash && videoFailureReference(null, "REDACTED").first == null,
        "fallback media identity accepts UUIDs only")
    val requestId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    val ray = "0123456789abcdef-DAR"
    val baseline = VideoPlaybackFailureSnapshot(VideoPlaybackScope.SHORTS, 2004, VideoFailureOrigin.SOURCE,
        "ExoPlaybackException", listOf("InvalidResponseCodeException", "IOException"), 500, 2097152, -1,
        8200, 12000, true, reference.second, reference.first, VideoFailureContent.JSON, requestId, ray, "INTERNAL_ERROR")
    val log = formatVideoPlaybackFailure(baseline)
    verify(log.contains("scope=SHORTS error_code=2004 origin=SOURCE error_class=ExoPlaybackException"),
        "the numeric Media3 code and source classification survive")
    verify(log.contains("http_status=500 range_position=2097152 range_length=UNSET position_ms=8200 duration_ms=12000 seekable=true"),
        "range offsets remain distinct from timeline milliseconds and unknown length")
    verify(log.contains("requested_quality=P720 media_sha256=$expectedHash content=JSON request_id=$requestId cf_ray=$ray server_code=INTERNAL_ERROR"),
        "allowlisted correlation and server classification survive")
    verify(!log.contains(mediaId) && !log.contains("media.invalid") && !log.contains("REDACTED") && !log.contains('\n'),
        "a diagnostic line contains neither media UUID nor request data")
    val unsafe = "REDACTED\nAuthorization: Bearer REDACTED https://private.invalid/path?token=REDACTED"
    val injected = formatVideoPlaybackFailure(baseline.copy(errorClass = unsafe, causeClasses = List(20) { unsafe },
        httpStatus = 999, rangePosition = -1, positionMs = -1, durationMs = Long.MIN_VALUE,
        mediaSha256 = unsafe, requestId = unsafe, cfRay = unsafe, serverCode = unsafe))
    verify(!injected.contains("REDACTED") && !injected.contains("Authorization") && !injected.contains("private.invalid") && !injected.contains('\n'),
        "untrusted metadata cannot inject a token URL body or second log line")
    verify(injected.contains("error_class=UNKNOWN") && injected.contains("http_status=NONE") && injected.contains("range_position=UNSET") &&
        injected.contains("media_sha256=NONE") && injected.contains("request_id=NONE cf_ray=NONE server_code=NONE"),
        "invalid metadata is replaced with fixed sentinels")
    verify(injected.substringAfter("causes=").substringBefore(' ').split(',').size == 7,
        "exception cause output is bounded even for hostile or cyclic chains")
    listOf("eyJhbGciOiJIUzI1NiJ9.REDACTED.signature", "Bearer_REDACTED", "https://private.invalid", "valid\r\nREDACTED").forEachIndexed { index, header ->
        val result = formatVideoPlaybackFailure(baseline.copy(requestId = header, cfRay = header))
        verify(result.contains("request_id=NONE cf_ray=NONE"), "reject an unsafe correlation header $index")
    }
    verify(formatVideoPlaybackFailure(baseline.copy(requestId = "0123456789abcdef0123456789abcdef")).contains("request_id=0123456789abcdef0123456789abcdef"),
        "a fixed 32-hex request identifier remains correlatable")
    listOf("application/json; charset=utf-8" to VideoFailureContent.JSON, "application/problem+json" to VideoFailureContent.JSON,
        "text/html" to VideoFailureContent.HTML, "video/mp4" to VideoFailureContent.VIDEO,
        "application/octet-stream; REDACTED" to VideoFailureContent.OTHER, null to VideoFailureContent.NONE).forEachIndexed { index, (mime, content) ->
        verify(videoFailureContent(mime) == content, "classify response MIME $index without printing its value")
    }
    verify(videoFailureServerCode("MEDIA_NOT_READY") == "MEDIA_NOT_READY" && videoFailureServerCode("REDACTED") == "NONE",
        "only known server error codes can reach a diagnostic")
    val renderer = formatVideoPlaybackFailure(baseline.copy(scope = VideoPlaybackScope.HOME, origin = VideoFailureOrigin.RENDERER,
        causeClasses = listOf("MediaCodecVideoDecoderException"), httpStatus = null, seekable = null))
    verify(renderer.contains("scope=HOME") && renderer.contains("origin=RENDERER") && renderer.contains("http_status=NONE") && renderer.contains("seekable=UNKNOWN"),
        "renderer failures do not invent an HTTP status or seekability")
    val ready = formatVideoPlaybackFailure(baseline.copy(playbackState = 3, isPlaying = false, playWhenReady = false, playerErrorCode = null))
    verify(ready.contains("player_state=READY player_state_code=3 is_playing=false play_when_ready=false player_error_code=NONE"),
        "a ready paused player with no current error stays distinct from the reported failure")
    val buffering = formatVideoPlaybackFailure(baseline.copy(playbackState = 2, isPlaying = false, playWhenReady = true, playerErrorCode = 2004))
    verify(buffering.contains("player_state=BUFFERING player_state_code=2 is_playing=false play_when_ready=true player_error_code=2004"),
        "current player state preserves requested buffering and the current numeric error")
    listOf(1 to "IDLE", 4 to "ENDED").forEach { (state, name) ->
        verify(formatVideoPlaybackFailure(baseline.copy(playbackState = state)).contains("player_state=$name player_state_code=$state"),
            "recognize the bounded $name player state")
    }
    verify(formatVideoPlaybackFailure(baseline.copy(playbackState = 99, playerErrorCode = -1)).contains(
        "player_state=UNKNOWN player_state_code=NONE is_playing=UNKNOWN play_when_ready=UNKNOWN player_error_code=NONE"),
        "invalid or unavailable current player metadata remains explicit and bounded")
    println("PASS: $checks pure playback diagnostic checks")
}
