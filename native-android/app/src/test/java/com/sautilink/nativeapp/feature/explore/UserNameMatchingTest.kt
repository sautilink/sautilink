package com.sautilink.nativeapp.feature.explore

import org.junit.Assert.*
import org.junit.Test

class UserNameMatchingTest {
    @Test fun scopedListsMatchSpacingPunctuationAndSmallTypos() {
        assertTrue(userNameMatches("Dr charles", "drcharlestz", "Dr. Charles"))
        assertTrue(userNameMatches("drcharels", "drcharles"))
        assertTrue(userNameMatches("@dr.charles", "drcharles"))
        assertTrue(userNameMatches("José", "Jose"))
        assertFalse(userNameMatches("sautilink", "charles"))
        assertFalse(userNameMatches("da", "dr"))
    }
}
