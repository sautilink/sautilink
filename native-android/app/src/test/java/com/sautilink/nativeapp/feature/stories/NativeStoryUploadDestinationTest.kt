package com.sautilink.nativeapp.feature.stories

import org.junit.Assert.*
import org.junit.Test

class NativeStoryUploadDestinationTest {
    private val origin = "https://sautilink.com"
    private val id = "00000000-0000-4000-8000-000000000001"
    private val image = "$origin/api/stories/uploads/$id"
    private val video = "https://upload.videodelivery.net/0123456789abcdef0123456789abcdef"
    @Test fun exactImageUploadDestinationRetainsBearerOnlyOnFirstParty() {
        assertTrue(storyUploadDestinationAllowed(origin, image, "image", id, "PUT"))
        listOf(image.replace("https:", "http:"), image.replace("sautilink.com", "evil.example"),
            image.replace("sautilink.com", "sautilink.com.evil.example"), "$image/extra", "$image#secret",
            image.replace("sautilink.com", "token@sautilink.com"), image.replace("sautilink.com", "sautilink.com:444"),
            image.replace(id, "00000000-0000-4000-8000-000000000002")).forEach {
                assertFalse("Rejected first-party upload destination: $it", storyUploadDestinationAllowed(origin, it, "image", id, "PUT"))
            }
        assertFalse(storyUploadDestinationAllowed(origin, image, "image", id, "POST"))
    }
    @Test fun cloudflareOneTimeUploadOnlyAcceptsExactHttpsHostAndPost() {
        assertTrue(storyUploadDestinationAllowed(origin, video, "video", id, "POST"))
        listOf(video.replace("https:", "http:"), video.replace("upload.videodelivery.net", "evil.example"),
            video.replace("upload.videodelivery.net", "upload.videodelivery.net.evil.example"), "$video/extra", "$video#token",
            video.replace("upload.videodelivery.net", "secret@upload.videodelivery.net"), video.replace("upload.videodelivery.net", "upload.videodelivery.net:444"),
            "https://upload.videodelivery.net/short").forEach {
                assertFalse("Rejected provider upload destination: $it", storyUploadDestinationAllowed(origin, it, "video", id, "POST"))
            }
        assertFalse(storyUploadDestinationAllowed(origin, video, "video", id, "PUT"))
        assertFalse(storyUploadDestinationAllowed(origin, video, "image", id, "PUT"))
        assertFalse(storyUploadDestinationAllowed(origin, image, "video", id, "POST"))
    }
    @Test fun currentAndLegacyCloudflareOriginsShareStrictOpaquePathAndNoUrlExtras() {
        listOf("upload.cloudflarestream.com", "upload.videodelivery.net").forEach { host ->
            val canonical = "https://$host/0123456789abcdef0123456789abcdef"
            assertTrue("The real direct-upload origin must work: $host", storyUploadDestinationAllowed(origin, canonical, "video", id, "POST"))
            val rejected = listOf(
                canonical.replace("https:", "http:"),
                canonical.replace(host, "$host.evil.example"),
                canonical.replace(host, "sub.$host"),
                canonical.replace(host, "$host:444"),
                canonical.replace(host, "$host:443"),
                canonical.replace(host, "user@$host"),
                canonical.replace(host, "@$host"),
                "$canonical?token=unexpected", "$canonical?", "$canonical#fragment",
                "$canonical/extra", "$canonical/", canonical.dropLast(1), "${canonical}a",
                "https://$host/%30${"1".repeat(31)}"
            )
            rejected.forEach { destination ->
                assertFalse("Only the exact direct-upload capability URL is allowed: $destination",
                    storyUploadDestinationAllowed(origin, destination, "video", id, "POST"))
            }
            assertFalse(storyUploadDestinationAllowed(origin, canonical, "video", id, "PUT"))
            assertFalse(storyUploadDestinationAllowed(origin, canonical, "image", id, "PUT"))
        }
    }
}
