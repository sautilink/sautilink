package com.sautilink.nativeapp.feature.inbox

import org.junit.Assert.*
import org.junit.Test

class InboxReturnPresentationTest {
    @Test fun freshConversationStartsAtTailButReturnKeepsItsHistoryAnchor() {
        assertTrue(shouldFollowConversationTail(true, false, false, false, false))
        assertFalse(shouldFollowConversationTail(true, true, false, false, false))
    }
    @Test fun readingHistoryDoesNotJumpForIncomingActivity() {
        assertFalse(shouldFollowConversationTail(false, true, false, false, false))
        assertTrue(shouldFollowConversationTail(false, true, true, false, false))
        assertTrue(shouldFollowConversationTail(false, true, false, true, false))
    }
    @Test fun searchResultsNeverForceTailScrolling() {
        assertFalse(shouldFollowConversationTail(false, false, true, true, true))
    }
    @Test fun selectedThreadDoesNotReloadHiddenInboxButForwardCanFetchItsMissingDestinations() {
        assertEquals(InboxReadPlan(false, false), inboxReadPlan(true, true, "chat", false, false))
        assertEquals(InboxReadPlan(false, true), inboxReadPlan(true, true, "chat", true, false))
        assertEquals(InboxReadPlan(false, false), inboxReadPlan(true, true, "chat", true, true))
        assertEquals(InboxReadPlan(true, false), inboxReadPlan(true, true, null, false, false))
    }
    @Test fun logoutAndBackgroundCannotStartEitherInboxReader() {
        assertEquals(InboxReadPlan(false, false), inboxReadPlan(false, true, null, false, false))
        assertEquals(InboxReadPlan(false, false), inboxReadPlan(true, false, "chat", true, false))
    }
}
