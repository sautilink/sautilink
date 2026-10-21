package com.sautilink.nativeapp.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.MediaItem
import androidx.media3.common.VideoSize
import com.sautilink.nativeapp.ui.theme.SautiShape
import kotlinx.coroutines.delay
import java.util.Locale
import kotlin.math.sin

internal fun videoTimeLabel(positionMs: Long): String {
    val totalSeconds = positionMs.coerceAtLeast(0L) / 1_000L
    val seconds = totalSeconds % 60
    val minutes = totalSeconds / 60 % 60
    val hours = totalSeconds / 3_600
    return if (hours > 0) String.format(Locale.ROOT, "%d:%02d:%02d", hours, minutes, seconds)
        else String.format(Locale.ROOT, "%d:%02d", totalSeconds / 60, seconds)
}

internal fun videoQualityLabel(preference: String, current: String?): String = when (preference) {
    "auto" -> current?.let { "Auto · ${if (it == "original") "Original" else "${it}p"}" } ?: "Auto"
    "data-saver" -> "Data saver"
    "original" -> "Original"
    else -> "${preference}p"
}

internal fun videoSpeedLabel(speed: Float): String = if (speed == 1f) "Normal" else "${speed}×"

/** Report decoded dimensions, never a requested rendition that the server may have substituted. */
@Composable
internal fun rememberVideoPlaybackQuality(player: Player?): String? {
    fun measured(size: VideoSize): String? = if (size.width > 0 && size.height > 0)
        minOf(size.width, size.height).toString() else null
    var quality by remember(player) { mutableStateOf<String?>(null) }
    DisposableEffect(player) {
        if (player == null) return@DisposableEffect onDispose { }
        val listener = object : Player.Listener {
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                // Repeat keeps the same decoder/representation and need not emit another
                // size/first-frame event. A genuinely new source must earn its own label.
                quality = if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT)
                    measured(player.videoSize) ?: quality else null
            }
            override fun onVideoSizeChanged(videoSize: VideoSize) { quality = measured(videoSize) }
            override fun onRenderedFirstFrame() { quality = measured(player.videoSize) }
        }
        quality = measured(player.videoSize)
        player.addListener(listener)
        onDispose { player.removeListener(listener) }
    }
    return quality
}

/** A local Huge settings glyph with no entry/selection motion. Only an actual click animates it. */
@Composable
internal fun VideoSettingsButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val motion = remember { Animatable(0f) }
    var activation by remember { mutableIntStateOf(0) }
    LaunchedEffect(activation) {
        if (activation == 0) return@LaunchedEffect
        motion.snapTo(0f)
        motion.animateTo(1f, tween(360))
    }
    val vector = remember { requireNotNull(SautiHugeVectors.get("settings-0-1")) }
    IconButton(onClick = { activation++; onClick() }, enabled = enabled, modifier = modifier.size(48.dp)) {
        Icon(vector, "Playback settings", tint = Color.White,
            modifier = Modifier.size(23.dp).graphicsLayer {
                rotationZ = (sin(motion.value * Math.PI * 4) * sin(motion.value * Math.PI) * 9).toFloat()
            })
    }
}

/** Timeline updates stay inside the controls, keeping feed/player composition out of the 4 Hz clock. */
@Composable
internal fun VideoPlaybackControls(
    player: Player?, playing: Boolean, muted: Boolean,
    onTogglePlayback: () -> Unit, onToggleSound: () -> Unit, onOpenSettings: () -> Unit,
    modifier: Modifier = Modifier, settingsEnabled: Boolean = true
) {
    val mediaId = player?.currentMediaItem?.mediaId
    var position by remember(player, mediaId) { mutableLongStateOf(0L) }
    var duration by remember(player, mediaId) { mutableLongStateOf(0L) }
    var seekable by remember(player, mediaId) { mutableStateOf(false) }
    var scrubPosition by remember(player, mediaId) { mutableStateOf<Float?>(null) }
    LaunchedEffect(player, mediaId) {
        if (player == null) return@LaunchedEffect
        while (true) {
            val measuredDuration = player.duration
            duration = if (measuredDuration != C.TIME_UNSET && measuredDuration > 0) measuredDuration else 0L
            position = player.currentPosition.coerceIn(0L, duration.coerceAtLeast(0L))
            seekable = player.isCurrentMediaItemSeekable && duration > 0
            delay(if (player.isPlaying) 250 else 500)
        }
    }
    val displayPosition = scrubPosition?.toLong() ?: position
    Column(modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(
        Color.Transparent, Color.Black.copy(alpha = .68f)
    ))).padding(horizontal = 8.dp)) {
        Slider(
            value = (scrubPosition ?: position.toFloat()).coerceIn(0f, duration.coerceAtLeast(1L).toFloat()),
            onValueChange = { scrubPosition = it },
            onValueChangeFinished = {
                val target = scrubPosition
                if (target != null && player?.isCurrentMediaItemSeekable == true && duration > 0L) {
                    val bounded = target.toLong().coerceIn(0L, (duration - 1L).coerceAtLeast(0L))
                    player.seekTo(bounded)
                    position = bounded
                }
                scrubPosition = null
            },
            valueRange = 0f..duration.coerceAtLeast(1L).toFloat(),
            enabled = seekable,
            colors = SliderDefaults.colors(thumbColor = Color.White, activeTrackColor = Color.White,
                inactiveTrackColor = Color.White.copy(alpha = .3f)),
            modifier = Modifier.fillMaxWidth().height(48.dp).semantics { contentDescription = "Video progress" }
        )
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onTogglePlayback, enabled = player != null, modifier = Modifier.size(48.dp)) {
                SautiIcon(if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                    if (playing) "Pause video" else "Play video", tint = Color.White, modifier = Modifier.size(23.dp))
            }
            IconButton(onClick = onToggleSound, modifier = Modifier.size(48.dp)) {
                SautiIcon(if (muted) Icons.Rounded.VolumeOff else Icons.Rounded.VolumeUp,
                    if (muted) "Unmute video" else "Mute video", tint = Color.White, modifier = Modifier.size(23.dp))
            }
            Text("${videoTimeLabel(displayPosition)} / ${videoTimeLabel(duration)}", color = Color.White,
                style = MaterialTheme.typography.labelMedium, maxLines = 1,
                modifier = Modifier.weight(1f).padding(start = 3.dp))
            VideoSettingsButton(onOpenSettings, enabled = settingsEnabled)
        }
    }
}

/** Shorts keep only a thin timeline while playing. Touch or pause expands its thumb and time labels. */
@Composable
internal fun ShortVideoProgressControls(player: Player, paused: Boolean, modifier: Modifier = Modifier,
    onExpandedChanged: (Boolean) -> Unit = {}) {
    val mediaId = player.currentMediaItem?.mediaId
    var position by remember(player, mediaId) { mutableLongStateOf(0L) }
    var duration by remember(player, mediaId) { mutableLongStateOf(0L) }
    var seekable by remember(player, mediaId) { mutableStateOf(false) }
    var draft by remember(player, mediaId) { mutableStateOf<Float?>(null) }
    var dragging by remember(player, mediaId) { mutableStateOf(false) }
    var activation by remember(player, mediaId) { mutableIntStateOf(0) }
    var touchExpanded by remember(player, mediaId) { mutableStateOf(false) }
    LaunchedEffect(player, mediaId) {
        while (true) {
            duration = player.duration.takeIf { it != C.TIME_UNSET && it > 0L } ?: 0L
            position = player.currentPosition.coerceIn(0L, duration)
            seekable = player.isCurrentMediaItemSeekable && duration > 0L
            delay(if (player.isPlaying) 250 else 500)
        }
    }
    LaunchedEffect(activation, paused, dragging) {
        if (paused || dragging) touchExpanded = true
        else if (activation > 0) { touchExpanded = true; delay(2_200L); touchExpanded = false }
        else touchExpanded = false
    }
    val expanded = paused || dragging || touchExpanded
    val freshExpandedChanged by rememberUpdatedState(onExpandedChanged)
    LaunchedEffect(expanded) { freshExpandedChanged(expanded) }
    val shown = (draft?.toLong() ?: position).coerceIn(0L, duration)
    fun seek(target: Float) {
        if (!seekable) return
        val bounded = target.toLong().coerceIn(0L, (duration - 1L).coerceAtLeast(0L))
        player.seekTo(bounded); position = bounded
    }
    Column(modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
        if (expanded) Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(videoTimeLabel(shown), color = Color.White, style = MaterialTheme.typography.labelSmall)
            Text(videoTimeLabel(duration), color = Color.White, style = MaterialTheme.typography.labelSmall)
        }
        Box(Modifier.fillMaxWidth().height(48.dp)
            .semantics {
                contentDescription = "Video progress"
                stateDescription = "${videoTimeLabel(shown)} of ${videoTimeLabel(duration)}"
                progressBarRangeInfo = ProgressBarRangeInfo(shown.toFloat(), 0f..duration.coerceAtLeast(1L).toFloat())
                setProgress { target -> if (seekable) { activation++; seek(target); true } else false }
            }
            .pointerInput(player, mediaId, duration, seekable) {
                detectTapGestures(onPress = { activation++; tryAwaitRelease() }, onTap = { point ->
                    if (seekable) seek(point.x.coerceIn(0f, size.width.toFloat()) / size.width.coerceAtLeast(1) * duration)
                })
            }
            .pointerInput(player, mediaId, duration, seekable) {
                detectHorizontalDragGestures(onDragStart = { point ->
                    if (seekable) { dragging = true; activation++; draft = point.x / size.width.coerceAtLeast(1) * duration }
                }, onDragEnd = { draft?.let(::seek); draft = null; dragging = false },
                    onDragCancel = { draft = null; dragging = false }) { change, _ ->
                    if (seekable) { change.consume(); draft = (change.position.x / size.width.coerceAtLeast(1) * duration).coerceIn(0f, duration.toFloat()) }
                }
            }) {
            Canvas(Modifier.fillMaxSize()) {
                val lineY = size.height - 13.dp.toPx()
                val edge = 4.dp.toPx()
                val width = (size.width - edge * 2).coerceAtLeast(0f)
                val fraction = if (duration > 0) shown.toFloat() / duration else 0f
                val thickness = (if (expanded) 3.dp else 1.5.dp).toPx()
                drawLine(Color.White.copy(alpha = .3f), Offset(edge, lineY), Offset(edge + width, lineY), thickness)
                drawLine(Color.White, Offset(edge, lineY), Offset(edge + width * fraction, lineY), thickness)
                if (expanded) drawCircle(Color.White, 5.dp.toPx(), Offset(edge + width * fraction, lineY))
            }
        }
    }
}

/** The same app-owned playback sheet is used by feed, post, Room and Short Video players. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun VideoPlaybackSettingsSheet(
    preference: String, currentQuality: String?, availableQualities: List<Int>, speed: Float,
    onQuality: (String) -> Unit, onSpeed: (Float) -> Unit, onDismiss: () -> Unit,
    autoplay: Boolean? = null, onAutoplay: ((Boolean) -> Unit)? = null,
    qualityEnabled: Boolean = true
) {
    var page by remember { mutableStateOf("playback") }
    ModalBottomSheet(onDismissRequest = onDismiss, shape = SautiShape.Sheet,
        containerColor = MaterialTheme.colorScheme.surface, tonalElevation = 0.dp) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)
            .padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(Modifier.fillMaxWidth().heightIn(min = 52.dp), verticalAlignment = Alignment.CenterVertically) {
                if (page != "playback") IconButton(onClick = { page = "playback" }) {
                    SautiIcon(Icons.AutoMirrored.Rounded.ArrowBack, "Back to playback settings")
                } else SautiIcon(Icons.Rounded.Settings, null, tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(horizontal = 12.dp).size(24.dp))
                Text(when (page) { "quality" -> "Quality"; "speed" -> "Playback speed"; else -> "Playback" },
                    style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                IconButton(onClick = onDismiss) { SautiIcon(Icons.Rounded.Close, "Close playback settings") }
            }
            when (page) {
                "quality" -> {
                    Text("Auto chooses quality for your connection and can reduce it if playback stalls.",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
                    PlaybackChoice("Auto", videoQualityLabel("auto", currentQuality), preference == "auto") { onQuality("auto"); page = "playback" }
                    availableQualities.sortedDescending().forEach { quality ->
                        PlaybackChoice("${quality}p", null, preference == quality.toString()) { onQuality(quality.toString()); page = "playback" }
                    }
                    PlaybackChoice("Original", null, preference == "original") { onQuality("original"); page = "playback" }
                }
                "speed" -> listOf(.5f, .75f, 1f, 1.25f, 1.5f, 1.75f, 2f).forEach { choice ->
                    PlaybackChoice(videoSpeedLabel(choice), null, speed == choice) { onSpeed(choice); page = "playback" }
                }
                else -> {
                    PlaybackSettingRow(Icons.Rounded.Speed, "Playback speed", videoSpeedLabel(speed)) { page = "speed" }
                    if (qualityEnabled) PlaybackSettingRow(Icons.Rounded.Tune, "Quality", videoQualityLabel(preference, currentQuality)) { page = "quality" }
                    if (autoplay != null && onAutoplay != null) Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp)
                        .heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
                        SautiIcon(Icons.Rounded.PlayCircleOutline, null, tint = MaterialTheme.colorScheme.primary)
                        Text("Autoplay", modifier = Modifier.weight(1f).padding(horizontal = 14.dp))
                        Switch(checked = autoplay, onCheckedChange = onAutoplay)
                    }
                }
            }
        }
    }
}

@Composable
private fun PlaybackSettingRow(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, value: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick)
        .heightIn(min = 64.dp).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        SautiIcon(icon, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(24.dp))
        Text(title, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 140.dp))
        SautiIcon(Icons.Rounded.ChevronRight, null, modifier = Modifier.size(20.dp))
    }
}

@Composable
private fun PlaybackChoice(label: String, subtitle: String?, selected: Boolean, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(role = Role.RadioButton, onClick = onClick)
        .heightIn(min = 52.dp).padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        RadioButton(selected = selected, onClick = null)
    }
}
