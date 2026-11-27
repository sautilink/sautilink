package com.sautilink.nativeapp.feature.profile

import org.junit.Assert.assertEquals
import org.junit.Test

class ProfileFollowPresentationTest {
    @Test fun confirmedFollowUpdatesCountWithoutFetchingTheProfileAgain() {
        assertEquals(12,updatedProfileFollowerCount(11,false,true))
        assertEquals(10,updatedProfileFollowerCount(11,true,false))
    }
    @Test fun sameConfirmedStateDoesNotDoubleCountAndCountsRemainBounded() {
        assertEquals(11,updatedProfileFollowerCount(11,true,true))
        assertEquals(11,updatedProfileFollowerCount(11,false,false))
        assertEquals(0,updatedProfileFollowerCount(0,true,false))
        assertEquals(Int.MAX_VALUE,updatedProfileFollowerCount(Int.MAX_VALUE,false,true))
    }
}
