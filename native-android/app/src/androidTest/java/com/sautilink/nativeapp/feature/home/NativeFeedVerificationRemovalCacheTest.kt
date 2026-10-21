package com.sautilink.nativeapp.feature.home

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Synthetic memory-cache fixtures only: no account, authentication, network or actual removal. */
@RunWith(AndroidJUnit4::class)
class NativeFeedVerificationRemovalCacheTest {
    private val backend = "production-fixture"
    private val owner = "owner-fixture"
    private val other = "other-fixture"
    private val modes = listOf("for_you", "following", "short_videos", "saved", "trending")

    private fun post(author: String, badge: String = "official_team") = StagingFeedPost(
        id = "post-$author", authorId = author, authorName = "Fixture $author", authorHandle = author,
        verified = true, badgeType = badge, body = "**Fixture text**", createdAt = "2026-10-21T06:00:00Z",
        likes = 7, comments = 3, reposts = 2, mediaCount = 1,
        media = listOf(FeedMedia("media-$author", "image", 0, 1080, 720)), hasAvatar = true)

    private fun page() = StagingFeedPage(listOf(post(owner), post(other, "standard")), 15, true)

    private fun seed(cache: StagingFeedCache, mode: String, page: StagingFeedPage = page(),
        scope: String = backend, account: String = owner, now: Long = 1_000L) {
        cache.finishPage(scope, account, mode, 0, page, cache.readStamp(scope, account, mode),
            { account }, now)
    }

    @Test fun confirmedRemoval_demotesOnlyOwnPostsAcrossAllModes_andKeepsOfflineRowsStale() {
        val cache = StagingFeedCache()
        val original = page()
        modes.forEach { seed(cache, it, original) }

        assertTrue(cache.confirmOwnVerificationRemoved(backend, owner) { owner })

        modes.forEach { mode ->
            val retained = cache.cached(backend, owner, mode, 300_000L, 2_000L)!!
            assertEquals(original.copy(posts = listOf(
                original.posts[0].copy(verified = false, badgeType = "standard"), original.posts[1])), retained)
            assertSame("Another author's complete row remains untouched", original.posts[1], retained.posts[1])
            assertEquals("A newly opened feed must revalidate rather than accept the 45-second shortcut",
                Long.MAX_VALUE, cache.ageMs(backend, owner, mode, 2_000L))
            assertEquals(15, retained.nextOffset)
            assertTrue(retained.hasMore)
        }
    }

    @Test fun removalDoesNotExtendOfflineTtl_orReplaceAnEmptyPage() {
        val cache = StagingFeedCache()
        seed(cache, "for_you")
        val empty = StagingFeedPage(emptyList(), 0, false)
        seed(cache, "saved", empty)
        cache.confirmOwnVerificationRemoved(backend, owner) { owner }

        assertNotNull(cache.cached(backend, owner, "for_you", 300_000L, 301_000L))
        assertNull(cache.cached(backend, owner, "for_you", 300_000L, 301_001L))
        assertEquals(empty, cache.cached(backend, owner, "saved", 300_000L, 2_000L))
    }

    @Test fun preRemovalRequestsCannotRestoreBadgeInReturnedPage_orOverwriteDemotedCache() {
        val cache = StagingFeedCache()
        val original = page()
        modes.forEach { mode ->
            seed(cache, mode, original)
        }
        val inFlight = modes.associateWith { cache.readStamp(backend, owner, it) }
        cache.confirmOwnVerificationRemoved(backend, owner) { owner }

        modes.forEach { mode ->
            val response = original.copy(nextOffset = 30)
            val returned = cache.finishPage(backend, owner, mode, 0, response, inFlight.getValue(mode),
                { owner }, 3_000L)
            assertFalse("Stale network results cannot resurrect an own badge in UI", returned.posts[0].verified)
            assertEquals("standard", returned.posts[0].badgeType)
            assertSame(original.posts[1], returned.posts[1])
            assertEquals("An invalidated in-flight response cannot overwrite existing offline pagination",
                15, cache.cached(backend, owner, mode, 300_000L, 3_000L)!!.nextOffset)
            assertEquals(Long.MAX_VALUE, cache.ageMs(backend, owner, mode, 3_000L))
        }
    }

    @Test fun uncachedAndPaginatedReads_andPostDetail_alsoRejectOldOwnBadge() {
        val cache = StagingFeedCache()
        val stamp = cache.readStamp(backend, owner, "short_videos")
        cache.confirmOwnVerificationRemoved(backend, owner) { owner }

        val paginated = cache.finishPage(backend, owner, "short_videos", 15, page(), stamp, { owner })
        assertFalse(paginated.posts[0].verified)
        assertNull(cache.cached(backend, owner, "short_videos", 300_000L))
        val own = cache.finishPost(backend, owner, post(owner), stamp)!!
        assertFalse(own.verified)
        assertEquals("standard", own.badgeType)
        val another = post(other)
        assertSame(another, cache.finishPost(backend, owner, another, stamp))
        assertNull(cache.finishPost(backend, owner, null, stamp))
    }

    @Test fun laterAuthoritativeReadsCanShowReverification_andBecomeFreshAgain() {
        val cache = StagingFeedCache()
        seed(cache, "for_you")
        cache.confirmOwnVerificationRemoved(backend, owner) { owner }
        val fresh = page().copy(posts = listOf(post(owner, "standard"), post(other)))
        val returned = cache.finishPage(backend, owner, "for_you", 0, fresh,
            cache.readStamp(backend, owner, "for_you"), { owner }, 4_000L)

        assertSame("Removal only invalidates older observations, never permanently hides verification", fresh, returned)
        assertTrue(returned.posts[0].verified)
        assertEquals(fresh, cache.cached(backend, owner, "for_you", 300_000L, 5_000L))
        assertEquals(1_000L, cache.ageMs(backend, owner, "for_you", 5_000L))
    }

    @Test fun wrongOwnerSignedOutAndOtherEnvironmentCannotDemote_orInvalidateCurrentCache() {
        val cache = StagingFeedCache()
        val original = page()
        seed(cache, "for_you", original)
        seed(cache, "for_you", original, scope = "staging-fixture")
        assertFalse(cache.confirmOwnVerificationRemoved(backend, other) { owner })
        assertFalse(cache.confirmOwnVerificationRemoved(backend, owner) { null })
        assertFalse(cache.confirmOwnVerificationRemoved(backend, "") { "" })
        assertEquals(original, cache.cached(backend, owner, "for_you", 300_000L, 2_000L))
        assertEquals(1_000L, cache.ageMs(backend, owner, "for_you", 2_000L))

        cache.confirmOwnVerificationRemoved(backend, owner) { owner }
        assertEquals(original, cache.cached("staging-fixture", owner, "for_you", 300_000L, 2_000L))
        val anotherOwnerStamp = cache.readStamp(backend, other, "for_you")
        val anotherOwnerResult = cache.finishPage(backend, other, "for_you", 15, original,
            anotherOwnerStamp, { other })
        assertSame("A removal is never a global author-badge suppression rule", original, anotherOwnerResult)
        assertNull(cache.cached(backend, other, "for_you", 300_000L, 2_000L))
    }

    @Test fun oldAccountResponseCannotOverwriteAfterSwitch_andFollowingInvalidationStillPreservesRows() {
        val cache = StagingFeedCache()
        val original = page()
        val oldAccountRead = cache.readStamp(backend, owner, "for_you")
        cache.finishPage(backend, owner, "for_you", 0, original, oldAccountRead, { other }, 1_000L)
        assertNull(cache.cached(backend, owner, "for_you", 300_000L, 2_000L))

        seed(cache, "following", original)
        val oldFollowingRead = cache.readStamp(backend, owner, "following")
        cache.invalidateFollowing(backend, owner)
        val returned = cache.finishPage(backend, owner, "following", 0, original.copy(nextOffset = 30),
            oldFollowingRead, { owner }, 2_000L)
        assertTrue("Relationship invalidation alone does not change verification", returned.posts[0].verified)
        assertEquals(original, cache.cached(backend, owner, "following", 300_000L, 2_000L))
        assertEquals(Long.MAX_VALUE, cache.ageMs(backend, owner, "following", 2_000L))
        cache.clear(backend)
        assertNull(cache.cached(backend, owner, "following", 300_000L, 2_000L))
    }
}
