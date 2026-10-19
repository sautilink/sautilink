package com.sautilink.nativeapp.network

import okhttp3.*
import okhttp3.RequestBody.Companion.toRequestBody
import okio.Timeout
import java.lang.reflect.Modifier
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

// Actual OkHttp callback types; execute/enqueue intentionally throw before any I/O.
private class NeverNetworkCall(private val original: Request) : Call {
    override fun request() = original
    override fun execute(): Response = error("Network execution forbidden in callback check")
    override fun enqueue(responseCallback: Callback): Unit = error("Network execution forbidden in callback check")
    override fun cancel() = Unit
    override fun isExecuted() = false
    override fun isCanceled() = false
    override fun timeout() = Timeout()
    override fun clone(): Call = NeverNetworkCall(original)
}
private object IgnoredConnection : Connection {
    override fun route(): Route = error("Callback must not inspect connection metadata")
    override fun socket(): Socket = error("Callback must not inspect socket/address metadata")
    override fun handshake(): Handshake? = error("Callback must not inspect handshake metadata")
    override fun protocol(): Protocol = error("Callback must not inspect connection metadata")
}

fun main() {
    var checks = 0
    fun verify(ok: Boolean, label: String) { check(ok) { label }; checks++; println("PASS: $label") }
    val secret = "PRIVATE_CALLBACK_MARKER"
    fun request(trace: RoomNetworkMilestones?) = Request.Builder()
        .url("https://example.invalid/$secret?token=$secret")
        .header("Authorization", "Bearer $secret").post(secret.toRequestBody())
        .apply { if (trace != null) tag(RoomNetworkMilestones::class.java, trace) }.build()
    val a = RoomNetworkMilestones()
    val b = RoomNetworkMilestones()
    val requestA = request(a)
    val callA = NeverNetworkCall(requestA)
    val callB = NeverNetworkCall(request(b))
    val address = InetSocketAddress.createUnresolved("$secret.invalid", 443)
    val timeout = SocketTimeoutException("$secret host/header/body details must never be logged")
    verify(RoomNetworkMilestones.factory.create(callA) === a, "factory uses exact first call tag")
    verify(RoomNetworkMilestones.factory.create(callB) === b && a !== b, "different calls receive independent trace objects")
    verify(RoomNetworkMilestones.factory.create(NeverNetworkCall(request(null))) === EventListener.NONE, "untagged calls preserve no-op listener")
    verify(a.phase == SautiNetworkPhase.EXECUTE && a.seenStatus == null, "new trace begins before any network milestone")
    a.dnsStart(callA, "$secret.invalid")
    verify(a.phase == SautiNetworkPhase.DNS_START, "DNS start uses fixed milestone only")
    a.dnsEnd(callA, "$secret.invalid", listOf(InetAddress.getByAddress(byteArrayOf(127, 0, 0, 1))))
    verify(a.phase == SautiNetworkPhase.DNS_END, "DNS end records completion without addresses")
    a.connectStart(callA, address, Proxy.NO_PROXY)
    verify(a.phase == SautiNetworkPhase.CONNECT_START, "connect start remains distinct from TLS")
    a.secureConnectStart(callA)
    a.connectFailed(callA, address, Proxy.NO_PROXY, null, timeout)
    a.callFailed(callA, timeout)
    verify(a.phase == SautiNetworkPhase.TLS_START && a.seenStatus == null, "TLS timeout failure callbacks preserve last milestone")
    a.secureConnectEnd(callA, null)
    verify(a.phase == SautiNetworkPhase.TLS_END, "completed TLS has an explicit end milestone")
    a.connectEnd(callA, address, Proxy.NO_PROXY, Protocol.HTTP_2)
    verify(a.phase == SautiNetworkPhase.CONNECT_END, "completed connection is explicit")
    a.connectionAcquired(callA, IgnoredConnection)
    verify(a.phase == SautiNetworkPhase.CONNECTION_READY, "connection callback does not inspect metadata")
    a.requestHeadersStart(callA)
    verify(a.phase == SautiNetworkPhase.REQUEST_HEADERS_START, "request header write start is distinct")
    a.requestHeadersEnd(callA, requestA)
    a.responseFailed(callA, timeout)
    verify(a.phase == SautiNetworkPhase.REQUEST_HEADERS_END && a.seenStatus == null, "pre-first-header timeout keeps request-header completion milestone")
    a.requestBodyStart(callA)
    verify(a.phase == SautiNetworkPhase.REQUEST_BODY_START, "request body write start is distinct")
    a.requestBodyEnd(callA, Long.MAX_VALUE)
    a.requestFailed(callA, timeout)
    verify(a.phase == SautiNetworkPhase.REQUEST_BODY_END, "request failure preserves body completion without byte data")
    a.responseHeadersStart(callA)
    verify(a.phase == SautiNetworkPhase.RESPONSE_HEADERS_START, "first response-header callback has its own milestone")
    val response = Response.Builder().request(requestA).protocol(Protocol.HTTP_2).code(200).message(secret).header("Set-Cookie", secret).build()
    a.responseHeadersEnd(callA, response)
    verify(a.phase == SautiNetworkPhase.RESPONSE_HEADERS_END && a.seenStatus == 200, "response-header end retains only numeric status")
    a.responseBodyStart(callA)
    a.responseFailed(callA, timeout)
    a.callFailed(callA, timeout)
    verify(a.phase == SautiNetworkPhase.RESPONSE_BODY && a.seenStatus == 200, "body timeout preserves milestone and previously received status")
    val log = sautiNetworkFailureDiagnostic(timeout, "GET", SautiNetworkSite.SITE, 10002, a.seenStatus, a.phase)
    verify(log.contains("phase=RESPONSE_BODY") && log.contains("status=200") && !log.contains(secret) && !log.contains("example.invalid") && !log.contains("Authorization") && !log.contains("Set-Cookie"), "single catch formatter reveals no callback/request/exception details")
    a.readingBody(403)
    a.httpStatusFailure()
    verify(a.phase == SautiNetworkPhase.HTTP_STATUS && a.seenStatus == 403, "existing body/status catch annotations remain available")

    val reused = RoomNetworkMilestones()
    reused.connectionAcquired(callB, IgnoredConnection)
    reused.requestHeadersStart(callB)
    reused.requestHeadersEnd(callB, callB.request())
    reused.callFailed(callB, timeout)
    verify(reused.phase == SautiNetworkPhase.REQUEST_HEADERS_END && reused.seenStatus == null, "reused connection without DNS or TLS events still identifies post-request milestone")

    val first = RoomNetworkMilestones()
    val second = RoomNetworkMilestones()
    val firstReady = CountDownLatch(1)
    val secondReady = CountDownLatch(1)
    val failure = AtomicReference<Throwable?>(null)
    val t1 = Thread {
        try {
            first.dnsStart(callA, secret); first.secureConnectStart(callA); firstReady.countDown()
            check(secondReady.await(3, TimeUnit.SECONDS))
            check(first.phase == SautiNetworkPhase.TLS_START && first.seenStatus == null)
        } catch (e: Throwable) { failure.set(e) }
    }
    val t2 = Thread {
        try {
            check(firstReady.await(3, TimeUnit.SECONDS))
            second.connectionAcquired(callB, IgnoredConnection)
            second.responseHeadersEnd(callB, response.newBuilder().code(204).build())
        } catch (e: Throwable) { failure.set(e) }
        finally { secondReady.countDown() }
    }
    t1.start(); t2.start(); t1.join(5000); t2.join(5000)
    verify(!t1.isAlive && !t2.isAlive && failure.get() == null && first.phase == SautiNetworkPhase.TLS_START &&
        second.phase == SautiNetworkPhase.RESPONSE_HEADERS_END && second.seenStatus == 204, "actual concurrent callbacks do not overwrite another call's phase or status")
    val fields = RoomNetworkMilestones::class.java.declaredFields.filterNot { Modifier.isStatic(it.modifiers) }
    verify(fields.size == 2 && fields.all { Modifier.isVolatile(it.modifiers) }, "only per-call metadata fields are volatile")
    verify(fields.all { it.type == SautiNetworkPhase::class.java || it.type == java.lang.Integer::class.java }, "trace retains no request/response/call/address/body/string/throwable objects")
    println("PASS: $checks actual cached OkHttp callback milestone checks; no execute/enqueue/network calls")
}
