package com.sautilink.nativeapp.ui.components

internal data class VerificationBadgeCopy(val title: String, val description: String)

internal fun verificationBadgeCopy(entity: Boolean, profileOwner: Boolean, displayName: String): VerificationBadgeCopy =
    if (entity) VerificationBadgeCopy("Verified Profile", if (profileOwner)
        "SautiLink has reviewed this profile and verified that it represents an authentic brand, business or entity. Verification may be removed if you violate SautiLink rules or policies."
        else "SautiLink has reviewed this profile and verified that it authentically represents $displayName as a brand, business or entity.")
    else VerificationBadgeCopy("Verified profile", if (profileOwner)
        "This profile is verified. Verification may be removed if you violate SautiLink rules or policies."
        else "This profile was verified as belonging to $displayName.")
