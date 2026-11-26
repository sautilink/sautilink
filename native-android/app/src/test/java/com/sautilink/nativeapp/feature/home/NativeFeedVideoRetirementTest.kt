package com.sautilink.nativeapp.feature.home

import androidx.media3.common.Player
import org.junit.Assert.*
import org.junit.Test
import java.io.Closeable
import java.lang.reflect.Proxy

class NativeFeedVideoRetirementTest {
    @Test fun playbackAndAuthorizationEndImmediately_butDecoderReleaseLeavesTheScrollFrame() {
        val calls = mutableListOf<String>()
        val player = Proxy.newProxyInstance(Player::class.java.classLoader, arrayOf(Player::class.java)) { _, method, _ ->
            calls += method.name; null
        } as Player
        var release: (() -> Unit)? = null
        retireFeedVideo(player, Closeable { calls += "revoke-resources" }) { release = it; calls += "defer" }
        assertEquals(listOf("pause", "stop", "revoke-resources", "defer"), calls)
        release!!.invoke()
        assertEquals("release", calls.last())
    }
    @Test fun failedResourceCleanupStillSchedulesDecoderRelease() {
        var scheduled = false
        val player = Proxy.newProxyInstance(Player::class.java.classLoader, arrayOf(Player::class.java)) { _, _, _ -> null } as Player
        try {
            retireFeedVideo(player, Closeable { throw IllegalStateException("fixture") }) { scheduled = true }
            fail("Cleanup failure must remain observable")
        } catch (_: IllegalStateException) { assertTrue(scheduled) }
    }
}
