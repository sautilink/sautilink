package com.sautilink.nativeapp.feature.music

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue

/** Geometry changes on every scroll frame. Only a changed soundtrack selection
 * invalidates Compose; the session must not recompose the whole feed per pixel. */
internal class VisiblePostAudioRegistry {
    private val entries = linkedMapOf<String, VisiblePostAudio>()
    private var revision by mutableIntStateOf(0)
    val values: Collection<VisiblePostAudio>
        get() { revision; return entries.values }

    private fun identity(group: String?): Pair<String, NativeAudioSelection?>? = entries.values
        .filter { it.postId == group }
        .maxWithOrNull(compareBy<VisiblePostAudio> { it.visiblePercent }.thenByDescending { it.distance })
        ?.let { it.postId to it.audio }

    operator fun set(key: String, value: VisiblePostAudio) {
        val previous = entries[key]
        val before = identity(value.postId)
        val oldBefore = previous?.takeIf { it.postId != value.postId }?.let { identity(it.postId) }
        entries[key] = value
        if (before != identity(value.postId) || previous != null && previous.postId != value.postId &&
            oldBefore != identity(previous.postId)) revision++
    }

    fun remove(key: String) {
        val previous = entries[key] ?: return
        val before = identity(previous.postId)
        entries.remove(key)
        if (before != identity(previous.postId)) revision++
    }
}
