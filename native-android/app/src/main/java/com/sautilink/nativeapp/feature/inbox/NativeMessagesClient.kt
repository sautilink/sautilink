package com.sautilink.nativeapp.feature.inbox

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class NativeConversation(val id: String, val peerId: String, val handle: String, val name: String,
    val latestBody: String, val latestAt: String, val unread: Int, val muted: Boolean,
    val verified: Boolean, val badgeType: String, val hasAvatar: Boolean = false)
data class NativeMessage(val id: String, val senderId: String, val body: String,
    val sentAt: String, val deleted: Boolean, val kind: String = "text",
    val editedAt: String? = null, val replyTo: String? = null)
data class NativeThread(val conversation: NativeConversation, val messages: List<NativeMessage>)
data class NativeMessageAccount(val id: String, val handle: String, val name: String,
    val verified: Boolean, val badgeType: String)

/** RLS-protected DM reads. Only the signed-in participant can retrieve a thread. */
class NativeMessagesClient(private val auth: StagingAuthClient) {
    private val http = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build()
    private val uuid = Regex("^[0-9a-fA-F-]{36}$")
    private val jsonType = "application/json".toMediaType()

    private fun viewer(): String = auth.account?.id?.takeIf(uuid::matches)
        ?: throw AuthRequestException("Sign in to see messages.")

    private suspend fun rest(path: String, method: String = "GET", payload: JSONObject? = null): JSONArray {
        val token = auth.accessTokenForStagingRead()
        return withContext(Dispatchers.IO) {
            val builder = Request.Builder().url(auth.restOrigin + path)
                .header("apikey", auth.publicKeyForRead()).header("Authorization", "Bearer $token")
                .header("Accept", "application/json").header("Cache-Control", "no-store")
            if (method == "PATCH" || method == "POST" || method == "UPSERT") {
                builder.header("Prefer",
                    if (method == "UPSERT") "resolution=merge-duplicates,return=representation"
                    else "return=representation")
                val body = (payload ?: JSONObject()).toString().toRequestBody(jsonType)
                if (method == "PATCH") builder.patch(body) else builder.post(body)
            } else builder.get()
            try {
                http.newCall(builder.build()).execute().use { response ->
                    if (!response.isSuccessful) throw AuthRequestException(when (response.code) {
                        401, 403 -> "Messages access denied. Sign in again."
                        429 -> "Too many message requests. Try again shortly."
                        in 500..599 -> "Messages are temporarily unavailable."
                        else -> "Messages request failed (HTTP ${response.code})."
                    }, response.code)
                    val body = response.body?.string()?.take(400_000).orEmpty()
                    if (body.isBlank()) JSONArray() else JSONArray(body)
                }
            } catch (e: AuthRequestException) { throw e }
            catch (_: Exception) { throw AuthRequestException("Could not connect to messages.") }
        }
    }

    suspend fun inbox(): List<NativeConversation> {
        val own = viewer()
        val rows = rest("rpc/dm_inbox_phase23").objects()
        val muted = rest("social_mutes?muter_id=eq.$own&select=muted_id")
            .objects().map { it.optString("muted_id") }.toSet()
        val ids = rows.mapNotNull { it.optString("peer_id").takeIf(uuid::matches) }.distinct()
        val profiles = if (ids.isEmpty()) emptyMap() else rest(
            "social_profiles?id=in.(${ids.joinToString(",")})&select=id,username,display_name,is_verified,verification_badge_type,avatar_key"
        ).objects().associateBy { it.optString("id") }
        return rows.mapNotNull { row ->
            val id = row.optString("conversation_id")
            val peerId = row.optString("peer_id")
            if (!uuid.matches(id) || !uuid.matches(peerId)) return@mapNotNull null
            val peer = profiles[peerId]
            val handle = peer?.optString("username").orEmpty()
            NativeConversation(id, peerId, handle,
                peer?.optString("display_name")?.takeUnless { it.isBlank() || it == "null" }
                    ?: handle.ifBlank { "SautiLink member" },
                row.optString("latest_body").takeUnless { it == "null" }.orEmpty(),
                row.optString("latest_sent_at").takeUnless { it == "null" }
                    ?: row.optString("last_message_at"),
                if (peerId in muted) 0 else row.optInt("unread_count").coerceAtLeast(0),
                peerId in muted,
                peer?.optBoolean("is_verified", false) == true,
                peer?.optString("verification_badge_type", "standard") ?: "standard",
                peer?.optString("avatar_key")?.takeIf { it.isNotBlank() && it != "null" } != null)
        }
    }

    suspend fun searchAccounts(rawQuery: String): List<NativeMessageAccount> {
        val own = viewer()
        val query = rawQuery.trim().removePrefix("@").take(64).replace("%", "").replace("*", "").replace("_", "")
        if (query.length < 2) return emptyList()
        val filter = java.net.URLEncoder.encode("ilike.*$query*", "UTF-8")
        val select = "id,username,display_name,is_verified,verification_badge_type,avatar_key"
        val left = rest("social_profiles?select=$select&is_discoverable=eq.true&id=neq.$own&username=$filter&order=username.asc&limit=12")
        val right = rest("social_profiles?select=$select&is_discoverable=eq.true&id=neq.$own&display_name=$filter&order=username.asc&limit=12")
        return (left.objects() + right.objects()).distinctBy { it.optString("id") }.take(12).mapNotNull { row ->
            val id = row.optString("id")
            if (!uuid.matches(id)) null else {
                val handle = row.optString("username")
                NativeMessageAccount(id, handle,
                    row.optString("display_name").takeUnless { it.isBlank() || it == "null" } ?: handle,
                    row.optBoolean("is_verified"), row.optString("verification_badge_type", "standard"))
            }
        }
    }

    suspend fun thread(conversationId: String): NativeThread {
        val own = viewer()
        if (!uuid.matches(conversationId)) throw AuthRequestException("Invalid conversation.")
        val row = rest("dm_conversations?id=eq.$conversationId&select=id,member_one_id,member_two_id,last_message_at&limit=1")
            .optJSONObject(0) ?: throw AuthRequestException("Conversation is unavailable.")
        val first = row.optString("member_one_id")
        val second = row.optString("member_two_id")
        if (own != first && own != second) throw AuthRequestException("Conversation access denied.")
        val peerId = if (own == first) second else first
        val peer = rest("social_profiles?id=eq.$peerId&select=id,username,display_name,is_verified,verification_badge_type,avatar_key&limit=1").optJSONObject(0)
        val handle = peer?.optString("username").orEmpty()
        val messages = rest("dm_messages?conversation_id=eq.$conversationId&deleted_at=is.null&select=id,sender_id,body,sent_at,deleted_at,message_kind,edited_at,reply_to_message_id&order=sent_at.desc,id.desc&limit=200")
            .objects().asReversed().map { item ->
                NativeMessage(item.optString("id"), item.optString("sender_id"),
                    item.optString("body").takeUnless { it == "null" }.orEmpty(),
                    item.optString("sent_at"), !item.isNull("deleted_at"),
                    item.optString("message_kind", "text"),
                    item.optString("edited_at").takeIf { !item.isNull("edited_at") },
                    item.optString("reply_to_message_id").takeIf { !item.isNull("reply_to_message_id") })
            }
        val hidden = runCatching { hiddenForMe(conversationId) }.getOrDefault(emptySet())
        return NativeThread(NativeConversation(conversationId, peerId, handle,
            peer?.optString("display_name")?.takeUnless { it.isBlank() || it == "null" }
                ?: handle.ifBlank { "SautiLink member" },
            messages.lastOrNull()?.body.orEmpty(), row.optString("last_message_at"), 0, false,
            peer?.optBoolean("is_verified", false) == true,
            peer?.optString("verification_badge_type", "standard") ?: "standard",
            peer?.optString("avatar_key")?.takeIf { it.isNotBlank() && it != "null" } != null),
            messages.filterNot { it.id in hidden })
    }

    suspend fun markRead(conversationId: String) {
        val own = viewer()
        if (!uuid.matches(conversationId)) return
        // Read state is the viewer's own row; no other conversation is updated.
        rest("dm_conversation_states?conversation_id=eq.$conversationId&user_id=eq.$own",
            "PATCH", JSONObject().put("last_read_at", java.time.Instant.now().toString())
                .put("hidden_at", JSONObject.NULL))
    }

    suspend fun send(conversationId: String, rawBody: String, replyToId: String? = null): NativeMessage {
        val own = viewer()
        if (!uuid.matches(conversationId)) throw AuthRequestException("Invalid conversation.")
        val body = rawBody.trim()
        if (body.isEmpty() || body.length > 4000) throw AuthRequestException("Keep messages within 4,000 characters.")
        val row = rest("dm_messages?select=id,sender_id,body,sent_at,deleted_at,message_kind,reply_to_message_id", "POST",
            JSONObject().put("conversation_id", conversationId).put("sender_id", own)
                .put("body", body).apply {
                    if (replyToId != null && replyToId.matches(Regex("^[0-9]{1,20}$")))
                        put("reply_to_message_id", replyToId.toLong())
                })
            .optJSONObject(0) ?: throw AuthRequestException("Message delivery could not be confirmed.")
        return NativeMessage(row.optString("id"), row.optString("sender_id"), row.optString("body"),
            row.optString("sent_at"), false)
    }

    suspend fun editOwnMessage(messageId: String, text: String) {
        val own = viewer()
        require(messageId.matches(Regex("^[0-9]{1,20}$")))
        val safe = text.trim().take(4000)
        if (safe.isBlank()) throw AuthRequestException("A message cannot be empty.")
        val rows = rest("dm_messages?id=eq.$messageId&sender_id=eq.$own&deleted_at=is.null" +
            "&message_kind=eq.text&select=id", "PATCH", JSONObject().put("body", safe))
        if (rows.length() != 1) throw AuthRequestException("Editing this message is unavailable.")
    }

    /** For everyone: author-only tombstone, hidden from chat UI rather than displayed as a placeholder. */
    suspend fun deleteOwnForEveryone(messageId: String) {
        val own = viewer()
        require(messageId.matches(Regex("^[0-9]{1,20}$")))
        val rows = rest("dm_messages?id=eq.$messageId&sender_id=eq.$own&deleted_at=is.null" +
            "&select=id", "PATCH", JSONObject().put("deleted_at", java.time.Instant.now().toString()))
        if (rows.length() != 1) throw AuthRequestException("You can delete for everyone only messages you sent.")
    }

    /** Requires additive native phase38 migration and its own participant RLS. */
    suspend fun deleteForMe(message: NativeMessage, conversationId: String) {
        val own = viewer()
        if (!conversationId.matches(uuid) || !message.id.matches(Regex("^[0-9]{1,20}$")))
            throw AuthRequestException("Invalid message.")
        val rows = rest("dm_hidden_messages_native_phase38?select=message_id", "POST",
            JSONObject().put("user_id", own).put("message_id", message.id.toLong())
                .put("conversation_id", conversationId))
        if (rows.length() != 1) throw AuthRequestException("Could not hide the message.")
    }

    suspend fun hiddenForMe(conversationId: String): Set<String> {
        val own = viewer()
        if (!conversationId.matches(uuid)) return emptySet()
        return rest("dm_hidden_messages_native_phase38?user_id=eq.$own" +
            "&conversation_id=eq.$conversationId&select=message_id&limit=500")
            .objects().map { it.optString("message_id") }.toSet()
    }

    suspend fun editActivityVisibility(enabled: Boolean) {
        val own = viewer()
        // Column-scoped Supabase grants deliberately do NOT permit UPDATE on user_id.
        // PostgREST UPSERT tries to update user_id in conflict and is not suitable here.
        val exists = rest("social_member_preferences?user_id=eq.$own&select=user_id&limit=1")
            .length() > 0
        val payload = JSONObject().put("activity_status", enabled)
        val rows = if (exists) {
            rest("social_member_preferences?user_id=eq.$own&select=user_id,activity_status",
                "PATCH", payload)
        } else {
            // The table defines defaults for all other required preference columns.
            try {
                rest("social_member_preferences?select=user_id,activity_status",
                    "POST", payload.put("user_id", own))
            } catch (initial: AuthRequestException) {
                // A concurrently inserted preferences row may win: retry update safely.
                rest("social_member_preferences?user_id=eq.$own&select=user_id,activity_status",
                    "PATCH", JSONObject().put("activity_status", enabled))
            }
        }
        if (rows.length() != 1 || rows.optJSONObject(0)?.optBoolean("activity_status") != enabled)
            throw AuthRequestException("Could not save the online visibility setting.")
        touchActivity()
    }

    suspend fun touchActivity() {
        val token = auth.accessTokenForStagingRead()
        withContext(Dispatchers.IO) {
            val body = "{}".toRequestBody(jsonType)
            http.newCall(Request.Builder().url(auth.restOrigin + "rpc/touch_member_activity_phase37")
                .header("apikey", auth.publicKeyForRead())
                .header("Authorization", "Bearer $token").post(body).build()).execute().use { response ->
                if (!response.isSuccessful)
                    throw AuthRequestException("Unable to update your online status (HTTP ${response.code}).")
            }
        }
    }

    suspend fun clearMySentForEveryone(conversationId: String) {
        if (!conversationId.matches(uuid)) throw AuthRequestException("Invalid conversation.")
        val token = auth.accessTokenForStagingRead()
        withContext(Dispatchers.IO) {
            http.newCall(Request.Builder()
                .url(auth.restOrigin + "rpc/dm_clear_my_sent_for_everyone_native_phase38")
                .header("apikey", auth.publicKeyForRead())
                .header("Authorization", "Bearer $token")
                .post(JSONObject().put("p_conversation_id", conversationId).toString()
                    .toRequestBody(jsonType)).build()).execute().use {
                if (!it.isSuccessful) throw AuthRequestException(
                    "Clear for everyone is not yet available. Database migration may be pending.")
            }
        }
    }

    suspend fun clearForMe(conversationId: String) {
        if (!conversationId.matches(uuid)) throw AuthRequestException("Invalid conversation.")
        val token = auth.accessTokenForStagingRead()
        withContext(Dispatchers.IO) {
            http.newCall(Request.Builder()
                .url(auth.restOrigin + "rpc/dm_clear_chat_for_me_native_phase38")
                .header("apikey", auth.publicKeyForRead())
                .header("Authorization", "Bearer $token")
                .post(JSONObject().put("p_conversation_id", conversationId).toString()
                    .toRequestBody(jsonType)).build()).execute().use {
                if (!it.isSuccessful) throw AuthRequestException(
                    "Clear chat is not yet available. Database migration may be pending.")
            }
        }
    }

    suspend fun peerActivityBucket(peerId: String): String {
        if (!peerId.matches(uuid)) return "hidden"
        val token = auth.accessTokenForStagingRead()
        return withContext(Dispatchers.IO) {
            val response = http.newCall(Request.Builder()
                .url(auth.restOrigin + "rpc/dm_peer_activity_bucket_native_phase38")
                .header("apikey", auth.publicKeyForRead())
                .header("Authorization", "Bearer $token")
                .post(JSONObject().put("p_peer_id", peerId).toString().toRequestBody(jsonType))
                .build()).execute()
            response.use { if (!it.isSuccessful) "hidden" else
                it.body?.string().orEmpty().trim().trim('"').ifBlank { "hidden" } }
        }
    }

    suspend fun activityStatusEnabled(): Boolean {
        val own = viewer()
        return rest("social_member_preferences?user_id=eq.$own&select=activity_status&limit=1")
            .optJSONObject(0)?.optBoolean("activity_status", false) == true
    }

    suspend fun openConversation(peerId: String): String {
        val own = viewer()
        if (!uuid.matches(peerId) || peerId == own)
            throw AuthRequestException("Select another member.")
        val token = auth.accessTokenForStagingRead()
        return withContext(Dispatchers.IO) {
            val request = Request.Builder().url(auth.restOrigin + "rpc/open_dm_conversation_phase23")
                .header("apikey", auth.publicKeyForRead()).header("Authorization", "Bearer $token")
                .header("Accept", "application/json")
                .post(JSONObject().put("p_peer_id", peerId).toString().toRequestBody(jsonType)).build()
            try {
                http.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) throw AuthRequestException(
                        when (response.code) {
                            401, 403 -> "This member cannot be messaged with your current privacy settings."
                            429 -> "Please try again shortly."
                            else -> "Could not open the conversation (HTTP ${response.code})."
                        }, response.code)
                    val id = response.body?.string().orEmpty().trim().trim('"')
                    if (!uuid.matches(id)) throw AuthRequestException("Conversation could not be confirmed.")
                    id
                }
            } catch (e: AuthRequestException) { throw e }
            catch (_: Exception) { throw AuthRequestException("Could not connect to messages.") }
        }
    }
}

private fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull(::optJSONObject)
