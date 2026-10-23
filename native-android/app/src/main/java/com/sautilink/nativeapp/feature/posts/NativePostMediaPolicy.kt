package com.sautilink.nativeapp.feature.posts

/** Post limits only. Stories and private messages retain their separate contracts. */
internal object NativePostMediaPolicy {
    const val MAX_ATTACHMENTS = 10
    const val MAX_IMAGE_BYTES = 5L * 1024 * 1024
    const val MAX_VIDEO_BYTES = 250L * 1024 * 1024
    const val MAX_VIDEO_MS = 180_000L
}
