package com.sautilink.nativeapp.feature.posts

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.sautilink.nativeapp.BuildConfig
import com.sautilink.nativeapp.feature.auth.AuthRequestException
import com.sautilink.nativeapp.feature.auth.SautiBackend
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit

data class NativeReadyMedia(val id: String, val kind: String, val altText: String = "")
private data class PreparedMedia(val file: File, val type: String, val kind: String)

/** Android picker media -> bounded local file -> SautiLink begin/upload/finalize protocol. */
class NativeMediaClient(private val auth: StagingAuthClient, private val context: Context) {
    private val http = OkHttpClient.Builder().callTimeout(180, TimeUnit.SECONDS).build()
    private val uploads = Mutex()
    private val main = Handler(Looper.getMainLooper())
    private val uuid = Regex("^[0-9a-fA-F-]{36}$")

    private fun request(path: String, method: String, token: String, body: RequestBody? = null): JSONObject {
        val builder = Request.Builder().url("${auth.backend.siteOrigin}$path")
            .header("Authorization", "Bearer $token")
            .header("Accept", "application/json")
            .header("Cache-Control", "no-store")
        when (method) {
            "POST" -> builder.post(body ?: "{}".toRequestBody("application/json".toMediaType()))
            "PUT" -> builder.put(body ?: throw AuthRequestException("Missing media."))
            "DELETE" -> builder.delete()
            else -> builder.get()
        }
        try {
            http.newCall(builder.build()).execute().use { response ->
                val json = runCatching { JSONObject(response.body?.string()?.take(16_384).orEmpty()) }.getOrElse { JSONObject() }
                if (!response.isSuccessful || !json.optBoolean("ok")) {
                    val message = json.optJSONObject("error")?.optString("message")?.takeIf { it.length in 1..220 }
                    throw AuthRequestException(message ?: "Media request failed (HTTP ${response.code}).", response.code)
                }
                return json.optJSONObject("data") ?: throw AuthRequestException("Media response was incomplete.")
            }
        } catch (e: AuthRequestException) { throw e }
        catch (e: Exception) {
            if (BuildConfig.DEBUG) Log.e("SautiNativeMedia", "Media request failed: $method $path", e)
            throw AuthRequestException("Could not connect to the media service.")
        }
    }

    private fun tempFile(extension: String): File = File(context.cacheDir, "sauti-media-${UUID.randomUUID()}.$extension")

    private fun prepareImage(uri: Uri): PreparedMedia {
        val resolver = context.contentResolver
        val bitmap = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            decodeModernImage(uri)
        } else {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
            if (bounds.outWidth < 1 || bounds.outHeight < 1)
                throw AuthRequestException("Invalid image dimensions.")
            var sample = 1
            while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 2048) sample *= 2
            resolver.openInputStream(uri)?.use {
                BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
            } ?: throw AuthRequestException("Could not open image.")
        }
        try {
            val alpha = bitmap.hasAlpha()
            val output = tempFile(if (alpha) "png" else "jpg")
            output.outputStream().use { stream ->
                if (!bitmap.compress(if (alpha) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG,
                        if (alpha) 100 else 84, stream)) throw AuthRequestException("Image compression failed.")
            }
            if (output.length() !in 1..(8L * 1024 * 1024)) {
                output.delete()
                throw AuthRequestException("The compressed image is still above 8 MB. Choose a smaller image.")
            }
            return PreparedMedia(output, if (alpha) "image/png" else "image/jpeg", "image")
        } finally { bitmap.recycle() }
    }

    @androidx.annotation.RequiresApi(Build.VERSION_CODES.P)
    private fun decodeModernImage(uri: Uri): Bitmap {
        val source = ImageDecoder.createSource(context.contentResolver, uri)
        return ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
            val width = info.size.width
            val height = info.size.height
            if (width < 1 || height < 1) throw AuthRequestException("Invalid image dimensions.")
            val scale = minOf(1.0, 2048.0 / maxOf(width, height))
            decoder.setTargetSize(maxOf(1, (width * scale).toInt()), maxOf(1, (height * scale).toInt()))
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
    }

    private fun prepareVideo(uri: Uri): PreparedMedia {
        val resolver = context.contentResolver
        if (resolver.getType(uri)?.lowercase() != "video/mp4")
            throw AuthRequestException("Choose an MP4 video.")
        val retriever = MediaMetadataRetriever()
        try {
            retriever.setDataSource(context, uri)
            val duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
                ?: throw AuthRequestException("Could not read video duration.")
            if (duration > 60_000L) throw AuthRequestException("Short videos must be 60 seconds or less.")
        } finally { retriever.release() }
        val output = tempFile("mp4")
        try {
            resolver.openInputStream(uri)?.use { input ->
                output.outputStream().use { out ->
                    val buffer = ByteArray(64 * 1024)
                    var total = 0L
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        total += read
                        if (total > 100_000_000L) throw AuthRequestException("Videos must be 100 MB or smaller.")
                        out.write(buffer, 0, read)
                    }
                }
            } ?: throw AuthRequestException("Could not open video.")
            if (output.length() < 1) throw AuthRequestException("Video is empty.")
            return PreparedMedia(output, "video/mp4", "video")
        } catch (e: Exception) { output.delete(); throw e }
    }

    private fun prepare(uri: Uri): PreparedMedia {
        val type = context.contentResolver.getType(uri)?.lowercase().orEmpty()
        return when {
            type.startsWith("image/") -> prepareImage(uri)
            type == "video/mp4" -> prepareVideo(uri)
            else -> throw AuthRequestException("Choose a JPEG, PNG, WebP image or MP4 video.")
        }
    }

    suspend fun upload(uri: Uri, onProgress: (Int) -> Unit): NativeReadyMedia {
        val expectedOwner = auth.account?.id
        if (auth.backend != SautiBackend.PRODUCTION || expectedOwner == null)
            throw AuthRequestException("Sign in to production before uploading media.")
        fun checkOwner() {
            if (auth.account?.id != expectedOwner)
                throw AuthRequestException("Your account changed. Select the media again.")
        }
        return uploads.withLock {
            withContext(Dispatchers.IO) {
                currentCoroutineContext().ensureActive()
                checkOwner()
                val prepared = prepare(uri)
                var remoteId: String? = null
                var uploadToken: String? = null
                try {
                    currentCoroutineContext().ensureActive()
                    checkOwner()
                    val token = auth.accessTokenForStagingRead()
                    checkOwner()
                    uploadToken = token
                    val begin = request("/api/sauti-media/begin", "POST", token,
                        JSONObject().put("content_type", prepared.type).put("size_bytes", prepared.file.length())
                            .toString().toRequestBody("application/json".toMediaType()))
                    val id = begin.optString("id")
                    if (!uuid.matches(id)) throw AuthRequestException("Upload reference was invalid.")
                    remoteId = id
                    currentCoroutineContext().ensureActive()
                    checkOwner()
                    val body = ProgressFileBody(prepared.file, prepared.type.toMediaType()) { value ->
                        main.post { if (auth.account?.id == expectedOwner) onProgress(value) }
                    }
                    request("/api/sauti-media/upload/$id", "PUT", token, body)
                    currentCoroutineContext().ensureActive()
                    checkOwner()
                    val finalized = request("/api/sauti-media/finalize/$id", "POST", token)
                    if (!finalized.optBoolean("ready") || finalized.optString("id") != id)
                        throw AuthRequestException("Upload was not finalized.")
                    currentCoroutineContext().ensureActive()
                    checkOwner()
                    main.post { if (auth.account?.id == expectedOwner) onProgress(100) }
                    NativeReadyMedia(id, prepared.kind)
                } catch (e: Exception) {
                    val cleanupToken = uploadToken
                    if (remoteId != null && cleanupToken != null) withContext(NonCancellable) {
                        runCatching {
                            request("/api/sauti-media/$remoteId", "DELETE", cleanupToken)
                        }
                    }
                    throw e
                } finally { prepared.file.delete() }
            }
        }
    }

    suspend fun remove(id: String) {
        if (!uuid.matches(id)) return
        withContext(Dispatchers.IO) {
            runCatching { request("/api/sauti-media/$id", "DELETE", auth.accessTokenForStagingRead()) }
        }
    }

    /** Recent ready objects are recoverable until the backend's one-hour upload expiry. */
    suspend fun pendingReady(): List<NativeReadyMedia> {
        val owner = auth.account?.id?.takeIf(uuid::matches) ?: return emptyList()
        val token = auth.accessTokenForStagingRead()
        return withContext(Dispatchers.IO) {
            val request = Request.Builder().url("${auth.restOrigin}social_post_media?owner_id=eq.$owner&post_id=is.null&upload_status=eq.ready&select=id,media_kind&order=created_at.desc&limit=12")
                .header("Authorization", "Bearer $token").header("apikey", auth.publicKeyForRead())
                .header("Accept", "application/json").header("Cache-Control", "no-store").build()
            try {
                http.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) throw AuthRequestException("Could not load unfinished uploads.")
                    val rows = JSONArray(response.body?.string()?.take(32_768).orEmpty())
                    (0 until rows.length()).mapNotNull { rows.optJSONObject(it) }.mapNotNull { row ->
                        val id = row.optString("id")
                        val kind = row.optString("media_kind")
                        if (!uuid.matches(id) || kind !in setOf("image", "video")) null
                        else NativeReadyMedia(id, kind)
                    }
                }
            } catch (e: AuthRequestException) { throw e }
            catch (_: Exception) { throw AuthRequestException("Could not load unfinished uploads.") }
        }
    }
}

private class ProgressFileBody(private val file: File, private val type: MediaType,
    private val onProgress: (Int) -> Unit) : RequestBody() {
    override fun contentType(): MediaType = type
    override fun contentLength(): Long = file.length()
    override fun writeTo(sink: BufferedSink) {
        val total = file.length().coerceAtLeast(1)
        var sent = 0L
        var last = -1
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                sink.write(buffer, 0, read)
                sent += read
                val progress = ((sent * 100) / total).toInt().coerceIn(0, 100)
                if (progress >= last + 2 || progress == 100) { last = progress; onProgress(progress) }
            }
        }
    }
}
