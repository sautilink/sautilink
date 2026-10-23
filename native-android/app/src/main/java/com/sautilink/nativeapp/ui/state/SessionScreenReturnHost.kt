package com.sautilink.nativeapp.ui.state

import android.content.ComponentCallbacks2
import android.content.res.Configuration
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.platform.LocalContext

internal val LocalSessionScreenPresentation = staticCompositionLocalOf<SessionScreenPresentationStore?> { null }

/** Only the selected destination is composed. Inactive players, subscriptions and effects are disposed. */
@Composable
internal fun SessionScreenReturnHost(
    authOwner: Any,
    backendId: String,
    accountId: String?,
    destination: String,
    currentAccountId: () -> String?,
    contentRevision: Int = 0,
    content: @Composable () -> Unit,
) {
    key(authOwner, backendId, accountId) {
        val context = LocalContext.current.applicationContext
        val latestOwner by rememberUpdatedState(currentAccountId)
        val presentations = remember { SessionScreenPresentationStore(backendId, accountId,
            isCurrentOwner = { latestOwner() == accountId }) }
        var seenContentRevision by remember { mutableIntStateOf(contentRevision) }
        val saveable = rememberSaveableStateHolder()
        val keys = remember { LinkedHashSet<String>() }
        val retain = accountId != null && destination !in setOf(
            "production-auth", "production-register", "production-recovery", "registration", "welcome")
        DisposableEffect(context, presentations, saveable) {
            fun trim() {
                presentations.invalidate()
                keys.toList().forEach(saveable::removeState)
                keys.clear()
            }
            val callbacks = object : ComponentCallbacks2 {
                override fun onConfigurationChanged(newConfig: Configuration) = Unit
                override fun onLowMemory() = trim()
                override fun onTrimMemory(level: Int) {
                    // A simple background transition is not memory pressure.
                    if (level == ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW ||
                        level == ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL ||
                        level >= ComponentCallbacks2.TRIM_MEMORY_BACKGROUND) trim()
                }
            }
            context.registerComponentCallbacks(callbacks)
            onDispose {
                context.unregisterComponentCallbacks(callbacks)
                presentations.close()
                keys.toList().forEach(saveable::removeState)
                keys.clear()
            }
        }
        SideEffect {
            if (seenContentRevision != contentRevision) {
                presentations.invalidate("feed:")
                presentations.invalidate("short-videos")
                seenContentRevision = contentRevision
            }
            if (retain) {
                keys.remove(destination); keys.add(destination)
                while (keys.size > 12) {
                    val oldest = keys.first()
                    keys.remove(oldest); saveable.removeState(oldest)
                }
            }
        }
        CompositionLocalProvider(LocalSessionScreenPresentation provides presentations) {
            if (retain) saveable.SaveableStateProvider(destination, content) else content()
        }
    }
}
