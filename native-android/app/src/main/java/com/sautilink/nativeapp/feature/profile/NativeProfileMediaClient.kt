package com.sautilink.nativeapp.feature.profile

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.content.Context
import com.sautilink.nativeapp.feature.auth.AuthRequestException
import com.sautilink.nativeapp.feature.auth.SautiBackend
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit

/** Uses the same R2-backed owner-authenticated Worker API as SautiLink Web. */
internal class NativeProfileMediaClient(private val auth: StagingAuthClient) {
    private val http = OkHttpClient.Builder().callTimeout(60, TimeUnit.SECONDS).build()

    private suspend fun api(
        route: String,
        method: String = "GET",
        content: okhttp3.RequestBody? = null
    ): JSONObject = withContext(Dispatchers.IO) {
        if (auth.backend != SautiBackend.PRODUCTION) {
            throw AuthRequestException("Profile editing is available on production only.")
        }
        val token = auth.accessTokenForStagingRead()
        val base = auth.backend.siteOrigin.trimEnd('/')
        val request = Request.Builder().url(base + route)
            .header("Authorization", "Bearer $token")
            .header("Cache-Control", "no-store")
            .apply { if (method == "POST" && content != null) post(content) else get() }
            .build()
        try {
            http.newCall(request).execute().use { response ->
                val parsed = runCatching {
                    JSONObject(response.body?.string().orEmpty().take(12_000))
                }.getOrNull()
                if (!response.isSuccessful || parsed?.optBoolean("ok") != true) {
                    val msg = parsed?.optJSONObject("error")?.optString("message")
                    throw AuthRequestException(
                        msg?.takeIf { it.isNotBlank() }
                            ?: "Profile media service returned HTTP ${response.code}.")
                }
                parsed.optJSONObject("data") ?: JSONObject()
            }
        } catch (e: AuthRequestException) { throw e }
        catch (_: Exception) {
            throw AuthRequestException("Profile media request failed. Check your connection.")
        }
    }

    suspend fun isReady(): Boolean =
        api("/api/profile-media/status").optBoolean("ready")

    suspend fun upload(slot: String, jpeg: ByteArray) {
        require(slot in setOf("avatar", "header"))
        val limit = if (slot == "avatar") 5 * 1024 * 1024 else 8 * 1024 * 1024
        if (jpeg.isEmpty() || jpeg.size > limit)
            throw AuthRequestException("The cropped image is too large. Try another photo.")
        if (!isReady()) throw AuthRequestException("Profile media storage is unavailable.")
        val multipart = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("slot", slot)
            .addFormDataPart("file", "sautilink-${slot}.jpg",
                jpeg.toRequestBody("image/jpeg".toMediaType()))
            .build()
        api("/api/profile-media/upload", "POST", multipart)
    }

    suspend fun remove(slot: String) {
        require(slot in setOf("avatar", "header"))
        api("/api/profile-media/remove", "POST",
            JSONObject().put("slot", slot).toString()
                .toRequestBody("application/json; charset=utf-8".toMediaType()))
    }
}

/** Sampled decode keeps huge gallery/camera photos from exhausting Android memory. */
internal suspend fun decodeProfileCropSource(context: Context, uri: Uri): Bitmap =
    withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        val sourceSize = resolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L
        if (sourceSize > 24L * 1024 * 1024)
            throw AuthRequestException("Choose an image smaller than 24 MB.")
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, bounds)
        } ?: throw AuthRequestException("Cannot read this image.")
        if (bounds.outWidth < 20 || bounds.outHeight < 20 ||
            bounds.outWidth > 16_000 || bounds.outHeight > 16_000)
            throw AuthRequestException("This image has unsupported dimensions.")
        var sample = 1
        while (bounds.outWidth / sample > 2400 || bounds.outHeight / sample > 2400) sample *= 2
        val decoded = resolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null,
                BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: throw AuthRequestException("Unable to decode selected photo.")
        // Respect camera/gallery EXIF orientation before opening the crop screen.
        val orientation = runCatching {
            resolver.openInputStream(uri)?.use {
                android.media.ExifInterface(it).getAttributeInt(
                    android.media.ExifInterface.TAG_ORIENTATION,
                    android.media.ExifInterface.ORIENTATION_NORMAL)
            } ?: android.media.ExifInterface.ORIENTATION_NORMAL
        }.getOrDefault(android.media.ExifInterface.ORIENTATION_NORMAL)
        val matrix = android.graphics.Matrix()
        when (orientation) {
            android.media.ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
            android.media.ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
            android.media.ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
            android.media.ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
            android.media.ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
        }
        if (!matrix.isIdentity) {
            val turned = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
            if (turned !== decoded) decoded.recycle()
            turned
        } else decoded
    }

internal fun croppedProfileJpeg(bitmap: Bitmap, slot: String, zoom: Float, panX: Float, panY: Float): ByteArray {
    val width = if (slot == "avatar") 1000 else 1440
    val height = if (slot == "avatar") 1000 else 540
    val aspect = width.toFloat() / height
    val cropW = minOf(bitmap.width.toFloat(), bitmap.height * aspect) / zoom
    val cropH = cropW / aspect
    val centerX = bitmap.width / 2f + panX.coerceIn(-1f, 1f) * (bitmap.width - cropW) / 2f
    val centerY = bitmap.height / 2f + panY.coerceIn(-1f, 1f) * (bitmap.height - cropH) / 2f
    val left = (centerX - cropW / 2f).coerceIn(0f, bitmap.width - cropW)
    val top = (centerY - cropH / 2f).coerceIn(0f, bitmap.height - cropH)
    val output = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = android.graphics.Canvas(output)
    val src = android.graphics.RectF(left, top, left + cropW, top + cropH)
    canvas.drawBitmap(bitmap, src, android.graphics.RectF(0f, 0f, width.toFloat(), height.toFloat()),
        android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG or
            android.graphics.Paint.FILTER_BITMAP_FLAG))
    val stream = ByteArrayOutputStream()
    try {
        if (!output.compress(Bitmap.CompressFormat.JPEG, 88, stream))
            throw AuthRequestException("Could not prepare your cropped image.")
        return stream.toByteArray()
    } finally { output.recycle() }
}
