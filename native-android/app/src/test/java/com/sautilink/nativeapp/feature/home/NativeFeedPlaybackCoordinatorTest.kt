package com.sautilink.nativeapp.feature.home

import org.junit.Assert.*
import org.junit.Test

class NativeFeedPlaybackCoordinatorTest {
    @Test fun pausingAVideoPausesItsAttachedMusicUntilExplicitResume() {
        val control = NativeFeedPlaybackCoordinator()
        var music = false; var video = false
        control.update("clip", NativeFeedPlaybackCoordinator.Candidate("post", 1f, 0f))
        control.play("video", "post", { video = false }) { video = true }
        control.play("music", "post", { music = false }) { music = true }
        control.pauseGroup("post")
        assertFalse(video); assertFalse(music)
        assertFalse(control.play("music", "post", { music = false }) { fail("Paused post restarted its soundtrack") })
        control.resumeGroup("post")
        assertTrue(control.play("music", "post", { music = false }) { music = true })
        control.remove("clip")
        assertFalse(music); assertFalse(control.isPaused("post"))
    }
    @Test fun twoFullyVisibleVideosReceiveOneLeaseAndPauseBeforeHandoff() {
        val control = NativeFeedPlaybackCoordinator()
        val events = mutableListOf<String>()
        control.update("top", NativeFeedPlaybackCoordinator.Candidate("one", 1f, 60f))
        control.update("bottom", NativeFeedPlaybackCoordinator.Candidate("two", 1f, 200f))
        assertEquals("one", control.activeGroup)
        assertTrue(control.play("first-player", "one", { events += "pause-one" }) { events += "play-one" })
        assertFalse(control.play("second-player", "two", { events += "pause-two" }) { fail("Second video played together") })
        control.update("bottom", NativeFeedPlaybackCoordinator.Candidate("two", 1f, 20f))
        assertEquals("two", control.activeGroup)
        assertEquals("pause-one", events.last())
        assertTrue(control.play("second-player", "two", { events += "pause-two" }) { events += "play-two" })
        assertTrue(events.indexOf("pause-one") < events.indexOf("play-two"))
        control.remove("bottom")
        assertEquals("pause-two", events.last())
    }

    @Test fun manualChoiceWinsUntilItLeavesTheViewport() {
        val control = NativeFeedPlaybackCoordinator()
        control.update("a", NativeFeedPlaybackCoordinator.Candidate("one", 1f, 10f))
        control.update("b", NativeFeedPlaybackCoordinator.Candidate("two", .7f, 100f))
        control.selectManually("b")
        assertEquals("two", control.activeGroup)
        control.update("b", NativeFeedPlaybackCoordinator.Candidate("two", .09f, 500f))
        assertEquals("one", control.activeGroup)
        control.remove("a")
        assertNull(control.activeGroup)
    }

    @Test fun musicAndVideoFromDifferentPostsNeverOverlap() {
        val control = NativeFeedPlaybackCoordinator()
        var audio = false; var video = false
        control.update("song", NativeFeedPlaybackCoordinator.Candidate("song-post", 1f, 10f))
        control.play("music", "song-post", { audio = false }) { audio = true }
        control.update("clip", NativeFeedPlaybackCoordinator.Candidate("video-post", 1f, 0f))
        control.play("video", "video-post", { video = false }) { video = true }
        assertFalse(audio); assertTrue(video)
        control.remove("clip")
        assertFalse(video)
    }
}
