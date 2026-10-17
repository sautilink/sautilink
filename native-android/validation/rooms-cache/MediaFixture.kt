package com.sautilink.nativeapp.feature.posts

import android.content.Context
import android.net.Uri
import com.sautilink.nativeapp.feature.auth.StagingAuthClient

data class NativeReadyMedia(val id: String, val kind: String, val altText: String = "")
class NativeMediaClient(auth: StagingAuthClient, context: Context) {
    suspend fun upload(uri: Uri, onProgress: (Int) -> Unit): NativeReadyMedia = error("Unexpected upload")
    suspend fun remove(id: String): Unit = error("Unexpected media deletion")
}
