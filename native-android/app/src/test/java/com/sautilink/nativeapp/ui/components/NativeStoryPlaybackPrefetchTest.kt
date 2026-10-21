package com.sautilink.nativeapp.ui.components

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.Base64

class NativeStoryPlaybackPrefetchTest {
    private val owner = "11111111-1111-4111-8111-111111111111"
    private val id = "00000000-0000-4000-8000-000000000001"
    private val next = "00000000-0000-4000-8000-000000000002"
    private val third = "00000000-0000-4000-8000-000000000003"
    private val origin = "https://sautilink.com"
    private val path = "/api/stories/$id/playback"
    private val now = 1_792_540_000_000L
    private fun token(expires: Long) = "header." + Base64.getUrlEncoder().withoutPadding().encodeToString(
        JSONObject().put("exp", expires / 1000L).toString().toByteArray()) + ".signature"
    private fun read() = NativePlaybackRead().apply {
        ownerId = owner; bearer = token(now + 3_600_000L)
        source = NativeVideoSource(id, "$origin/api/stories/$id/hls/m_example?c=payload.${"a".repeat(43)}",
            true, now + 300_000L)
    }
    private fun reusable(value: NativePlaybackRead, account: String = owner, content: String = id,
        endpoint: String = path, site: String = origin, time: Long = now) =
        nativePlaybackReusableDelay(value, account, content, site, endpoint, time)

    @Test fun advancingHandsOffTheSameRead_butOlderThanCurrentAndNextIsEvicted() {
        val window = NativeStoryPlaybackWindow()
        val firstRead = window.forStory(id)
        val nextRead = window.forStory(next)
        assertSame(nextRead, window.forStory(next))
        window.forStory(third)
        assertSame(nextRead, window.forStory(next))
        assertNotSame(firstRead, window.forStory(id))
        assertThrows(IllegalArgumentException::class.java) { window.forStory("foreign/path") }
    }

    @Test fun freshSameOwnerStoryGrantSkipsOnlyTheRedundantMetadataRoundTrip() {
        assertEquals(255_000L, reusable(read()))
        assertNull(reusable(read(), account = "other-account"))
        assertNull(reusable(read(), content = next))
        assertNull(reusable(read(), endpoint = "/api/sauti-media/$id/playback"))
        assertNull(reusable(read(), site = "https://test.sautilink.com"))
        assertNull(reusable(read(), endpoint = "$path?redirect=foreign"))
    }

    @Test fun denialNearExpiryAndMissingCredentialCannotBeWarmedIntoAPlayer() {
        assertNull(reusable(read().apply { denied = true }))
        assertNull(reusable(read().apply { bearer = null }))
        assertNull(reusable(read().apply { ownerId = null }))
        assertNull(reusable(read(), time = now + 255_000L))
        assertNull(reusable(read().apply { bearer = token(now + 54_000L) }))
        assertNull(reusable(read().apply { source = source!!.copy(hls = false) }))
        assertNull(reusable(read().apply { source = source!!.copy(url = "https://foreign.test/private.m3u8") }))
    }
}
