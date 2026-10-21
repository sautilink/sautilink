package com.sautilink.nativeapp.ui.components

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.util.Base64

class NativeStreamPlaybackPolicyTest {
    private val origin = "https://sautilink.com"
    private val id = "00000000-0000-4000-8000-000000000001"
    private val other = "00000000-0000-4000-8000-000000000002"
    private val generation = "11111111-1111-4111-8111-111111111111"
    private val now = 1_792_540_000_000L
    private fun opaque(path: String) = Base64.getUrlEncoder().withoutPadding().encodeToString(path.toByteArray())
    private fun route(path: String): String = (if (path.substringBefore('?').endsWith(".m3u8")) "m_" else "s_") +
        Base64.getUrlEncoder().withoutPadding().encodeToString(java.security.MessageDigest.getInstance("SHA-256").digest(path.toByteArray()))
    private fun url(contentId: String = id, path: String = "video/360/segment.m4s", kind: String = "sauti-media") =
        "$origin/api/$kind/$contentId/hls/${route(path)}?c=ZXhhbXBsZQ.${"a".repeat(43)}"
    private fun body(url: String = url(), expiry: Long = now + 300_000L, type: String = "hls", cacheKey: String? = generation) =
        JSONObject().put("ok", true).put("data", JSONObject().put("type", type).put("url", url)
            .put("expires_at", Instant.ofEpochMilli(expiry).toString()).put("cache_key", cacheKey ?: JSONObject.NULL)
            .put("qualities", org.json.JSONArray(listOf(720, 360, 720, -1)))).toString()

    @Test fun readyHlsIsExplicitSameOriginAndHasBoundedExpiry() {
        val parsed = parseNativeVideoSource(origin, "/api/sauti-media/$id/playback", body(), now)
        assertTrue(parsed.hls); assertEquals(id, parsed.mediaId); assertEquals(now + 300_000L, parsed.expiresAtMillis)
        assertEquals(listOf(360, 720), parsed.qualities)
        assertEquals(generation, parsed.cacheKey)
    }
    @Test fun existingMediaFallbackCannotPointToAnotherVideoOrOrigin() {
        val parsed = parseNativeVideoSource(origin, "/api/sauti-media/$id/playback", body("/api/sauti-media/$id", type = "mp4"), now)
        assertFalse(parsed.hls)
        assertEquals("$origin/api/sauti-media/$id", parsed.url)
        listOf("$origin/api/sauti-media/$other", "https://evil.test/api/sauti-media/$id", "//$id").forEach {
            assertThrows(Exception::class.java) { parseNativeVideoSource(origin, "/api/sauti-media/$id/playback", body(it, type = "mp4"), now) }
        }
    }
    @Test fun foreignCdnRedirectAndUnrelatedContentNeverReceiveAuthorization() {
        listOf(url().replace(origin, "https://videodelivery.net"), url().replace(origin, "https://sautilink.com.evil.test"),
            url().replace("https://", "http://"), url().replace(origin, "$origin:443"), url() + "#secret", url(other)).forEach {
            assertThrows(Exception::class.java) { parseNativeVideoSource(origin, "/api/sauti-media/$id/playback", body(it), now) }
        }
    }
    @Test fun malformedCapabilityEncodedPathAndExtraQueryAreRejected() {
        listOf(url() + "&redirect=evil", url().replace("?c=", "?token="), url().replace("?c=", "?c=%2F"),
            url().replace("/hls/", "/hls/../"), url().replace("/hls/", "/hls/%2F"), url().replace("/hls/", "/hls/./")).forEach {
            assertFalse(it, authenticatedHlsUrl(origin, it))
        }
    }
    @Test fun expiredAndUnexpectedlyLongGrantsAreRejected() {
        listOf(now - 1L, now + 4_000L, now + 16 * 60_000L).forEach {
            assertThrows(Exception::class.java) { parseNativeVideoSource(origin, "/api/sauti-media/$id/playback", body(expiry = it), now) }
        }
    }
    @Test fun storySourceIsBoundToStoryGatewayAndCannotUsePublishedMp4Fallback() {
        assertTrue(parseNativeVideoSource(origin, "/api/stories/$id/playback", body(url(kind = "stories")), now).hls)
        assertThrows(Exception::class.java) { parseNativeVideoSource(origin, "/api/stories/$id/playback", body(), now) }
        assertThrows(Exception::class.java) { parseNativeVideoSource(origin, "/api/stories/$id/playback", body("/api/sauti-media/$id", type = "mp4"), now) }
    }
    @Test fun grantAllowsOnlyItsContentUntilExpiryAndClearRevokesIt() {
        var clock = now
        val registry = NativeHlsGrantRegistry { clock }
        val source = parseNativeVideoSource(origin, "/api/sauti-media/$id/playback", body(), now)
        registry.authorize(source)
        assertTrue(registry.allows(url())); assertFalse(registry.allows(url(other)))
        clock = now + 300_000L
        assertFalse(registry.allows(url()))
        clock = now; registry.authorize(source); registry.clear()
        assertFalse(registry.allows(url()))
    }
    @Test fun onlyVideoSegmentsEnterCacheAndManifestsAlwaysReauthorize() {
        val registry = NativeHlsGrantRegistry { now }
        registry.authorize(parseNativeVideoSource(origin, "/api/sauti-media/$id/playback", body(), now))
        val key = registry.cacheIdentity(url())
        assertNotNull(key); assertTrue(key!!.contains("/$generation/s_")); assertFalse(key.contains("?")); assertFalse(key.contains("ZXhhbXBsZQ"))
        assertEquals(key, registry.cacheIdentity(url().replace("c=ZXhhbXBsZQ.", "c=cmVuZXdlZA.")))
        assertNull(registry.cacheIdentity(url(path = "manifest/video.m3u8")))
        assertNull(registry.cacheIdentity(url(other)))
        registry.authorize(parseNativeVideoSource(origin, "/api/sauti-media/$id/playback", body(cacheKey = other), now))
        assertNotEquals(key, registry.cacheIdentity(url()))
        registry.authorize(parseNativeVideoSource(origin, "/api/sauti-media/$id/playback", body(cacheKey = null), now))
        assertNull(registry.cacheIdentity(url()))
        registry.authorize(parseNativeVideoSource(origin, "/api/sauti-media/$id/playback", body(cacheKey = "provider/private/path"), now))
        assertNull(registry.cacheIdentity(url()))
    }
    @Test fun registryRetainsOnlyFourLiveContentGrants() {
        val registry = NativeHlsGrantRegistry { now }
        (1..5).forEach { number ->
            val content = "00000000-0000-4000-8000-${number.toString().padStart(12, '0')}"
            registry.authorize(parseNativeVideoSource(origin, "/api/sauti-media/$content/playback", body(url(content)), now))
        }
        assertFalse(registry.allows(url(id))); assertTrue(registry.allows(url(other)))
    }
    @Test fun metadataRouteCannotBeAnAccountOrArbitraryWebUrl() {
        listOf("/api/account/playback", "/api/sauti-media/$id/playback?redirect=evil", "https://evil.test/playback", "/api/stories/x/playback").forEach {
            assertFalse(trustedPlaybackMetadataPath(it))
        }
    }
    @Test fun longPlaybackRefreshesBeforeBothCapabilityAndAuthExpiry_withoutTreatingClaimsAsAuthorization() {
        fun token(expiry: Long) = "header." + opaque(JSONObject().put("exp", expiry / 1000L).toString()) + ".signature"
        assertEquals(255_000L, nativePlaybackRefreshDelay(now + 300_000L, token(now + 3_600_000L), now))
        assertEquals(10_000L, nativePlaybackRefreshDelay(now + 300_000L, token(now + 60_000L), now))
        assertEquals(5_000L, nativePlaybackRefreshDelay(now + 300_000L, token(now - 1L), now))
        assertEquals(255_000L, nativePlaybackRefreshDelay(now + 300_000L, "opaque-token", now))
    }
}
