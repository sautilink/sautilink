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
import javax.net.ssl.SSLException

internal enum class SautiNetworkPhase { EXECUTE, RESPONSE_BODY, HTTP_STATUS }
internal enum class SautiNetworkSite { REST, SITE, AUTH }

/** Fixed transport metadata only: never include Throwable messages or request/response data. */
internal fun sautiNetworkFailureDiagnostic(error: Exception, method: String, site: SautiNetworkSite,
    elapsedMs: Long, status: Int?, phase: SautiNetworkPhase): String {
    val category = when {
        phase == SautiNetworkPhase.HTTP_STATUS && status in 400..599 -> "HTTP"
        error is CancellationException -> "CANCELLED_OR_COROUTINE_TIMEOUT"
        error is UnknownHostException -> "DNS"
        error is SSLException -> "TLS"
        error is SocketTimeoutException -> "TIMEOUT"
        error is InterruptedIOException -> "INTERRUPTED_OR_CALL_TIMEOUT"
        error is ConnectException -> "CONNECT"
        error is ProtocolException -> "PROTOCOL"
        error is EOFException -> "EOF"
        error is SocketException -> "SOCKET_IO"
        error is IOException -> "IO_OTHER"
        else -> "NON_IO_EXCEPTION"
    }
    val safeMethod = when (method) { "GET", "POST", "PUT", "PATCH", "DELETE" -> method; else -> "OTHER" }
    val type = error.javaClass.simpleName.filter { it.isLetterOrDigit() || it == '_' }.take(64).ifBlank { "Exception" }
    val safeStatus = status?.takeIf { it in 100..599 }?.toString() ?: "NONE"
    return "site=${site.name} method=$safeMethod phase=${phase.name} " +
        "elapsed_ms=${elapsedMs.coerceAtLeast(0)} status=$safeStatus category=$category class=$type"
}
