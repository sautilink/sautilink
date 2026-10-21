package com.sautilink.nativeapp.feature.home

import org.junit.Assert.*
import org.junit.Test

class PublishedVideoPlaybackPolicyTest {
    private val id = "00000000-0000-4000-8000-000000000001"
    @Test fun publishedVideoAdaptationDoesNotDependOnTheSurfaceLoadingChrome() {
        assertTrue(publishedVideoAdaptivePlayback(id, "/api/sauti-media/$id"))
        assertFalse(publishedVideoAdaptivePlayback(id, "/api/sauti-media/$id", enabled = false))
    }
    @Test fun pendingSubmissionsDraftsAndUnrelatedPathsCannotRequestStreamMetadata() {
        listOf("/api/rooms/$id/post-submissions/$id/media/$id", "/api/sauti-media/$id?quality=360",
            "/api/sauti-media/other", "https://foreign.test/api/sauti-media/$id", "file:///draft.mp4").forEach {
            assertFalse(it, publishedVideoAdaptivePlayback(id, it))
        }
    }
}
