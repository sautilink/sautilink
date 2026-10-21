package com.sautilink.nativeapp.feature.inbox

import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/** One connection attempt owns callbacks, including callbacks delivered after a reconnect.
 * Keep this adapter independent of Android/Auth so real OkHttp close handshakes are tested
 * without restoring an account, reading private data or contacting the production service.
 */
internal class NativeDmSocketListener(
    private val isCurrent: () -> Boolean,
    private val onConnected: (WebSocket) -> Unit,
    private val onText: (String) -> Unit,
    private val onDisconnected: () -> Unit
) : WebSocketListener() {
    override fun onOpen(webSocket: WebSocket, response: Response) {
        if (!isCurrent()) {
            webSocket.close(1000, "Closed")
            return
        }
        onConnected(webSocket)
    }

    override fun onMessage(webSocket: WebSocket, text: String) {
        if (isCurrent()) onText(text)
    }

    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
        if (isCurrent()) onDisconnected()
        // OkHttp waits for our acknowledgement before invoking onClosed. Never
        // echo/log a peer reason, request, credential or exception message.
        runCatching { webSocket.close(code, null) }.onFailure { webSocket.cancel() }
    }

    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        if (isCurrent()) onDisconnected()
    }

    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        if (isCurrent()) onDisconnected()
    }
}

/** Serialize ownership changes with state writes on OkHttp callback threads.
 * A predicate checked before a callback is insufficient: reconnect can happen
 * between that check and the callback's state mutation.
 */
internal class NativeDmSocketAttemptOwner {
    private val lock = Any()
    private var generation = 0L
    private var running = true
    val active: Boolean get() = synchronized(lock) { running }

    fun begin(): Long? = synchronized(lock) {
        if (!running) null else ++generation
    }

    fun isCurrent(expected: Long): Boolean = synchronized(lock) {
        running && generation == expected
    }

    fun runIfCurrent(expected: Long, update: () -> Unit): Boolean = synchronized(lock) {
        if (!running || generation != expected) false else {
            update()
            true
        }
    }

    fun retire(expected: Long, update: () -> Unit): Boolean = synchronized(lock) {
        if (!running || generation != expected) false else {
            generation++
            update()
            true
        }
    }

    fun stop(update: () -> Unit): Boolean = synchronized(lock) {
        if (!running) false else {
            running = false
            generation++
            update()
            true
        }
    }
}
