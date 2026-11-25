package com.sautilink.nativeapp.feature.inbox

import java.time.ZoneId
import org.junit.Assert.*
import org.junit.Test

class NativePeerActivityTest {
    @Test fun hiddenAndUnavailableStatusesNeverRevealRealtimeOrLastSeen() {
        assertEquals("Privacy Mode", NativePeerActivity("hidden", "2026-11-25T10:00:00Z").label(true, true))
        assertEquals("", NativePeerActivity("unavailable").label(true, true))
        assertEquals("", NativePeerActivity("loading").label(true, false))
    }
    @Test fun visibleActivityUsesTypingThenOnlineThenTheUsersLocalTime() {
        val activity = NativePeerActivity("visible", "2026-11-25T10:00:00Z")
        assertEquals("typing", activity.label(true, true))
        assertEquals("Online", activity.label(true, false))
        assertEquals("Last seen 25 Nov, 13:00", activity.label(false, false, ZoneId.of("Africa/Dar_es_Salaam"), java.time.Instant.parse("2026-11-25T10:01:00Z")))
        assertEquals("", NativePeerActivity("visible", "invalid").label(false, false))
    }
}
