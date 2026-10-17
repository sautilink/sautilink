package com.sautilink.nativeapp.feature.home

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** Device-local playback choice observed by Home/Profile media composables. */
object NativePlaybackPreferences {
    private const val STORAGE = "sautilink_native_playback"
    private const val KEY = "autoplay_on_wifi_and_mobile"
    var autoplayEnabled by mutableStateOf(true)
        private set

    // Sound follows all videos in the current app session and is never persisted.
    var sessionMuted by mutableStateOf(true)
        private set

    fun resetSessionSound() { sessionMuted = true }

    fun toggleSessionSound() { sessionMuted = !sessionMuted }

    fun restore(context: Context) {
        autoplayEnabled = context.applicationContext.getSharedPreferences(
            STORAGE, Context.MODE_PRIVATE).getBoolean(KEY, true)
    }

    fun setAutoplay(context: Context, enabled: Boolean) {
        autoplayEnabled = enabled
        context.applicationContext.getSharedPreferences(STORAGE, Context.MODE_PRIVATE)
            .edit().putBoolean(KEY, enabled).apply()
    }
}
