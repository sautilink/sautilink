package com.sautilink.nativeapp.network

import okhttp3.Call
import okhttp3.Connection
import okhttp3.EventListener
import okhttp3.Handshake
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy

/** Last fixed callback milestone only; no callback/request data is retained. */
internal class RoomNetworkMilestones : EventListener() {
    @Volatile var phase = SautiNetworkPhase.EXECUTE
        private set
    @Volatile var seenStatus: Int? = null
        private set

    override fun dnsStart(call: Call, domainName: String) { phase = SautiNetworkPhase.DNS_START }
    override fun dnsEnd(call: Call, domainName: String, inetAddressList: List<InetAddress>) { phase = SautiNetworkPhase.DNS_END }
    override fun connectStart(call: Call, inetSocketAddress: InetSocketAddress, proxy: Proxy) { phase = SautiNetworkPhase.CONNECT_START }
    override fun secureConnectStart(call: Call) { phase = SautiNetworkPhase.TLS_START }
    override fun secureConnectEnd(call: Call, handshake: Handshake?) { phase = SautiNetworkPhase.TLS_END }
    override fun connectEnd(call: Call, inetSocketAddress: InetSocketAddress, proxy: Proxy, protocol: Protocol?) { phase = SautiNetworkPhase.CONNECT_END }
    override fun connectionAcquired(call: Call, connection: Connection) { phase = SautiNetworkPhase.CONNECTION_READY }
    override fun requestHeadersStart(call: Call) { phase = SautiNetworkPhase.REQUEST_HEADERS_START }
    override fun requestHeadersEnd(call: Call, request: Request) { phase = SautiNetworkPhase.REQUEST_HEADERS_END }
    override fun requestBodyStart(call: Call) { phase = SautiNetworkPhase.REQUEST_BODY_START }
    override fun requestBodyEnd(call: Call, byteCount: Long) { phase = SautiNetworkPhase.REQUEST_BODY_END }
    override fun responseHeadersStart(call: Call) { phase = SautiNetworkPhase.RESPONSE_HEADERS_START }
    override fun responseHeadersEnd(call: Call, response: Response) {
        seenStatus = response.code
        phase = SautiNetworkPhase.RESPONSE_HEADERS_END
    }
    override fun responseBodyStart(call: Call) { phase = SautiNetworkPhase.RESPONSE_BODY }

    fun readingBody(status: Int) { seenStatus = status; phase = SautiNetworkPhase.RESPONSE_BODY }
    fun httpStatusFailure() { phase = SautiNetworkPhase.HTTP_STATUS }

    // Inherited failure callbacks intentionally keep the last milestone; only the transport catch logs.
    companion object {
        val factory = EventListener.Factory { call ->
            call.request().tag(RoomNetworkMilestones::class.java) ?: EventListener.NONE
        }
    }
}
