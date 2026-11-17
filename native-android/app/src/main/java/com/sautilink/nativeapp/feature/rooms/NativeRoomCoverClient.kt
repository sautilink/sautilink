package com.sautilink.nativeapp.feature.rooms

import com.sautilink.nativeapp.feature.auth.AuthRequestException
import com.sautilink.nativeapp.feature.auth.StagingAuthClient
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/** Sends the cropped image through the existing owner/admin Room media API. */
class NativeRoomCoverClient(auth: StagingAuthClient) {
    private val transport = NativeRoomsTransport(auth)

    suspend fun upload(room: NativeRoom, jpeg: ByteArray) {
        val own = transport.guard(room, writing = true)
        if (!room.canManageSettings) throw AuthRequestException("Only Room owners and admins can change its cover.")
        if (jpeg.isEmpty() || jpeg.size > 10 * 1024 * 1024)
            throw AuthRequestException("Choose a cropped photo no larger than 10 MB.")
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

}
