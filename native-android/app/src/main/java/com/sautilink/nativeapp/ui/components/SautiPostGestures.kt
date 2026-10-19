package com.sautilink.nativeapp.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ThumbUpOffAlt
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/** Only post body/media owns these gestures; author/actions remain separate controls. */
@Composable
internal fun SautiPostGestureSurface(
    modifier: Modifier = Modifier,
    onLike: (() -> Unit)? = null,
    onTap: (() -> Unit)? = null,
    tapLabel: String = "Open photo",
    feedbackColor: Color = MaterialTheme.colorScheme.primary,
    content: @Composable BoxScope.() -> Unit
) {
    val like by rememberUpdatedState(onLike)
    val tap by rememberUpdatedState(onTap)
    var pulse by remember { mutableIntStateOf(0) }
    var showFeedback by remember { mutableStateOf(false) }
    fun requestLike() { like?.let { it(); pulse++; showFeedback = true } }
    LaunchedEffect(pulse) {
        if (pulse > 0) { delay(650); showFeedback = false }
    }
    Box(modifier.pointerInput(Unit) {
        detectTapGestures(onTap = { tap?.invoke() }, onDoubleTap = { requestLike() })
    }.semantics(mergeDescendants = true) {
        if (onTap != null) onClick(tapLabel) { tap?.invoke(); true }
        if (onLike != null) customActions = listOf(CustomAccessibilityAction("Like post") { requestLike(); true })
    }) {
        content()
        Box(Modifier.matchParentSize(), contentAlignment = Alignment.Center) {
            AnimatedVisibility(showFeedback,
                enter = fadeIn(tween(100)) + scaleIn(initialScale = .7f), exit = fadeOut(tween(120))) {
                Icon(Icons.Rounded.ThumbUpOffAlt, null, Modifier.size(48.dp), tint = feedbackColor)
            }
        }
    }
}

/** Side double taps seek; center double taps only Like, never Unlike. */
@Composable
internal fun SautiVideoGestureSurface(
    modifier: Modifier,
    playbackLabel: String?,
    onPlayback: () -> Unit,
    onTap: (Offset, IntSize) -> Unit,
    onSeek: (Long) -> Boolean,
    onLike: (() -> Unit)?,
    content: @Composable BoxScope.() -> Unit = {}
) {
    val playback by rememberUpdatedState(onPlayback)
    val tap by rememberUpdatedState(onTap)
    val seek by rememberUpdatedState(onSeek)
    val like by rememberUpdatedState(onLike)
    var feedback by remember { mutableStateOf<VideoDoubleTapAction?>(null) }
    var showFeedback by remember { mutableStateOf(false) }
    var pulse by remember { mutableIntStateOf(0) }
    fun perform(action: VideoDoubleTapAction): Boolean {
        val accepted = when (action) {
            VideoDoubleTapAction.BACKWARD -> seek(-5_000L)
            VideoDoubleTapAction.FORWARD -> seek(5_000L)
            VideoDoubleTapAction.LIKE -> like?.let { it(); true } ?: false
        }
        if (accepted) { feedback = action; showFeedback = true; pulse++ }
        return accepted
    }
    LaunchedEffect(pulse) { if (pulse > 0) { delay(650); showFeedback = false } }
    Box(modifier.pointerInput(Unit) {
        var firstTapAction: VideoDoubleTapAction? = null
        detectTapGestures(
            onPress = { position ->
                if (firstTapAction == null) firstTapAction = videoDoubleTapAction(position.x, size.width)
                if (!tryAwaitRelease()) firstTapAction = null
            },
            onTap = { firstTapAction = null; tap(it, size) },
            onDoubleTap = { position ->
                val action = videoDoubleTapAction(position.x, size.width)
                if (firstTapAction == action) perform(action)
                firstTapAction = null
            })
    }.semantics {
        if (playbackLabel != null) onClick(playbackLabel) { playback(); true }
        customActions = buildList {
            add(CustomAccessibilityAction("Back 5 seconds") { perform(VideoDoubleTapAction.BACKWARD) })
            add(CustomAccessibilityAction("Forward 5 seconds") { perform(VideoDoubleTapAction.FORWARD) })
            if (onLike != null) add(CustomAccessibilityAction("Like post") { perform(VideoDoubleTapAction.LIKE) })
        }
    }, contentAlignment = Alignment.Center) {
        content()
        val effect = feedback
        AnimatedVisibility(showFeedback,
            modifier = Modifier.align(when (effect) {
                VideoDoubleTapAction.BACKWARD -> Alignment.CenterStart
                VideoDoubleTapAction.FORWARD -> Alignment.CenterEnd
                else -> Alignment.Center
            }).padding(horizontal = 30.dp),
            enter = fadeIn(tween(100)) + scaleIn(initialScale = .7f), exit = fadeOut(tween(120))) {
            if (effect == VideoDoubleTapAction.LIKE) {
                Icon(Icons.Rounded.ThumbUpOffAlt, null, Modifier.size(48.dp), tint = Color.White)
            } else Text(if (effect == VideoDoubleTapAction.BACKWARD) "−5s" else "+5s",
                color = Color.White, style = MaterialTheme.typography.titleLarge)
        }
    }
}
