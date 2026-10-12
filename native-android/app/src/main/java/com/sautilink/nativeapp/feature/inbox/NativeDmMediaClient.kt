package com.sautilink.nativeapp.feature.inbox

import android.content.Context
import android.net.Uri
import com.sautilink.nativeapp.feature.auth.AuthRequestException
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit

internal data class DmMedia(
    val id: String,
    val messageId: String,
    val kind: String,
    val mime: String,
    val name: String,
    val bytes: Long,
    val durationMs: Int
)

/** Uses the existing authenticated R2-backed Worker, not a public object URL. */
internal class NativeDmMediaClient(private val auth: StagingAuthClient) {
    private val http = OkHttpClient.Builder().callTimeout(40, TimeUnit.SECONDS).build()
    private val uuid = Regex("^[0-9a-fA-F-]{36}$")
    private val messageId = Regex("^[0-9]{1,20}$")
    companion object {
        const val MAX_BYTES = 5 * 1024 * 1024
        const val MAX_VOICE_MS = 60_000
    }

    private suspend fun sendRequest(
        path: String, method: String, token: String, bytes: ByteArray? = null,
        contentType: String = "application/json", headers: Map<String, String> = emptyMap()
    ): JSONObject = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(auth.backend.siteOrigin + path)
            .header("Authorization", "Bearer $token")
            .header("Cache-Control", "no-store")
        headers.forEach { (key, value) -> req.header(key, value) }
        val body = (bytes ?: ByteArray(0)).toRequestBody(contentType.toMediaType())
        when (method) {
            "GET" -> req.get()
            "DELETE" -> req.delete()
            else -> req.post(body)
        }
        try {
            http.newCall(req.build()).execute().use { response ->
                val raw = response.body?.string()?.take(80_000).orEmpty()
                val json = runCatching { JSONObject(raw) }.getOrNull() ?: JSONObject()
                if (!response.isSuccessful || json.optBoolean("ok") != true) {
                    val msg = json.optJSONObject("error")?.optString("message")
                    throw AuthRequestException(msg?.takeIf { it.isNotBlank() }
                        ?: "This attachment could not be processed (HTTP ${response.code}).")
                }
                json.optJSONObject("data") ?: JSONObject()
            }
        } catch (e: AuthRequestException) { throw e }
        catch (_: Exception) { throw AuthRequestException("Media upload failed. Check your connection.") }
    }

    suspend fun ready(): Boolean = runCatching {
        val token = auth.accessTokenForStagingRead()
        sendRequest("/api/dm-media/status", "GET", token).optBoolean("ready")
    }.getOrDefault(false)

    suspend fun attachments(messages: List<NativeMessage>): Map<String, DmMedia> {
        val ids = messages.map { it.id }.filter(messageId::matches).distinct().take(200)
        if (ids.isEmpty()) return emptyMap()
        val token = auth.accessTokenForStagingRead()
        val data = sendRequest("/api/dm-media/messages?ids=${ids.joinToString(",")}", "GET", token)
        val rows = data.optJSONArray("attachments") ?: return emptyMap()
        return (0 until rows.length()).mapNotNull {
            val row = rows.optJSONObject(it) ?: return@mapNotNull null
            val id = row.optString("id")
            if (!uuid.matches(id)) return@mapNotNull null
            DmMedia(id, row.optString("message_id"), row.optString("media_kind"),
                row.optString("content_type"), row.optString("original_name").takeUnless { it == "null" }.orEmpty(),
                row.optLong("size_bytes"), row.optInt("duration_ms"))
        }.associateBy { it.messageId }
    }

    suspend fun uploadAndSend(
        conversationId: String, kind: String, mime: String, filename: String,
        bytes: ByteArray, durationMs: Int = 0
    ) {
        if (!uuid.matches(conversationId)) throw AuthRequestException("Invalid conversation.")
        if (bytes.isEmpty() || bytes.size > MAX_BYTES)
            throw AuthRequestException("Files must be no larger than 5 MB.")
        if (kind == "voice" && (durationMs <= 0 || durationMs > MAX_VOICE_MS))
            throw AuthRequestException("Voice notes may be up to 1 minute.")
        if (kind !in setOf("photo", "file", "voice"))
            throw AuthRequestException("Unsupported attachment.")
        val token = auth.accessTokenForStagingRead()
        val pending = sendRequest("/api/dm-media/upload", "POST", token, bytes, mime,
            mapOf("X-Sauti-Conversation-ID" to conversationId,
                "X-Sauti-Media-Kind" to kind,
                "X-Sauti-File-Name" to java.net.URLEncoder.encode(filename.take(180), "UTF-8"),
                "X-Sauti-Size-Bytes" to bytes.size.toString(),
                "X-Sauti-Duration-Ms" to durationMs.toString()))
        val uploadId = pending.optString("id").takeIf(uuid::matches)
            ?: throw AuthRequestException("Attachment upload was not confirmed.")
        try {
            sendRequest("/api/dm-media/send/$uploadId", "POST", token,
                JSONObject().put("conversation_id", conversationId).put("body", "")
                    .toString().toByteArray(Charsets.UTF_8))
        } catch (e: Exception) {
            runCatching { sendRequest("/api/dm-media/$uploadId", "DELETE", token) }
            throw e
        }
    }

    suspend fun downloadMedia(id: String): ByteArray {
        if (!uuid.matches(id)) throw AuthRequestException("Invalid attachment.")
        val token = auth.accessTokenForStagingRead()
        return withContext(Dispatchers.IO) {
            http.newCall(Request.Builder().url(auth.backend.siteOrigin + "/api/dm-media/$id")
                .header("Authorization", "Bearer $token")
                .header("Cache-Control", "no-store").get().build()).execute().use {
                if (!it.isSuccessful) throw AuthRequestException("This file is unavailable.")
                val body = it.body ?: throw AuthRequestException("Empty attachment.")
                body.byteStream().use { input ->
                    val output = ByteArrayOutputStream()
                    val buffer = ByteArray(32 * 1024)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        if (output.size() + count > MAX_BYTES)
                            throw AuthRequestException("Attachment exceeds the 5 MB limit.")
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                }
            }
        }
    }

    suspend fun readDocument(context: Context, uri: Uri): ByteArray = withContext(Dispatchers.IO) {
        val info = context.contentResolver.openAssetFileDescriptor(uri, "r")
        val length = info?.length ?: -1L
        info?.close()
        if (length > MAX_BYTES) throw AuthRequestException("Maximum file size: 5 MB.")
        val input = context.contentResolver.openInputStream(uri)
            ?: throw AuthRequestException("Could not read selected file.")
        input.use {
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(32 * 1024)
            while (true) {
                val count = it.read(buffer)
                if (count < 0) break
                if (output.size() + count > MAX_BYTES)
                    throw AuthRequestException("Maximum file size: 5 MB.")
                output.write(buffer, 0, count)
            }
            output.toByteArray()
        }
    }
}
