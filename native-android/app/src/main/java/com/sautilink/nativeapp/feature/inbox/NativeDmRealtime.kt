package com.sautilink.nativeapp.feature.inbox

import android.os.Handler
import android.os.Looper
import android.util.Log
import com.sautilink.nativeapp.BuildConfig
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Supabase Realtime protocol 1.0: private durable DM signals and optional typing/presence. */
class NativeDmRealtime(
    private val auth: StagingAuthClient,
    private val conversationId: String?,
    private val peerId: String?,
    private val onChanged: () -> Unit,
    private val onPeerOnline: (Boolean) -> Unit,
    private val onPeerTyping: (Boolean) -> Unit,
) {
    private val http = OkHttpClient.Builder().pingInterval(30, TimeUnit.SECONDS).build()
    private val main = Handler(Looper.getMainLooper())
    private val ref = AtomicInteger(3)
    private var socket: WebSocket? = null
    private var heartbeat: Job? = null
    private var currentToken: String? = null
    private var closed = false
    private var joinedConversation = false
    private var activityEnabled = false
    private val ownId = auth.account?.id.orEmpty()
    private val userTopic = "realtime:dm-user:$ownId"
    private val conversationTopic = "realtime:dm:$conversationId"
    private val peerMetas = mutableSetOf<String>()

    suspend fun start(scope: CoroutineScope, allowActivity: Boolean) {
        if (ownId.isBlank() || closed) return
        activityEnabled = allowActivity && !conversationId.isNullOrBlank() && !peerId.isNullOrBlank()
        currentToken = auth.accessTokenForStagingRead()
        val url = auth.restOrigin.substringBefore("/rest/v1/")
            .replaceFirst("https://", "wss://") +
            "/realtime/v1/websocket?apikey=${auth.publicKeyForRead()}&vsn=1.0.0"
        socket = http.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                if (closed) { webSocket.close(1000, "Screen closed"); return }
                join(webSocket, userTopic, "1", false)
                if (activityEnabled) join(webSocket, conversationTopic, "2", true)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (closed) return
                val packet = runCatching { JSONObject(text) }.getOrNull() ?: return
                val topic = packet.optString("topic")
                when (packet.optString("event")) {
                    "phx_reply" -> {
                        val ok = packet.optJSONObject("payload")?.optString("status") == "ok"
                        if (BuildConfig.DEBUG && packet.optString("ref") in setOf("1", "2"))
                            Log.d("SautiDmRealtime", "join ${if (topic == userTopic) "inbox" else "thread"}: $ok")
                        if (topic == conversationTopic && packet.optString("ref") == "2" && ok) {
                            joinedConversation = true
                            push(conversationTopic, "presence", JSONObject()
                                .put("type", "presence").put("event", "track")
                                .put("payload", JSONObject().put("member_id", ownId)
                                    .put("online_at", java.time.Instant.now().toString())), "2")
                        }
                    }
                    "broadcast" -> {
                        val body = packet.optJSONObject("payload") ?: return
                        if (topic == userTopic && body.optString("event") in setOf(
                                "message_changed", "conversation_state_changed", "read_state_changed")) {
                            main.post { if (!closed) onChanged() }
                        } else if (topic == conversationTopic && body.optString("event") == "typing") {
                            val payload = body.optJSONObject("payload")
                            if (payload?.optString("member_id") == peerId) {
                                val typing = payload?.optBoolean("typing") == true
                                main.post { if (!closed) onPeerTyping(typing) }
                            }
                        }
                    }
                    "presence_state" -> if (topic == conversationTopic) {
                        peerMetas.clear()
                        addPeerMetas(packet.optJSONObject("payload"))
                        updateOnline()
                    }
                    "presence_diff" -> if (topic == conversationTopic) {
                        val changes = packet.optJSONObject("payload")
                        removePeerMetas(changes?.optJSONObject("leaves"))
                        addPeerMetas(changes?.optJSONObject("joins"))
                        updateOnline()
                    }
                    "phx_close", "phx_error" -> if (topic == conversationTopic) {
                        joinedConversation = false
                        peerMetas.clear(); updateOnline()
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (BuildConfig.DEBUG) Log.d("SautiDmRealtime", "socket unavailable: ${t.javaClass.simpleName}")
                joinedConversation = false
                main.post { if (!closed) { onPeerOnline(false); onPeerTyping(false) } }
            }
        })
        heartbeat = scope.launch {
            while (!closed) {
                delay(25_000)
                push("phoenix", "heartbeat", JSONObject(), null)
                val renewed = runCatching { auth.accessTokenForStagingRead() }.getOrNull()
                if (renewed != null && renewed != currentToken) {
                    currentToken = renewed
                    push(userTopic, "access_token", JSONObject().put("access_token", renewed), "1")
                    if (joinedConversation)
                        push(conversationTopic, "access_token", JSONObject().put("access_token", renewed), "2")
                }
            }
        }
    }

    fun typing(value: Boolean) {
        if (!joinedConversation || closed) return
        push(conversationTopic, "broadcast", JSONObject()
            .put("type", "broadcast").put("event", "typing")
            .put("payload", JSONObject().put("member_id", ownId).put("typing", value)), "2")
    }

    private fun join(webSocket: WebSocket, topic: String, joinRef: String, presence: Boolean) {
        val config = JSONObject().put("private", true)
            .put("broadcast", JSONObject().put("ack", false).put("self", false))
            .put("presence", JSONObject().put("enabled", presence).put("key", ownId))
        val payload = JSONObject().put("config", config).put("access_token", currentToken)
        webSocket.send(envelope(topic, "phx_join", payload, joinRef, joinRef).toString())
    }

    private fun push(topic: String, event: String, payload: JSONObject, joinRef: String?) {
        socket?.send(envelope(topic, event, payload, ref.getAndIncrement().toString(), joinRef).toString())
    }

    private fun envelope(topic: String, event: String, payload: JSONObject, ref: String,
                         joinRef: String?): JSONObject = JSONObject().put("topic", topic).put("event", event)
        .put("payload", payload).put("ref", ref).put("join_ref", joinRef ?: JSONObject.NULL)

    private fun addPeerMetas(state: JSONObject?) {
        if (state == null || peerId == null) return
        val peers = state.optJSONObject(peerId)?.optJSONArray("metas") ?: return
        for (index in 0 until peers.length()) {
            val meta = peers.optJSONObject(index) ?: continue
            if (meta.optString("member_id") == peerId)
                peerMetas.add(meta.optString("phx_ref").ifBlank { index.toString() })
        }
    }

    private fun removePeerMetas(state: JSONObject?) {
        if (state == null || peerId == null) return
        val peers = state.optJSONObject(peerId)?.optJSONArray("metas") ?: return
        for (index in 0 until peers.length()) peerMetas.remove(peers.optJSONObject(index)?.optString("phx_ref"))
    }

    private fun updateOnline() {
        val online = peerMetas.isNotEmpty()
        main.post { if (!closed) onPeerOnline(online) }
    }

    fun close() {
        if (closed) return
        typing(false)
        closed = true
        heartbeat?.cancel()
        socket?.close(1000, "Screen closed")
        socket = null
        joinedConversation = false
        peerMetas.clear()
    }
}
