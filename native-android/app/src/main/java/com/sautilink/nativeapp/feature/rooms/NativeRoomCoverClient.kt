package com.sautilink.nativeapp.feature.rooms

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import com.sautilink.nativeapp.feature.auth.AuthRequestException
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import com.sautilink.nativeapp.feature.profile.decodeProfileCropSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/** Existing owner/admin Room media API; uses the approved bounded, EXIF-aware image decoder. */
class NativeRoomCoverClient(private val context: Context, auth: StagingAuthClient) {
    private val transport = NativeRoomsTransport(auth)

    suspend fun upload(room: NativeRoom, uri: Uri) {
        val own = transport.guard(room, writing = true)
        if (!room.canManageSettings) throw AuthRequestException("Only Room owners and admins can change its cover.")
        val jpeg = prepare(uri)
        transport.checkViewer(own)
        val multipart = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("room_id", room.id)
            .addFormDataPart("file", "sautilink-room-cover.jpg", jpeg.toRequestBody("image/jpeg".toMediaType()))
            .build()
        val data = transport.api(own, "/api/room-media/upload", "POST", content = multipart)
        if (data.roomString("slug") != room.slug || data.optInt("width") < 600 || data.optInt("height") < 200)
            throw AuthRequestException("Cover update could not be confirmed. Refresh this Room.")
    }

    suspend fun remove(room: NativeRoom) {
        val own = transport.guard(room, writing = true)
        if (!room.canManageSettings) throw AuthRequestException("Only Room owners and admins can remove its cover.")
        val data = transport.api(own, "/api/room-media/remove", "DELETE", JSONObject().put("room_id", room.id))
        if (!data.has("removed")) throw AuthRequestException("Cover removal could not be confirmed. Refresh this Room.")
    }

    private suspend fun prepare(uri: Uri): ByteArray {
        val bitmap = decodeProfileCropSource(context, uri)
        return try {
            withContext(Dispatchers.Default) {
                if (bitmap.width < 600 || bitmap.height < 200)
                    throw AuthRequestException("Choose a cover photo at least 600 × 200 pixels after resizing.")
                val bytes = ByteArrayOutputStream().use { output ->
                    if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 88, output))
                        throw AuthRequestException("The cover photo could not be prepared.")
                    output.toByteArray()
                }
                if (bytes.isEmpty() || bytes.size > 10 * 1024 * 1024)
                    throw AuthRequestException("Room cover photos must be 10 MB or smaller.")
                bytes
            }
        } finally { bitmap.recycle() }
    }
}
