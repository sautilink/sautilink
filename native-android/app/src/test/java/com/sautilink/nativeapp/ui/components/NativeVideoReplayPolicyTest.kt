package com.sautilink.nativeapp.ui.components

import org.junit.Assert.*
import org.junit.Test

class NativeVideoReplayPolicyTest {
    private val id = "00000000-0000-4000-8000-000000000001"
    private val generation = "11111111-1111-4111-8111-111111111111"
    private val identity = "https://sautilink.com/api/sauti-media/$id/hls/$generation/s_${"a".repeat(43)}"

    @Test fun accountAuthObjectAndExactCredentialAllSeparateReplayNamespaces() {
        val auth = Any()
        val scope = NativeVideoReplayScope(auth, "account-one", "fixture-token")
        assertTrue(scope.matches(NativeVideoReplayScope(auth, "account-one", "fixture-token")))
        assertFalse(scope.matches(NativeVideoReplayScope(Any(), "account-one", "fixture-token")))
        assertFalse(scope.matches(NativeVideoReplayScope(auth, "account-two", "fixture-token")))
        assertFalse(scope.matches(NativeVideoReplayScope(auth, "account-one", "rotated-fixture-token")))
        assertThrows(IllegalArgumentException::class.java) { NativeVideoReplayScope(auth, "", "fixture") }
        assertThrows(IllegalArgumentException::class.java) { NativeVideoReplayScope(auth, "account-one", "") }
    }

    @Test fun onlyGenerationBoundPublishedOpaqueHlsIdentitiesEnterReplayPool() {
        val parsed = nativeVideoReplayIdentity(identity)!!
        assertEquals("https://sautilink.com/api/sauti-media/$id", parsed.content)
        assertEquals(generation, parsed.generation)
        listOf(identity.replace("s_", "m_"), "$identity?c=capability",
            identity.replace("sautilink.com", "untrusted.test"), identity.replace("https:", "http:"),
            identity.replace("/sauti-media/", "/stories/"), "https://sautilink.com/api/sauti-media/$id",
            "$identity#fragment", identity.replace("/hls/$generation/", "/hls/"),
            identity.replace("/hls/", "/hls/%2F"), identity.replace("https://", "https://user@"))
            .forEach { assertNull(it, nativeVideoReplayIdentity(it)) }
    }
}
