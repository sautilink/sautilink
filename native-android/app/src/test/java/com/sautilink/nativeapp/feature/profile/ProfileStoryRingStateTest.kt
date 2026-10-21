package com.sautilink.nativeapp.feature.profile

import com.sautilink.nativeapp.feature.stories.NativeStory
import com.sautilink.nativeapp.feature.stories.NativeStoryAuthor
import com.sautilink.nativeapp.feature.stories.NativeStoryGroup
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class ProfileStoryRingStateTest {
    private val account = "11111111-1111-4111-8111-111111111111"
    private val member = "22222222-2222-4222-8222-222222222222"
    private val other = "33333333-3333-4333-8333-333333333333"
    private val scope = ProfileStoryRingScope(account, member, "sampleuser")
    private val expiry = "2026-10-22T12:00:00Z"
    private val now = Instant.parse("2026-10-21T12:00:00Z").toEpochMilli()
    private fun group(owner: String = member, username: String = "sampleuser", expires: String = expiry) = NativeStoryGroup(
        NativeStoryAuthor(owner, username, "Sample", false, "standard", false), listOf(NativeStory(
            "44444444-4444-4444-8444-444444444444", owner, "image", "", "", expires, 0, "", "", "", false, 0, null)))

    @Test fun lateEmptyResponseCannotEraseNewerPublishedStoryPresence() {
        val oldRead = ProfileStoryRingState().begin(scope)
        val oldTicket = oldRead.ticket()
        val newRead = oldRead.begin(scope)
        val confirmed = newRead.complete(newRead.ticket(), group())
        assertTrue(confirmed.activeFor(scope, now))
        assertEquals(confirmed, confirmed.complete(oldTicket, null))
        assertTrue(confirmed.complete(oldTicket, null).activeFor(scope, now))
    }

    @Test fun accountAndProfileSwitchesInvalidateOldAsyncResponsesImmediately() {
        val firstRead = ProfileStoryRingState().begin(scope)
        val ticket = firstRead.ticket()
        val first = firstRead.complete(ticket, group())
        val accountChanged = scope.copy(accountId = other)
        val switchedAccount = first.begin(accountChanged)
        assertFalse(switchedAccount.activeFor(accountChanged, now))
        assertEquals(switchedAccount, switchedAccount.complete(ticket, group()))
        val profileChanged = scope.copy(profileId = other, username = "anotheruser")
        val switchedProfile = first.begin(profileChanged)
        assertFalse(switchedProfile.activeFor(profileChanged, now))
        assertFalse(first.activeFor(profileChanged, now))
    }

    @Test fun refreshKeepsValidatedRingDuringReadButConfirmedEmptyClearsIt() {
        val firstRead = ProfileStoryRingState().begin(scope)
        val first = firstRead.complete(firstRead.ticket(), group())
        val refreshing = first.begin(scope)
        assertTrue(refreshing.activeFor(scope, now))
        assertFalse(refreshing.complete(refreshing.ticket(), null).activeFor(scope, now))
    }

    @Test fun sharedHomePresenceOnlyHelpsUntilThisProfileHasAnAuthoritativeResponse() {
        val initial = ProfileStoryRingState()
        assertTrue(initial.visibleFor(scope, now, sharedActive = true))
        assertFalse(initial.visibleFor(scope, now, sharedActive = false))
        val read = initial.begin(scope)
        assertTrue(read.visibleFor(scope, now, sharedActive = true))
        val empty = read.complete(read.ticket(), null)
        assertFalse(empty.visibleFor(scope, now, sharedActive = true))
        val refreshed = empty.begin(scope)
        assertFalse(refreshed.visibleFor(scope, now, sharedActive = true))
        assertEquals(empty.confirmed, refreshed.confirmed)
        val published = refreshed.complete(refreshed.ticket(), group())
        assertTrue(published.visibleFor(scope, now, sharedActive = false))
        val deadline = Instant.parse(expiry).toEpochMilli()
        assertFalse(published.visibleFor(scope, deadline, sharedActive = true))
        assertFalse(published.begin(scope).visibleFor(scope, deadline, sharedActive = true))
    }

    @Test fun authoritativeStateAndLateResponsesCannotSuppressAnotherAccountsOrProfilesInitialHint() {
        val read = ProfileStoryRingState().begin(scope)
        val oldTicket = read.ticket()
        val empty = read.complete(oldTicket, null)
        val changedAccount = scope.copy(accountId = other)
        val changedProfile = scope.copy(profileId = other, username = "anotheruser")
        for (next in listOf(changedAccount, changedProfile)) {
            val switching = empty.begin(next)
            assertFalse(switching.confirmed)
            assertFalse(switching.visibleFor(next, now, sharedActive = false))
            assertTrue(switching.visibleFor(next, now, sharedActive = true))
            val staleResponse = switching.complete(oldTicket, group())
            assertEquals(switching, staleResponse)
            assertFalse(staleResponse.visibleFor(next, now, sharedActive = false))
            assertTrue(staleResponse.visibleFor(next, now, sharedActive = true))
            assertFalse(staleResponse.visibleFor(null, now, sharedActive = true))
        }
    }

    @Test fun malformedExpiryAndExactDeadlineNeverLeaveAnActiveRing() {
        val read = ProfileStoryRingState().begin(scope)
        val result = read.complete(read.ticket(), group())
        val deadline = Instant.parse(expiry).toEpochMilli()
        assertTrue(result.activeFor(scope, deadline - 1))
        assertFalse(result.activeFor(scope, deadline))
        assertFalse(read.complete(read.ticket(), group(expires = "not-a-date")).activeFor(scope, now))
    }

    @Test fun reusedUsernameOrWrongAuthorCannotAttachAnotherMembersStoryToThisAvatar() {
        val read = ProfileStoryRingState().begin(scope)
        assertFalse(read.complete(read.ticket(), group(owner = other)).activeFor(scope, now))
        assertFalse(read.complete(read.ticket(), group(username = "anotheruser")).activeFor(scope, now))
        val foreignMedia = group().copy(stories = group().stories.map { it.copy(ownerId = other) })
        assertFalse(read.complete(read.ticket(), foreignMedia).activeFor(scope, now))
    }

    @Test fun onlyResolvedSignedInProfileCanCreateLookupScope() {
        val profile = NativeProfile(member, "sampleuser", "Sample", "", "", "", true, 0, 0, "", false, false, "", false, "standard")
        assertEquals(scope, ProfileStoryRingScope.create(account, profile))
        assertNull(ProfileStoryRingScope.create(null, profile))
        assertNull(ProfileStoryRingScope.create(account, null))
        assertNull(ProfileStoryRingScope.create("invalid", profile))
        assertNull(ProfileStoryRingScope.create(account, profile.copy(username = "../outside")))
    }
}
