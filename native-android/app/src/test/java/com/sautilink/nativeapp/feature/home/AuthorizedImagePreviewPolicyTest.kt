package com.sautilink.nativeapp.feature.home

import org.junit.Assert.*
import org.junit.Test

/** Synthetic routes/cache values only; no authentication or production requests. */
class AuthorizedImagePreviewPolicyTest {
    private val media = "/api/sauti-media/11111111-1111-4111-8111-111111111111"

    @Test fun postPhotoUsesExisting480Width_andKeepsVersionEncoding() {
        assertEquals("$media?w=480", authorizedImagePreviewRoute("$media?w=960"))
        assertEquals("$media?v=revision%2F2&w=480", authorizedImagePreviewRoute("$media?w=1440&v=revision%2F2"))
        assertEquals("$media?w=480", authorizedImagePreviewRoute(media))
    }

    @Test fun roomCoverUses480_andPreservesImmutableRevision() {
        assertEquals("/api/room-media/developer-room/cover?v=cover-42&w=480",
            authorizedImagePreviewRoute("/api/room-media/developer-room/cover?w=960&v=cover-42"))
    }

    @Test fun alreadySmallRequests_andVideoPosters_doNotDoubleDownload() {
        listOf("$media?w=480", "$media?w=240", "$media?poster=1", "$media?w=960&poster=1",
            "$media?quality=360").forEach { assertNull(it, authorizedImagePreviewRoute(it)) }
    }

    @Test fun unsupportedProtectedEndpoints_neverInventPreviewRoutes() {
        listOf("/api/profile-media/member/avatar", "/api/profile-media/member/header?v=2",
            "/api/dm-media/11111111-1111-4111-8111-111111111111",
            "/api/rooms/11111111-1111-4111-8111-111111111111/post-submissions/22222222-2222-4222-8222-222222222222/media/33333333-3333-4333-8333-333333333333")
            .forEach { assertNull(it, authorizedImagePreviewRoute(it)) }
    }

    @Test fun absoluteUrls_fragments_ambiguousWidths_andInvalidMedia_areRejected() {
        listOf("https://sautilink.com$media?w=960", "https://other.example$media?w=960", "//$media",
            "$media?w=960#fragment", "$media?w=960&w=1440", "/api/sauti-media/not-a-uuid?w=960",
            "/api/room-media/../cover?w=960").forEach { assertNull(it, authorizedImagePreviewRoute(it)) }
    }

    private fun cache() = SessionImagePreviewCache<String>(10, String::length)

    @Test fun accountSwitchErasesPreviews_andOldCompletionsCannotPolluteNewSession() {
        val cache = cache()
        val alice = cache.activate("production|alice|token-a")
        assertTrue(cache.put("production|alice|token-a", alice, media, "alice", 100))
        val bob = cache.activate("production|bob|token-b")
        assertNull(cache.get("production|bob|token-b", bob, media, 101))
        assertFalse(cache.put("production|alice|token-a", alice, media, "late", 102))
        assertTrue(cache.put("production|bob|token-b", bob, media, "bob", 103))
        assertEquals("bob", cache.get("production|bob|token-b", bob, media, 104))
        assertNull(cache.get("production|alice|token-a", alice, media, 104))
    }

    @Test fun signOutCancelsCacheOwnership_evenWhenSameAccountSignsInAgain() {
        val cache = cache()
        val first = cache.activate("account|session-one")
        cache.put("account|session-one", first, media, "first", 100)
        cache.activate(null)
        val second = cache.activate("account|session-two")
        assertFalse(cache.put("account|session-one", first, media, "late", 101))
        assertNull(cache.get("account|session-two", second, media, 101))
    }

    @Test fun previewExpiryDoesNotExtendOnRead_andClockRollbackFailsClosed() {
        val cache = cache()
        val stamp = cache.activate("account")
        cache.put("account", stamp, "photo", "image", 1_000)
        assertEquals("image", cache.get("account", stamp, "photo", 30_999))
        assertNull(cache.get("account", stamp, "photo", 31_001))
        cache.put("account", stamp, "photo", "image", 4_000)
        assertNull(cache.get("account", stamp, "photo", 3_999))
    }

    @Test fun boundedMemoryEvictsLeastRecentlyUsed_andOversizedImagesAreNotStored() {
        val cache = cache()
        val stamp = cache.activate("account")
        cache.put("account", stamp, "one", "1234", 100)
        cache.put("account", stamp, "two", "5678", 100)
        assertEquals("1234", cache.get("account", stamp, "one", 101))
        cache.put("account", stamp, "three", "90ab", 102)
        assertNull(cache.get("account", stamp, "two", 103))
        assertEquals("1234", cache.get("account", stamp, "one", 103))
        assertFalse(cache.put("account", stamp, "oversized", "12345678901", 104))
        assertEquals("90ab", cache.get("account", stamp, "three", 105))
    }

    @Test fun sessionTokenRefreshAndBackendSwitchClearOldPreviews() {
        val cache = cache()
        val first = cache.activate("production|account|token-one")
        cache.put("production|account|token-one", first, media, "image", 100)
        val refreshed = cache.activate("production|account|token-two")
        assertNull(cache.get("production|account|token-two", refreshed, media, 101))
        cache.put("production|account|token-two", refreshed, media, "new", 102)
        val staging = cache.activate("staging|account|token-two")
        assertNull(cache.get("staging|account|token-two", staging, media, 103))
    }
}
