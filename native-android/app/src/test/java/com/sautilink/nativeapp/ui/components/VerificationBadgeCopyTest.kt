package com.sautilink.nativeapp.ui.components

import org.junit.Assert.*
import org.junit.Test

class VerificationBadgeCopyTest {
    @Test fun blueProfileMessagesRemainUnchangedForOwnerAndOtherViewer() {
        assertEquals(VerificationBadgeCopy("Verified profile", "This profile was verified as belonging to Person."),
            verificationBadgeCopy(false, false, "Person"))
        assertEquals(VerificationBadgeCopy("Verified profile", "This profile is verified. Verification may be removed if you violate SautiLink rules or policies."),
            verificationBadgeCopy(false, true, "Person"))
    }
    @Test fun orangeProfileDescribesReviewedAuthenticEntityWithoutStaffMembershipClaim() {
        for (owner in listOf(false, true)) {
            val copy = verificationBadgeCopy(true, owner, "Example")
            assertEquals("Verified Profile", copy.title)
            assertTrue(copy.description.contains("reviewed"))
            assertTrue(copy.description.contains("brand, business or entity"))
            assertFalse(copy.description.contains("Team"))
            assertFalse(copy.description.contains("staff"))
        }
    }
}
