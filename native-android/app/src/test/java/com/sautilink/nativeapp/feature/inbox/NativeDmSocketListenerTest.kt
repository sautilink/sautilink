package com.sautilink.nativeapp.feature.inbox

import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

/** Synthetic loopback protocol test: real pinned OkHttp and the production listener.
 * No Android context, restored account, real token, production request or user message.
 */
class NativeDmSocketListenerTest {
    private class FakeSocket(private val rejectClose: Boolean = false) : WebSocket {
        val closeCodes = mutableListOf<Int>()
        val closeReasons = mutableListOf<String?>()
        var cancellations = 0
        override fun request() = Request.Builder().url("https://offline.invalid/").build()
        override fun queueSize() = 0L
        override fun send(text: String) = true
        override fun send(bytes: ByteString) = true
        override fun close(code: Int, reason: String?): Boolean {
            if (rejectClose) throw IllegalArgumentException("Synthetic invalid close")
            closeCodes += code
            closeReasons += reason
            return true
        }
        override fun cancel() { cancellations++ }
    }

    private fun response() = Response.Builder().request(Request.Builder().url("https://offline.invalid/").build())
        .protocol(Protocol.HTTP_1_1).code(101).message("Synthetic upgrade").build()

    @Test fun server1008GetsAcknowledgedWithoutWaitingForThe25SecondPingFailure() {
        CloseServer().use { server ->
            val cleanClosed = CountDownLatch(1)
            val disconnected = CountDownLatch(1)
            val failure = AtomicReference<Throwable?>()
            val closeCode = AtomicInteger()
            val adapter = NativeDmSocketListener(isCurrent = { true }, onConnected = {}, onText = {},
                onDisconnected = { disconnected.countDown() })
            // Observe protocol completion while forwarding every callback to actual production code.
            val observing = object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) = adapter.onOpen(webSocket, response)
                override fun onMessage(webSocket: WebSocket, text: String) = adapter.onMessage(webSocket, text)
                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) = adapter.onClosing(webSocket, code, reason)
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    adapter.onClosed(webSocket, code, reason)
                    closeCode.set(code)
                    cleanClosed.countDown()
                }
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    adapter.onFailure(webSocket, t, response)
                    failure.set(t)
                    cleanClosed.countDown()
                }
            }
            val client = OkHttpClient.Builder().connectTimeout(2, TimeUnit.SECONDS)
                .pingInterval(25, TimeUnit.SECONDS).build()
            val socket = client.newWebSocket(Request.Builder().url(server.url).build(), observing)
            try {
                assertTrue("Current socket state must clear promptly", disconnected.await(2, TimeUnit.SECONDS))
                assertTrue("Close frame must be acknowledged promptly", server.acknowledged.await(2, TimeUnit.SECONDS))
                assertTrue("The handshake must finish cleanly", cleanClosed.await(2, TimeUnit.SECONDS))
                assertNull("A ping timeout is not a successful close", failure.get())
                assertNull("Synthetic server must finish without error", server.failure.get())
                assertEquals(1008, closeCode.get())
                assertEquals(1008, server.acknowledgedCode.get())
            } finally {
                socket.cancel()
                client.connectionPool.evictAll()
                client.dispatcher.executorService.shutdownNow()
            }
        }
    }

    @Test fun obsoleteAttemptCannotOpenDeliverMessagesOrDisconnectItsReplacement() {
        var generation = 1
        var opened = 0
        var disconnected = 0
        val messages = mutableListOf<String>()
        val old = NativeDmSocketListener({ generation == 1 }, { opened++ }, { messages += it }, { disconnected++ })
        val socket = FakeSocket()
        old.onOpen(socket, response())
        assertEquals(1, opened)
        generation = 2
        old.onOpen(socket, response())
        old.onMessage(socket, "stale synthetic event")
        old.onClosed(socket, 1008, "Synthetic")
        old.onFailure(socket, IllegalStateException("Synthetic"), null)
        assertEquals(1, opened)
        assertEquals(0, disconnected)
        assertTrue(messages.isEmpty())
        assertEquals(listOf(1000), socket.closeCodes)
        val current = NativeDmSocketListener({ generation == 2 }, { opened++ }, { messages += it }, { disconnected++ })
        current.onOpen(FakeSocket(), response())
        current.onMessage(FakeSocket(), "current synthetic event")
        assertEquals(2, opened)
        assertEquals(listOf("current synthetic event"), messages)
    }

    @Test fun obsoleteClosingStillAcknowledgesTransportWithoutClearingCurrentStateOrEchoingReason() {
        val socket = FakeSocket()
        var disconnected = 0
        val listener = NativeDmSocketListener({ false }, {}, {}, { disconnected++ })
        listener.onClosing(socket, 1008, "Synthetic private reason must not be echoed")
        assertEquals(listOf(1008), socket.closeCodes)
        assertEquals(listOf<String?>(null), socket.closeReasons)
        assertEquals(0, disconnected)
    }

    @Test fun rejectedCloseCodeCancelsTheTransportAndClearsCurrentState() {
        val socket = FakeSocket(rejectClose = true)
        var disconnected = 0
        val listener = NativeDmSocketListener({ true }, {}, {}, { disconnected++ })
        listener.onClosing(socket, 1005, "Synthetic missing status")
        assertEquals(1, socket.cancellations)
        assertEquals(1, disconnected)
    }

    @Test fun currentCloseAndFailureClearStateButInactiveCallbacksAreIgnored() {
        var active = true
        var disconnected = 0
        val socket = FakeSocket()
        val listener = NativeDmSocketListener({ active }, {}, {}, { disconnected++ })
        listener.onClosed(socket, 1000, "Synthetic")
        listener.onFailure(socket, IllegalStateException("Synthetic"), null)
        assertEquals(2, disconnected)
        active = false
        listener.onClosed(socket, 1000, "Synthetic")
        listener.onFailure(socket, IllegalStateException("Synthetic"), null)
        assertEquals(2, disconnected)
    }

    @Test fun stalePredicateCannotMutateReplacementAndRetirementInvalidatesBackoffCallbacks() {
        val owner = NativeDmSocketAttemptOwner()
        val old = owner.begin()!!
        assertTrue(owner.isCurrent(old)) // Old callback passes its adapter predicate.
        val current = owner.begin()!!
        var connected = true
        assertFalse(owner.runIfCurrent(old) { connected = false })
        assertTrue(connected)
        assertTrue(owner.runIfCurrent(current) { connected = true })
        assertTrue(owner.retire(current) { connected = false })
        assertFalse(owner.runIfCurrent(current) { connected = true })
        assertFalse(connected)
        val afterBackoff = owner.begin()!!
        assertTrue(owner.isCurrent(afterBackoff))
        assertTrue(owner.stop { connected = false })
        assertFalse(owner.runIfCurrent(afterBackoff) { connected = true })
        assertNull(owner.begin())
        assertFalse(owner.active)
    }

    @Test fun callbackMutationAndReplacementAreSerializedAcrossThreads() {
        val owner = NativeDmSocketAttemptOwner()
        val old = owner.begin()!!
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val replacementStarted = CountDownLatch(1)
        val replacementFinished = CountDownLatch(1)
        val connected = AtomicReference(true)
        val oldCallback = thread {
            owner.runIfCurrent(old) {
                entered.countDown()
                check(release.await(2, TimeUnit.SECONDS))
                connected.set(false)
            }
        }
        assertTrue(entered.await(2, TimeUnit.SECONDS))
        val replacement = thread {
            replacementStarted.countDown()
            val current = owner.begin()!!
            owner.runIfCurrent(current) { connected.set(true) }
            replacementFinished.countDown()
        }
        try {
            assertTrue(replacementStarted.await(2, TimeUnit.SECONDS))
            assertFalse("Replacement must wait for the current callback mutation", replacementFinished.await(50, TimeUnit.MILLISECONDS))
        } finally { release.countDown() }
        assertTrue(replacementFinished.await(2, TimeUnit.SECONDS))
        oldCallback.join(2000)
        replacement.join(2000)
        assertFalse(oldCallback.isAlive)
        assertFalse(replacement.isAlive)
        assertTrue(connected.get())
    }

    private class CloseServer : Closeable {
        val acknowledged = CountDownLatch(1)
        val acknowledgedCode = AtomicInteger()
        val failure = AtomicReference<Throwable?>()
        private val server = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        @Volatile private var accepted: Socket? = null
        val url = "ws://127.0.0.1:${server.localPort}/synthetic-close"
        init {
            thread(isDaemon = true, name = "synthetic-close-server") {
                try {
                    server.accept().use { socket ->
                        accepted = socket
                        socket.soTimeout = 4000
                        val input = socket.getInputStream()
                        val output = socket.getOutputStream()
                        var key = ""
                        while (true) {
                            val line = readLine(input)
                            if (line.isEmpty()) break
                            if (line.startsWith("Sec-WebSocket-Key:", true)) key = line.substringAfter(':').trim()
                        }
                        check(key.isNotEmpty())
                        val digest = MessageDigest.getInstance("SHA-1").digest(
                            (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").toByteArray(Charsets.US_ASCII))
                        val accept = Base64.getEncoder().encodeToString(digest)
                        output.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n" +
                            "Connection: Upgrade\r\nSec-WebSocket-Accept: $accept\r\n\r\n").toByteArray(Charsets.US_ASCII))
                        output.flush()
                        Thread.sleep(25)
                        output.write(byteArrayOf(0x88.toByte(), 2, 3, 0xf0.toByte())) // close1008
                        output.flush()
                        val first = input.read()
                        val second = input.read()
                        check((first and 15) == 8 && second >= 0 && (second and 127) == 2)
                        val mask = input.readNBytes(if ((second and 128) != 0) 4 else 0)
                        val payload = input.readNBytes(2)
                        check(payload.size == 2)
                        if (mask.size == 4) for (index in payload.indices)
                            payload[index] = (payload[index].toInt() xor mask[index % 4].toInt()).toByte()
                        acknowledgedCode.set(((payload[0].toInt() and 255) shl 8) or (payload[1].toInt() and 255))
                        acknowledged.countDown()
                    }
                } catch (error: Throwable) { failure.set(error) }
            }
        }
        private fun readLine(input: InputStream): String {
            val bytes = ByteArrayOutputStream()
            while (true) {
                val value = input.read()
                check(value >= 0)
                if (value == 10) return bytes.toString(Charsets.US_ASCII.name())
                if (value != 13) bytes.write(value)
                check(bytes.size() <= 8192)
            }
        }
        override fun close() {
            runCatching { accepted?.close() }
            server.close()
        }
    }
}
