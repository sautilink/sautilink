package com.sautilink.nativeapp.feature.music

import org.junit.Assert.*
import org.junit.Test

class NativePostAudioRegistryTest {
    @Test fun disposingADuplicateRepostCannotSilenceTheStillVisibleOriginal() {
        val session = NativeMusicComposer {}
        val clip = NativeAudioSelection("track", "Track", "Artist", 12000, 5000)
        session.visiblePosts["original-card"] = VisiblePostAudio("post", clip, 95, 20)
        session.visiblePosts["repost-card"] = VisiblePostAudio("post", clip, 5, 900)
        assertEquals(95, session.activeAudio("post")!!.visiblePercent)
        session.visiblePosts.remove("repost-card")
        assertEquals(clip, session.activeAudio("post")!!.audio)
        session.visiblePosts.remove("original-card")
        assertNull(session.activeAudio("post"))
    }
}
