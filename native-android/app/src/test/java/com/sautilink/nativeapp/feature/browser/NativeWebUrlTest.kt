package com.sautilink.nativeapp.feature.browser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NativeWebUrlTest {
    @Test fun browserKeepsValidWebDestinations() {
        assertEquals("https://example.com/path?a=b#section",
            secureWebUrl("https://Example.com/path?a=b#section"))
        assertEquals("https://www.example.com", secureWebUrl("www.example.com"))
        assertEquals("https://example.com/path", secureWebUrl("http://example.com:80/path"))
        assertEquals("https://example.com:8080/path", secureWebUrl("http://example.com:8080/path"))
    }

    @Test fun browserRejectsLocalContentAndExternalAppIntents() {
        listOf(
            "javascript:alert(1)", "file:///data/data/sautilink", "content://example.com/item",
            "intent://example.com/#Intent;scheme=https;end", "data:text/html,hi",
            "https://sautilink.com@other.example", "https:///missing-host"
        ).forEach { assertNull(it, secureWebUrl(it)) }
    }
}
