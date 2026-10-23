package com.sautilink.nativeapp.feature.verification

import org.junit.Assert.*
import org.junit.Test

class VerificationApplicantPolicyTest {
    @Test fun allEntityTypesRequireAnArticleEvenWhenSocialProfilesExist() {
        VerificationApplicantType.entries.filter { it != VerificationApplicantType.INDIVIDUAL }.forEach { type ->
            assertNotNull(type.wire, verificationEvidenceError(type, listOf("https://instagram.com/example"), emptyList()))
            assertNull(type.wire, verificationEvidenceError(type, emptyList(), listOf("https://news.example/story")))
        }
    }
    @Test fun individualsKeepSocialOrArticleEvidenceWithoutAnArticleMandate() {
        assertNull(verificationEvidenceError(VerificationApplicantType.INDIVIDUAL, listOf("https://youtube.com/@example"), emptyList()))
        assertNull(verificationEvidenceError(VerificationApplicantType.INDIVIDUAL, emptyList(), listOf("http://news.example/story")))
        assertNotNull(verificationEvidenceError(VerificationApplicantType.INDIVIDUAL, emptyList(), emptyList()))
    }
    @Test fun malformedOrCredentialBearingLinksCannotCountAsRequiredEvidence() {
        listOf("https://", "https:news.example/story", "javascript:alert(1)", "file:///identity.pdf",
            "https://user:password@news.example/story", "https://news.example/a b").forEach { article ->
            assertNotNull(article, verificationEvidenceError(VerificationApplicantType.BUSINESS, emptyList(), listOf(article)))
        }
    }
    @Test fun maximumFiveArticlesIsValidatedInsteadOfSilentlyTruncatingTheSubmission() {
        val links = (1..6).map { "https://news.example/article/$it" }
        assertNull(verificationEvidenceError(VerificationApplicantType.ORGANISATION, emptyList(), links.take(5)))
        assertNotNull(verificationEvidenceError(VerificationApplicantType.ORGANISATION, emptyList(), links))
    }
    @Test fun socialLinksRequireHttpsWhileIndependentArticlesMayUseHttp() {
        assertNotNull(verificationEvidenceError(VerificationApplicantType.INDIVIDUAL, listOf("http://social.example/user"), emptyList()))
        assertTrue(verificationPublicUrl("http://news.example/story"))
        assertFalse(verificationPublicUrl("https://news.example/" + "x".repeat(1000)))
    }
    @Test fun accountTypesUseOnlyTheServerApprovedWireValues() {
        assertEquals(setOf("individual", "business", "brand", "entity", "organisation"),
            VerificationApplicantType.entries.map { it.wire }.toSet())
    }
}
