package com.sautilink.nativeapp.ui.state

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember

/** Optional host access without nullable callback flow in the screen's composition. */
internal class SessionScreenPresentationAccess(val store: SessionScreenPresentationStore?) {
    fun save(key: String, revision: Long, value: SessionScreenPresentation): Boolean {
        val current = store
        if (current == null) return false
        return current.save(key, revision, value)
    }

    fun invalidate(prefix: String? = null) {
        val current = store
        if (current != null) current.invalidate(prefix)
    }
}

@Composable
internal fun rememberSessionScreenPresentationAccess(): SessionScreenPresentationAccess {
    val store = LocalSessionScreenPresentation.current
    return remember(store) { SessionScreenPresentationAccess(store) }
}
