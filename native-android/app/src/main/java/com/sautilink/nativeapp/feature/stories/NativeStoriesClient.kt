package com.sautilink.nativeapp.feature.stories

import android.content.Context
import android.net.Uri
import com.sautilink.nativeapp.feature.auth.AuthRequestException
import com.sautilink.nativeapp.feature.auth.SautiBackend
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.posts.localVideoDuration
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.BufferedSink
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.time.Instant
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Account-scoped, no-store API client. Neither API bearer tokens nor provider upload URLs are persisted. */
internal class NativeStoriesClient(private val auth: StagingAuthClient) {
    private val api = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(45, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).cache(null).build()
    private val upload = api.newBuilder().callTimeout(180, TimeUnit.SECONDS).readTimeout(180, TimeUnit.SECONDS).build()
    private val lock = Mutex()
    private data class Pending(val owner: String, val key: String, val source: String, val kind: String,
        val id: String, val url: String, val method: String, var uploaded: Boolean = false,
        var attempted: Boolean = false, var transferEndedMillis: Long = 0L)
    private var pending: Pending? = null

    private fun owner(): String = auth.account?.id?.takeIf(NativeStoryPolicy.uuid::matches)
        ?.takeIf { auth.backend == SautiBackend.PRODUCTION }
        ?: throw AuthRequestException("Sign in to use Stories.")
    private fun checkOwner(expected: String) {
        if (auth.account?.id != expected) { pending = null; throw AuthRequestException("Your account changed. Open Stories again.") }
    }
    private fun validId(id: String): String = id.takeIf(NativeStoryPolicy.uuid::matches)
        ?: throw AuthRequestException("This story is unavailable.")
    private suspend fun Call.awaitResponse(): Response = suspendCancellableCoroutine { continuation ->
        continuation.invokeOnCancellation { cancel() }
        enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { if (continuation.isActive) continuation.resumeWith(Result.failure(e)) }
            override fun onResponse(call: Call, response: Response) {
                if (continuation.isActive) continuation.resume(response) { _, value, _ -> value.close() } else response.close()
            }
        })
    }
    private fun Response.boundedText(maximum: Int = 512_000): String {
        val body = body ?: return ""
        if (body.contentLength() > maximum) throw AuthRequestException("Stories returned an oversized response.")
        val out = ByteArrayOutputStream()
        body.byteStream().use { input ->
            val bytes = ByteArray(8_192)
            while (true) {
                val count = input.read(bytes)
                if (count < 0) break
                if (out.size() + count > maximum) throw AuthRequestException("Stories returned an oversized response.")
                out.write(bytes, 0, count)
            }
        }
        return out.toString(Charsets.UTF_8.name())
    }
    private suspend fun request(path: String, method: String = "GET", payload: JSONObject? = null): JSONObject {
        val expected = owner()
        val token = auth.accessTokenForStagingRead()
        checkOwner(expected)
        val body = (payload ?: JSONObject()).toString().toRequestBody("application/json".toMediaType())
        val request = Request.Builder().url(auth.mediaOrigin + path).header("Authorization", "Bearer $token")
            .header("Accept", "application/json").header("Cache-Control", "no-store")
            .apply { when (method) { "POST" -> post(body); "PATCH" -> patch(body); "PUT" -> put(body); "DELETE" -> delete(); else -> get() } }.build()
        try {
            return withContext(Dispatchers.IO) {
                api.newCall(request).awaitResponse().use { response ->
                    val text = response.boundedText()
                    checkOwner(expected)
                    val json = runCatching { JSONObject(text) }.getOrElse { JSONObject() }
                    if (!response.isSuccessful || !json.optBoolean("ok")) {
                        val message = json.optJSONObject("error")?.optString("message")?.takeIf { it.length in 1..220 }
                        throw AuthRequestException(message ?: when (response.code) {
                            401, 403 -> "You do not have access to this story. Sign in again if needed."
                            404, 410 -> "This story has expired or was deleted."
                            429 -> "Please wait before requesting Stories again."
                            else -> "Stories could not be reached. Try again."
                        }, response.code)
                    }
                    json.optJSONObject("data") ?: throw AuthRequestException("Stories returned an incomplete response.")
                }
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: AuthRequestException) { throw failure }
        catch (failure: IOException) { throw AuthRequestException("Connection interrupted. Check your network and try again.", cause = failure) }
    }

    suspend fun feed(): NativeStoriesFeed = decodeFeed(request("/api/stories"))
    suspend fun profile(username: String): NativeStoryGroup? {
        if (!NativeStoryPolicy.handle.matches(username)) return null
        return decodeFeed(request("/api/stories/profile/$username")).activeGroups().firstOrNull { it.author.username == username }
    }
    suspend fun story(id: String): NativeStoryGroup {
        val data = request("/api/stories/${validId(id)}")
        val story = decodeStory(data.optJSONObject("story") ?: throw AuthRequestException("This story is unavailable."))
            ?: throw AuthRequestException("This story is unavailable.")
        val author = decodeAuthor(data.optJSONObject("author") ?: throw AuthRequestException("Story author is unavailable."))
            ?: throw AuthRequestException("Story author is unavailable.")
        if (story.ownerId != author.id) throw AuthRequestException("Story identity could not be confirmed.")
        return NativeStoryGroup(author, listOf(story))
    }
    suspend fun markViewed(id: String) { request("/api/stories/${validId(id)}/view", "POST") }
    suspend fun react(id: String, reaction: String?): String? {
        require(reaction == null || reaction in setOf("love", "dislike"))
        val data = request("/api/stories/${validId(id)}/reaction", "PUT", JSONObject().put("reaction", reaction ?: JSONObject.NULL))
        return data.optString("reaction").takeIf { it in setOf("love", "dislike") }
    }
    suspend fun edit(id: String, caption: String) {
        require(caption.length <= NativeStoryPolicy.MAX_CAPTION)
        request("/api/stories/${validId(id)}", "PATCH", JSONObject().put("caption", caption.trim()))
    }
    suspend fun delete(id: String) { request("/api/stories/${validId(id)}", "DELETE") }
    suspend fun viewers(id: String, cursor: String? = null): NativeStoryViewers {
        val url = (auth.mediaOrigin + "/api/stories/${validId(id)}/viewers").toHttpUrl().newBuilder()
            .apply { if (cursor != null) addQueryParameter("cursor", cursor.take(500)) }.build()
        val path = url.encodedPath + if (url.encodedQuery == null) "" else "?${url.encodedQuery}"
        val data = request(path)
        val rows = data.optJSONArray("viewers") ?: JSONArray()
        val result = (0 until minOf(rows.length(), 100)).mapNotNull { index ->
            val row = rows.optJSONObject(index) ?: return@mapNotNull null
            val author = decodeAuthor(row.optJSONObject("author") ?: row) ?: return@mapNotNull null
            NativeStoryViewer(author, row.optString("viewed_at"))
        }
        return NativeStoryViewers(result, data.optInt("total").coerceAtLeast(0), data.optString("next_cursor").takeIf { it.isNotBlank() && it != "null" && it.length <= 500 })
    }

    suspend fun publish(context: Context, uri: Uri, kind: String, caption: String, key: String,
        onProgress: (Int) -> Unit) = lock.withLock {
        val expected = owner()
        require(NativeStoryPolicy.uuid.matches(key) && kind in setOf("image", "video") && caption.length <= NativeStoryPolicy.MAX_CAPTION)
        val mime = localMime(context, uri)
        require(if (kind == "video") mime == "video/mp4" else mime in setOf("image/jpeg", "image/png", "image/webp")) { "Choose a supported photo or MP4 video." }
        if (kind == "video") require(localVideoDuration(context, uri) <= NativeStoryPolicy.MAX_VIDEO_MS) { "Trim this story to 30 seconds or less." }
        val file = File(context.cacheDir, "sauti-story-upload-${UUID.randomUUID()}.${if (kind == "video") "mp4" else "image"}")
        try {
            withContext(Dispatchers.IO) {
                val maximum = if (kind == "video") 100_000_000L else 8L * 1024 * 1024
                context.contentResolver.openInputStream(uri)?.use { input -> file.outputStream().use { output ->
                    val bytes = ByteArray(64 * 1024); var total = 0L
                    while (true) {
                        currentCoroutineContext().ensureActive(); checkOwner(expected)
                        val count = input.read(bytes); if (count < 0) break
                        total += count
                        if (total > maximum) throw AuthRequestException("This story file is too large. Choose a smaller file.")
                        output.write(bytes, 0, count)
                    }
                } } ?: throw AuthRequestException("The selected media could not be opened.")
                require(file.length() > 0) { "The selected media is empty." }
            }
            checkOwner(expected)
            var receipt = pending?.takeIf { it.owner == expected && it.key == key && it.source == uri.toString() && it.kind == kind }
            if (receipt == null) {
                val data = request("/api/stories/uploads", "POST", JSONObject().put("media_kind", kind).put("content_type", mime)
                    .put("size_bytes", file.length()).put("idempotency_key", key))
                val id = validId(data.optString("upload_id"))
                val destination = data.optString("upload_url")
                val method = data.optString("upload_method")
                if (!storyUploadDestinationAllowed(auth.mediaOrigin, destination, kind, id, method))
                    throw AuthRequestException("Story upload destination could not be verified.")
                receipt = Pending(expected, key, uri.toString(), kind, id, destination, method)
                pending = receipt
            }
            if (!receipt.uploaded) {
                if (receipt.attempted) {
                    // A timed-out provider POST may already have succeeded. Ask our server;
                    // never repeat a one-time Cloudflare transfer on a network guess.
                    // A cancelled connection may still be settling at the provider.
                    // Only a fresh pendingupload confirmation after this grace period
                    // can permit another transfer of this same immutable media.
                    val settleFor = 15_000L - (System.nanoTime() / 1_000_000L - receipt.transferEndedMillis)
                    if (kind == "video" && settleFor > 0) delay(settleFor)
                    var checks = 0
                    while (true) {
                        val status = request("/api/stories/uploads/${receipt.id}")
                        when (storyUploadRecovery(status, kind,
                            NativeStoryPolicy.active(status.optString("expires_at"), System.currentTimeMillis()))) {
                            StoryUploadRecovery.COMPLETE -> { receipt.uploaded = true; onProgress(100); break }
                            StoryUploadRecovery.RETRY_TRANSFER -> break
                            StoryUploadRecovery.FAILED -> throw AuthRequestException("This upload expired or failed. Replace the media to start a new upload.")
                            StoryUploadRecovery.WAIT -> Unit
                        }
                        if (++checks >= 20) throw AuthRequestException("Upload confirmation is still pending. Tap Share again shortly to check this upload.")
                        delay(3_000)
                    }
                }
            }
            if (!receipt.uploaded) {
                val source = StoryUploadBody(file, mime, onProgress)
                val builder = Request.Builder().url(receipt.url)
                if (kind == "image") {
                    val token = auth.accessTokenForStagingRead(); checkOwner(expected)
                    builder.header("Authorization", "Bearer $token").put(source)
                } else builder.post(MultipartBody.Builder().setType(MultipartBody.FORM).addFormDataPart("file", "story.mp4", source).build())
                checkOwner(expected)
                receipt.attempted = true
                try {
                    withContext(Dispatchers.IO) { upload.newCall(builder.build()).awaitResponse().use { response ->
                        if (!response.isSuccessful) throw AuthRequestException("Story upload did not finish. Try again.", response.code)
                    } }
                } finally { receipt.transferEndedMillis = System.nanoTime() / 1_000_000L }
                checkOwner(expected); receipt.uploaded = true
            }
            onProgress(100)
            var attempts = 0
            while (true) {
                checkOwner(expected); currentCoroutineContext().ensureActive()
                val data = request("/api/stories", "POST", JSONObject().put("upload_id", receipt.id).put("caption", caption.trim()))
                if (!data.optBoolean("processing")) {
                    val confirmed = data.optJSONObject("story")?.optString("id").orEmpty()
                    if (!NativeStoryPolicy.uuid.matches(confirmed)) throw AuthRequestException("Story publishing could not be confirmed.")
                    pending = null; break
                }
                if (++attempts >= 40) throw AuthRequestException("Your video is still being prepared. Tap Share again shortly; it will reuse this upload.")
                delay(data.optLong("retry_after", 3).coerceIn(2, 10) * 1_000)
            }
        } finally { file.delete() }
    }

    private fun localMime(context: Context, uri: Uri): String {
        context.contentResolver.getType(uri)?.lowercase()?.let { return it }
        if (uri.scheme != "file") return ""
        val file = File(uri.path ?: return "").canonicalFile
        if (file.parentFile != context.cacheDir.canonicalFile || !file.name.startsWith("sauti-edit-")) return ""
        return when (file.extension.lowercase()) { "jpg", "jpeg" -> "image/jpeg"; "png" -> "image/png"; "mp4" -> "video/mp4"; else -> "" }
    }

    private fun decodeFeed(data: JSONObject): NativeStoriesFeed {
        val groups = data.optJSONArray("groups") ?: JSONArray()
        val decoded = (0 until minOf(groups.length(), 200)).mapNotNull { index ->
            val group = groups.optJSONObject(index) ?: return@mapNotNull null
            val author = decodeAuthor(group.optJSONObject("author") ?: return@mapNotNull null) ?: return@mapNotNull null
            val stories = group.optJSONArray("stories") ?: JSONArray()
            val items = (0 until minOf(stories.length(), 100)).mapNotNull { decodeStory(stories.optJSONObject(it) ?: return@mapNotNull null) }.filter { it.ownerId == author.id }
            if (items.isEmpty()) null else NativeStoryGroup(author, items)
        }
        val quota = data.optJSONObject("quota") ?: JSONObject()
        val server = runCatching { Instant.parse(data.optString("server_now")).toEpochMilli() }.getOrNull()
        return NativeStoriesFeed(decoded, NativeStoryQuota(quota.optInt("images_used").coerceAtLeast(0), quota.optInt("videos_used").coerceAtLeast(0), quota.optString("resets_at")),
            server?.minus(System.currentTimeMillis()) ?: 0)
    }
    private fun decodeAuthor(row: JSONObject): NativeStoryAuthor? {
        val id = row.optString("id"); val handle = row.optString("username")
        if (!NativeStoryPolicy.uuid.matches(id) || !NativeStoryPolicy.handle.matches(handle)) return null
        return NativeStoryAuthor(id, handle, row.optString("display_name").takeIf { it.isNotBlank() && it != "null" }?.take(100) ?: handle,
            row.optBoolean("is_verified"), row.optString("verification_badge_type", "standard"), row.optBoolean("has_avatar"))
    }
    private fun decodeStory(row: JSONObject): NativeStory? {
        val id = row.optString("id"); val owner = row.optString("owner_id"); val kind = row.optString("media_kind")
        if (!NativeStoryPolicy.uuid.matches(id) || !NativeStoryPolicy.uuid.matches(owner) || kind !in setOf("image", "video")) return null
        fun path(key: String, fallback: String): String = row.optString(key).takeIf {
            it.startsWith("/api/stories/$id/") && !it.contains("..") && !it.contains('\\') && !it.contains("//") && !it.contains('#')
        } ?: fallback
        return NativeStory(id, owner, kind, row.optString("caption").take(NativeStoryPolicy.MAX_CAPTION), row.optString("created_at"), row.optString("expires_at"),
            row.optLong("duration_ms").coerceIn(0, NativeStoryPolicy.MAX_VIDEO_MS), path("media_path", "/api/stories/$id/media"),
            path("thumbnail_path", ""), path("playback_path", "/api/stories/$id/playback"), row.optBoolean("is_seen"),
            row.optInt("viewer_count").coerceAtLeast(0), row.optString("reaction").takeIf { it in setOf("love", "dislike") })
    }
}

internal enum class StoryUploadRecovery { COMPLETE, RETRY_TRANSFER, WAIT, FAILED }

/** Direct video URLs may be reused only after the server freshly confirms that
 * Cloudflare is still waiting for bytes; a local processing receipt proves nothing.
 */
internal fun storyUploadRecovery(status: JSONObject, kind: String, active: Boolean): StoryUploadRecovery = when {
    status.optBoolean("failed") || !active -> StoryUploadRecovery.FAILED
    status.optBoolean("ready") || status.optBoolean("uploaded") -> StoryUploadRecovery.COMPLETE
    kind == "image" -> StoryUploadRecovery.RETRY_TRANSFER // Immutable first-party PUT is idempotent.
    status.optBoolean("awaiting_upload") && status.optBoolean("retry_upload") -> StoryUploadRecovery.RETRY_TRANSFER
    else -> StoryUploadRecovery.WAIT
}

internal fun storyUploadDestinationAllowed(origin: String, destination: String, kind: String, id: String, method: String): Boolean =
    runCatching {
        val target = destination.toHttpUrl()
        val firstParty = origin.toHttpUrl()
        target.isHttps && target.username.isEmpty() && target.password.isEmpty() && target.fragment == null && target.port == 443 &&
            when (kind) {
                "image" -> method == "PUT" && target.host == firstParty.host && target.encodedPath == "/api/stories/uploads/$id"
                // Stream currently returns upload.cloudflarestream.com; existing
                // one-time URLs can use upload.videodelivery.net. Both are exact
                // HTTPS origins with one opaque 32-character ID and no URL extras.
                "video" -> method == "POST" && target.host in setOf("upload.videodelivery.net", "upload.cloudflarestream.com") &&
                    target.encodedPath.matches(Regex("^/[a-zA-Z0-9_-]{32}$")) && target.encodedQuery == null &&
                    destination == "https://${target.host}${target.encodedPath}"
                else -> false
            }
    }.getOrDefault(false)

private class StoryUploadBody(private val file: File, type: String, private val progress: (Int) -> Unit) : RequestBody() {
    private val mediaType = type.toMediaType()
    override fun contentType() = mediaType
    override fun contentLength() = file.length()
    override fun isOneShot() = true
    override fun writeTo(sink: BufferedSink) {
        file.inputStream().use { input ->
            val bytes = ByteArray(64 * 1024); var sent = 0L; var previous = -1
            while (true) {
                val count = input.read(bytes); if (count < 0) break
                sink.write(bytes, 0, count); sent += count
                val value = ((sent * 100L) / file.length().coerceAtLeast(1)).toInt().coerceIn(0, 100)
                if (value >= previous + 2 || value == 100) { previous = value; progress(value) }
            }
        }
    }
}
