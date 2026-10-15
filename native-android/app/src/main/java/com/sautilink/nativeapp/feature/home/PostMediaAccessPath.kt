package com.sautilink.nativeapp.feature.home

/** Optional protected review routes stay on the existing authenticated media origin. */
internal fun checkedPostMediaPath(mediaId: String, overridePath: String?): String {
    val published = "/api/sauti-media/$mediaId"
    if (overridePath == null || overridePath == published) return published
    val uuid = "[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"
    require(Regex("^$uuid$").matches(mediaId) &&
        Regex("^/api/rooms/$uuid/post-submissions/$uuid/media/${Regex.escape(mediaId)}$")
            .matches(overridePath)) { "Invalid protected Room media path." }
    return overridePath
}
