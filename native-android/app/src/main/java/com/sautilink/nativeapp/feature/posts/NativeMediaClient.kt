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
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.isActive
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

data class NativeReadyMedia(val id: String, val kind: String, val altText: String = "")
private data class PreparedMedia(val file: File, val type: String, val kind: String)

/** Android picker media -> bounded local file -> SautiLink begin/upload/finalize protocol. */
class NativeMediaClient(private val auth: StagingAuthClient, private val context: Context) {
    private val http = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS).writeTimeout(90, TimeUnit.SECONDS).callTimeout(300, TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).build()
    private val uploads = Mutex()
    private val main = Handler(Looper.getMainLooper())
    private val uuid = Regex("^[0-9a-fA-F-]{36}$")

    private suspend fun request(path: String, method: String, token: String, body: RequestBody? = null): JSONObject =
        suspendCancellableCoroutine { continuation ->
        val started = System.nanoTime()
        fun diagnostic(status: Int?, failed: Boolean = false) {
            if (!BuildConfig.DEBUG) return
            val stage = when {
                path.endsWith("/begin") -> "BEGIN"
                path.contains("/finalize/") -> "FINALIZE"
                path.endsWith("?complete=1") -> "COMPLETE"
                method == "PUT" -> "TRANSFER"
                method == "DELETE" -> "REMOVE"
                else -> "READ"
            }
            // Fixed phase/status/timing only. No URL, ID, body or authorization.
            Log.d("SautiNativeMedia", "stage=$stage elapsed_ms=${(System.nanoTime() - started) / 1_000_000} " +
                "status=${status ?: 0} failed=$failed")
        }
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
        val call = http.newCall(builder.build())
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, error: IOException) {
                diagnostic(null, true)
                if (continuation.isActive) continuation.resumeWithException(
                    error.cause as? AuthRequestException ?: AuthRequestException(
                        "The upload connection was interrupted. Check your connection and retry.", cause = error)
                )
            }
            override fun onResponse(call: Call, response: okhttp3.Response) {
                try {
                    val data = response.use {
                        val json = it.body?.byteStream()?.use(::readBoundedPostUploadJson) ?: JSONObject()
                        if (!it.isSuccessful || !json.optBoolean("ok")) {
                            val message = json.optJSONObject("error")?.optString("message")?.takeIf { text -> text.length in 1..220 }
                            throw AuthRequestException(message ?: "Media request failed (HTTP ${it.code}).", it.code)
                        }
                        json.optJSONObject("data") ?: throw AuthRequestException("Media response was incomplete.")
                    }
                    diagnostic(response.code)
                    if (continuation.isActive) continuation.resume(data)
                } catch (error: Exception) {
                    diagnostic(response.code, true)
                    if (continuation.isActive) continuation.resumeWithException(
                        if (error is AuthRequestException) error else AuthRequestException("Media response was incomplete.", cause = error)
                    )
                }
            }
        })
    }

    private fun tempFile(extension: String): File = File(context.cacheDir, "sauti-media-${UUID.randomUUID()}.$extension")

    private fun prepareImage(uri: Uri, checkActiveOwner: () -> Unit): PreparedMedia {
        checkActiveOwner()
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
        var output: File? = null
        try {
            val alpha = bitmap.hasAlpha()
            val image = tempFile(if (alpha) "png" else "jpg")
            output = image
            image.outputStream().use { stream ->
                if (!bitmap.compress(if (alpha) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG,
                        if (alpha) 100 else 84, stream)) throw AuthRequestException("Image compression failed.")
            }
            checkActiveOwner()
            if (!NativePostUploadPolicy.imageSizeAllowed(image.length())) {
                throw AuthRequestException("The compressed image is still above 5 MiB. Choose a smaller image.")
            }
            return PreparedMedia(image, if (alpha) "image/png" else "image/jpeg", "image")
        } catch (error: Exception) { output?.delete(); throw error }
        finally { bitmap.recycle() }
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

    private fun prepareVideo(uri: Uri, checkActiveOwner: () -> Unit): PreparedMedia {
        checkActiveOwner()
        val resolver = context.contentResolver
        if (mediaType(uri) != "video/mp4")
            throw AuthRequestException("Choose an MP4 video.")
        val retriever = MediaMetadataRetriever()
        try {
            retriever.setDataSource(context, uri)
            val duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
                ?: throw AuthRequestException("Could not read video duration.")
            if (!NativePostUploadPolicy.videoDurationAllowed(duration))
                throw AuthRequestException("Videos must be between 1 millisecond and 3 minutes. Trim the video before uploading.")
        } finally { retriever.release() }
        val output = tempFile("mp4")
        try {
            resolver.openInputStream(uri)?.use { input ->
                output.outputStream().use { out ->
                    val buffer = ByteArray(64 * 1024)
                    var total = 0L
                    while (true) {
                        checkActiveOwner()
                        val read = input.read(buffer)
                        if (read < 0) break
                        checkActiveOwner()
                        total += read
                        if (!NativePostUploadPolicy.videoSizeAllowed(total)) throw AuthRequestException("Videos must be 250 MiB or smaller.")
                        out.write(buffer, 0, read)
                    }
                }
            } ?: throw AuthRequestException("Could not open video.")
            if (output.length() < 1) throw AuthRequestException("Video is empty.")
            return PreparedMedia(output, "video/mp4", "video")
        } catch (e: Exception) { output.delete(); throw e }
    }

    private fun prepare(uri: Uri, checkActiveOwner: () -> Unit): PreparedMedia {
        val type = mediaType(uri)
        return when {
            type.startsWith("image/") -> prepareImage(uri, checkActiveOwner)
            type == "video/mp4" -> prepareVideo(uri, checkActiveOwner)
            else -> throw AuthRequestException("Choose a JPEG, PNG, WebP image or MP4 video.")
        }
    }

    // Only this app's local editor exports may supply a file-extension MIME hint.
    // Picker content URIs retain their provider MIME and existing validation.
    private fun mediaType(uri: Uri): String {
        context.contentResolver.getType(uri)?.lowercase()?.let { return it }
        if (uri.scheme != "file") return ""
        val file = File(uri.path ?: return "").canonicalFile
        if (file.parentFile != context.cacheDir.canonicalFile || !file.name.startsWith("sauti-edit-")) return ""
        return when (file.extension.lowercase()) { "jpg" -> "image/jpeg"; "png" -> "image/png"; "mp4" -> "video/mp4"; else -> "" }
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
                val uploadContext = currentCoroutineContext()
                val checkActiveOwner = { uploadContext.ensureActive(); checkOwner() }
                checkActiveOwner()
                val prepared = prepare(uri, checkActiveOwner)
                var remoteId: String? = null
                var uploadToken: String? = null
                suspend fun freshToken(): String {
                    checkActiveOwner()
                    val current = auth.accessTokenForStagingRead()
                    checkActiveOwner()
                    uploadToken = current
                    return current
                }
                try {
                    main.post { if (auth.account?.id == expectedOwner && uploadContext.isActive) onProgress(0) }
                    val begin = request("/api/sauti-media/begin", "POST", freshToken(),
                        JSONObject().put("content_type", prepared.type).put("size_bytes", prepared.file.length())
                            .toString().toRequestBody("application/json".toMediaType()))
                    val id = begin.optString("id")
                    if (!uuid.matches(id)) throw AuthRequestException("Upload reference was invalid.")
                    remoteId = id
                    checkActiveOwner()
                    val plan = try {
                        NativePostUploadPolicy.plan(id,prepared.file.length(),prepared.kind,prepared.type,begin)
                    } catch (error: IllegalArgumentException) {
                        throw AuthRequestException(error.message ?: "The upload session was invalid.")
                    }
                    var highestProgress = 0
                    val finalized = finishNativePostUpload(plan, checkActiveOwner,
                        transfer = { part ->
                            val token = freshToken()
                            val body = NativePostFileRangeBody(prepared.file, prepared.type.toMediaType(),
                                plan.offset(part), plan.length(part), checkActiveOwner) { value ->
                                // A retry may resend a part but never moves the visible progress backwards.
                                highestProgress = maxOf(highestProgress, value)
                                val progress = highestProgress
                                main.post { if (auth.account?.id == expectedOwner && uploadContext.isActive) onProgress(progress) }
                            }
                            request(plan.path(part), "PUT", token, body)
                        },
                        complete = { request(plan.completePath, "PUT", freshToken(), ByteArray(0).toRequestBody(prepared.type.toMediaType())); Unit },
                        finalize = { request("/api/sauti-media/finalize/$id", "POST", freshToken()) })
                    if (!finalized.optBoolean("ready") || finalized.optString("id") != id)
                        throw AuthRequestException("Upload was not finalized.")
                    checkActiveOwner()
                    main.post { if (auth.account?.id == expectedOwner && uploadContext.isActive) onProgress(100) }
                    NativeReadyMedia(id, prepared.kind)
                } catch (e: Exception) {
                    val cleanupToken = uploadToken
                    if (remoteId != null && cleanupToken != null) withContext(NonCancellable) {
                        runCatching {
                            withTimeout(10_000) { request("/api/sauti-media/$remoteId", "DELETE", cleanupToken) }
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
