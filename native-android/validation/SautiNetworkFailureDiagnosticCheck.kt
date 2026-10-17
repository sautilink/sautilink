package com.sautilink.nativeapp.network

import java.io.EOFException
import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.ProtocolException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.CancellationException
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException

fun main() {
    var checks = 0
    fun verify(ok: Boolean, label: String) { check(ok) { label }; checks++; println("PASS: $label") }
    val secret = "PRIVATE_MARKER Authorization: Bearer token-value https://example.test/private?account=private body-data"
    val vectors = listOf(
        UnknownHostException(secret) to "DNS",
        SSLHandshakeException(secret) to "TLS",
        SSLPeerUnverifiedException(secret) to "TLS",
        SocketTimeoutException(secret) to "TIMEOUT",
        InterruptedIOException(secret) to "INTERRUPTED_OR_CALL_TIMEOUT",
        ConnectException(secret) to "CONNECT",
        ProtocolException(secret) to "PROTOCOL",
        EOFException(secret) to "EOF",
        SocketException(secret) to "SOCKET_IO",
        IOException(secret) to "IO_OTHER",
        CancellationException(secret) to "CANCELLED_OR_COROUTINE_TIMEOUT",
        IllegalStateException(secret) to "NON_IO_EXCEPTION"
    )
    vectors.forEach { (error, category) ->
        val log = sautiNetworkFailureDiagnostic(error, "POST", SautiNetworkSite.AUTH, 31, null, SautiNetworkPhase.EXECUTE)
        verify(log.contains("category=$category ") && log.contains("class=${error.javaClass.simpleName}"), "classify ${error.javaClass.simpleName} without guessing message")
        verify(!log.contains("PRIVATE_MARKER") && !log.contains("Authorization") && !log.contains("example.test") &&
            !log.contains("body-data") && log.startsWith("site=AUTH method=POST phase=EXECUTE elapsed_ms=31 status=NONE "), "fixed metadata excludes exception details for ${error.javaClass.simpleName}")
    }
    val http = sautiNetworkFailureDiagnostic(Exception(secret), "GET", SautiNetworkSite.SITE, 7, 503, SautiNetworkPhase.HTTP_STATUS)
    verify(http.contains("category=HTTP ") && http.contains("status=503"), "completed HTTP failure retains numeric status")
    val body = sautiNetworkFailureDiagnostic(SocketTimeoutException(secret), "GET", SautiNetworkSite.REST, 10000, 200, SautiNetworkPhase.RESPONSE_BODY)
    verify(body.contains("category=TIMEOUT ") && body.contains("phase=RESPONSE_BODY") && body.contains("status=200"), "body read failure stays distinct after successful headers")
    val injected = sautiNetworkFailureDiagnostic(Exception(secret), "GET $secret", SautiNetworkSite.AUTH, -1, 999, SautiNetworkPhase.EXECUTE)
    verify(injected.contains("method=OTHER") && injected.contains("elapsed_ms=0") && injected.contains("status=NONE") && !injected.contains("PRIVATE_MARKER"), "unknown method and invalid numeric metadata cannot inject sensitive values")
    println("PASS: $checks actual network diagnostic checks")
}
