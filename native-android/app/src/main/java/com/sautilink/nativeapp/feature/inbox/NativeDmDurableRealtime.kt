package com.sautilink.nativeapp.feature.inbox

import android.os.Handler
import android.os.Looper
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * SautiLink Web's active chat transport: Cloudflare DM_REALTIME_HUB.
 * The web client uses subprotocols "sautilink-dm-v1" and "sautilink-auth.<JWT>".
 * This class intentionally sends no activity events if privacy is disabled.
 */
internal class NativeDmDurableRealtime(
    private val auth: StagingAuthClient,
    private val conversationId: String,
    private val onOnline: (Boolean) -> Unit,
    private val onTyping: (Boolean) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private val http = OkHttpClient.Builder().pingInterval(25, TimeUnit.SECONDS).build()
    private val connectionOwner = NativeDmSocketAttemptOwner()
    @Volatile private var socket: WebSocket? = null
    @Volatile private var connected = false
    private var peerTyping = false
    private var peerOnline = false
    private val conversationPattern = Regex("^[0-9a-fA-F-]{36}$")

    suspend fun start(scope: CoroutineScope) {
        if (!conversationPattern.matches(conversationId)) return
        var attempt = 0
        while (connectionOwner.active && scope.isActive) {
            val token = try { auth.accessTokenForStagingRead() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { null }
            if (token.isNullOrBlank()) { delay(5_000); continue }
            val url = auth.backend.siteOrigin
                .replaceFirst("https://", "wss://")
                .replaceFirst("http://", "ws://")
                .trimEnd('/') + "/api/dm-realtime/$conversationId"
            val generation = connectionOwner.begin() ?: break
            fun isCurrent() = connectionOwner.isCurrent(generation)
            val ws = http.newWebSocket(
                Request.Builder().url(url)
                    .header("Sec-WebSocket-Protocol",
                        "sautilink-dm-v1, sautilink-auth.$token")
                    .build(),
                NativeDmSocketListener(
                    isCurrent = ::isCurrent,
                    onConnected = { webSocket ->
                        val accepted = connectionOwner.runIfCurrent(generation) {
                            connected = true
                            attempt = 0
                        }
                        if (accepted) webSocket.send(JSONObject().put("type", "ping").toString())
                    },
                    onText = { text ->
                        val json = runCatching { JSONObject(text) }.getOrNull()
                        if (json != null) when (json.optString("type")) {
                            "presence" -> {
                                val online = json.optBoolean("peer_online", false)
                                connectionOwner.runIfCurrent(generation) {
                                    peerOnline = online
                                    main.post { if (isCurrent()) onOnline(online) }
                                }
                            }
                            "typing" -> {
                                val typing = json.optBoolean("typing", false)
                                connectionOwner.runIfCurrent(generation) {
                                    peerTyping = typing
                                    main.post { if (isCurrent()) onTyping(typing) }
                                }
                            }
                        }
                    },
                    onDisconnected = {
                        connectionOwner.runIfCurrent(generation) {
                            connected = false
                            peerOnline = false
                            peerTyping = false
                            main.post { if (isCurrent()) {
                                onOnline(false)
                                onTyping(false)
                            } }
                        }
                    }
                )
            )
            if (!connectionOwner.runIfCurrent(generation) { socket = ws }) ws.close(1000, "Closed")
            // Durable Object WS will reconnect after transient network loss.
            // A new socket replaces the previous one; never keep two active.
            delay(8_000)
            while (connectionOwner.active && scope.isActive && connected) delay(1_000)
            connectionOwner.retire(generation) { socket = null; connected = false }
            ws.close(1000, "Reconnect")
            if (!connectionOwner.active) break
            delay((700L shl attempt.coerceAtMost(4)).coerceAtMost(15_000L))
            attempt = (attempt + 1).coerceAtMost(5)
        }
    }

    fun typing(value: Boolean) {
        if (!connectionOwner.active || !connected) return
        if (value != peerTyping) {
            // Peer status comes from server: don't reuse peerTyping as local state.
        }
        socket?.send(JSONObject().put("type", "typing").put("typing", value).toString())
    }

    fun close() {
        var retired: WebSocket? = null
        if (!connectionOwner.stop { retired = socket; socket = null; connected = false }) return
        retired?.send(JSONObject().put("type", "typing").put("typing", false).toString())
        retired?.close(1000, "Conversation closed")
    }
}
