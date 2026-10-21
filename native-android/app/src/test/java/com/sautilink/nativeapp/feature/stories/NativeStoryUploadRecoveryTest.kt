package com.sautilink.nativeapp.feature.stories

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class NativeStoryUploadRecoveryTest {
    @Test fun aProvisionedOrUncertainUploadNeverCountsAsReceivedBytes() {
        assertEquals(StoryUploadRecovery.WAIT, storyUploadRecovery(JSONObject(), "video", true))
        // The old server's local processing flag alone is not acceptance evidence.
        assertEquals(StoryUploadRecovery.WAIT,
            storyUploadRecovery(JSONObject().put("processing", true), "video", true))
        assertEquals(StoryUploadRecovery.WAIT,
            storyUploadRecovery(JSONObject().put("awaiting_upload", true), "video", true))
    }

    @Test fun onlyFreshServerConfirmationMayRetryAnUnreceivedDirectTransfer() {
        val confirmed = JSONObject().put("awaiting_upload", true).put("retry_upload", true)
        assertEquals(StoryUploadRecovery.RETRY_TRANSFER, storyUploadRecovery(confirmed, "video", true))
        assertEquals(StoryUploadRecovery.WAIT,
            storyUploadRecovery(JSONObject().put("retry_upload", true), "video", true))
        assertEquals(StoryUploadRecovery.FAILED, storyUploadRecovery(confirmed, "video", false))
        assertEquals(StoryUploadRecovery.FAILED,
            storyUploadRecovery(confirmed.put("failed", true), "video", true))
    }

    @Test fun acceptedOrReadyVideoIsNotUploadedAgainAndExpiredMediaCannotResume() {
        for (flag in listOf("uploaded", "ready")) {
            val received = JSONObject().put(flag, true)
            assertEquals(StoryUploadRecovery.COMPLETE, storyUploadRecovery(received, "video", true))
            assertEquals(StoryUploadRecovery.FAILED, storyUploadRecovery(received, "video", false))
        }
        assertEquals(StoryUploadRecovery.RETRY_TRANSFER, storyUploadRecovery(JSONObject(), "image", true))
    }
}
