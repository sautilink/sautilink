package com.sautilink.nativeapp.feature.posts

import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.sautilink.nativeapp.ui.components.SautiIcon as Icon
import com.sautilink.nativeapp.ui.theme.SautiShape
import kotlinx.coroutines.*

@Composable
internal fun NativeMediaEditor(uri: Uri, video: Boolean, onCancel: () -> Unit,
    onExportActivity: (Boolean) -> Unit, onUse: (NativeEditedMedia) -> Unit,
    maximumVideoMs: Long = NativeMediaEditPolicy.MAX_VIDEO_MS, storyPhoto: Boolean = false) {
    require(maximumVideoMs in 1..NativeMediaEditPolicy.MAX_VIDEO_MS)
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var edits by remember(uri) { mutableStateOf(NativeImageEdits()) }
    var filter by remember(uri) { mutableStateOf(NativePhotoFilter.Original) }
    var source by remember(uri) { mutableStateOf<Bitmap?>(null) }
    var duration by remember(uri) { mutableLongStateOf(0L) }
    var videoSize by remember(uri) { mutableStateOf<NativeVideoSize?>(null) }
    var trim by remember(uri) { mutableStateOf(NativeMediaEditPolicy.Trim(0, 0)) }
    var tab by remember(uri) { mutableStateOf(if (video) "Trim" else "Crop") }
    var failure by remember(uri) { mutableStateOf<String?>(null) }
    var exporting by remember { mutableStateOf(false) }
    var progress by remember { mutableIntStateOf(0) }
    var exportJob by remember { mutableStateOf<Job?>(null) }
    val videoTrimming = video && tab == "Trim"
    LaunchedEffect(uri) {
        try {
            if (video) {
                duration = localVideoDuration(context, uri)
                videoSize = localVideoSize(context, uri)
                trim = NativeMediaEditPolicy.trim(duration, lengthMs = maximumVideoMs, maximumMs = maximumVideoMs)
            } else source = loadEditableBitmap(context, uri, 1024)
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) { failure = error.message ?: "This media could not be opened." }
    }
    val preview by produceState<Bitmap?>(null, source, edits) {
        val original = source ?: return@produceState
        delay(100)
        value = withContext(Dispatchers.IO) { renderEditedBitmap(original, edits, context) }
    }
    fun cancel() { exportJob?.cancel(); onExportActivity(false); onCancel() }
    Dialog(onDismissRequest = { cancel() }, properties = DialogProperties(usePlatformDefaultWidth = false,
        dismissOnClickOutside = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
            Column(Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { cancel() }) { Icon(Icons.Rounded.Close, "Cancel media editing") }
                    Text(if (video) "Edit video" else "Edit image", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                    TextButton(onClick = {
                        failure = null; exporting = true; progress = 0; onExportActivity(true)
                        exportJob = scope.launch {
                            var unusedExport: NativeEditedMedia? = null
                            try {
                                val result = if (video) exportTrimmedVideo(context, uri, duration, trim, maximumVideoMs, edits) { progress = it }
                                else {
                                    val original = loadEditableBitmap(context, uri)
                                    try { exportEditedImage(context, original, edits, if (storyPhoto) 8L * 1024 * 1024 else NativePostMediaPolicy.MAX_IMAGE_BYTES) } finally { original.recycle() }
                                }
                                unusedExport = result; ensureActive(); onUse(result); unusedExport = null
                            } catch (cancelled: CancellationException) { throw cancelled }
                            catch (error: Exception) { failure = error.message ?: "Could not prepare media. Try again." }
                            finally { unusedExport?.ownedFile?.delete(); exporting = false; onExportActivity(false) }
                        }
                    }, enabled = !exporting && if (video) duration > 0L else source != null) {
                        Icon(Icons.Rounded.Check, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Use media")
                    }
                }
                if (videoTrimming && videoSize != null && duration > 0) {
                    NativeVideoTrimPanel(uri, duration, maximumVideoMs, trim, edits, videoSize!!, !exporting,
                        Modifier.fillMaxWidth().weight(1f), onChange = { trim = it })
                } else if (video && videoSize != null) {
                    LocalVideoPlayer(uri, trim.startMs, trim.endMs, Modifier.fillMaxWidth().height(260.dp),
                        edits = edits, videoSize = videoSize)
                } else if (!video && preview != null) {
                    Image(preview!!.asImageBitmap(), "Edited image preview", contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxWidth().height(260.dp).clip(SautiShape.Card).background(MaterialTheme.colorScheme.surfaceContainer))
                } else Box(Modifier.fillMaxWidth().height(220.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(if (video) "Trim" else "Crop", "Text", "Filters", "Adjust").forEach { label ->
                        FilterChip(tab == label, { tab = label }, enabled = !exporting, label = { Text(label) })
                    }
                }
                if (failure != null) Text(failure.orEmpty(), color = MaterialTheme.colorScheme.error)
                if (exporting) {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                    Text(if (video) "Preparing video… $progress%" else "Saving your edits…", style = MaterialTheme.typography.bodySmall)
                }
                Column((if (videoTrimming && videoSize != null) Modifier.heightIn(max = 100.dp) else Modifier.weight(1f))
                    .verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    when (tab) {
                        "Text" -> NativeCreatorTextControls(edits.overlay, !exporting) { edits = edits.copy(overlay = it) }
                        "Filters" -> {
                            Text("${NativePhotoFilter.entries.size} filters", style = MaterialTheme.typography.titleSmall)
                            NativePhotoFilter.entries.chunked(3).forEach { group ->
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    group.forEach { preset ->
                                        FilterChip(filter == preset, { filter = preset; edits = preset.applyTo(edits) }, enabled = !exporting,
                                            label = { Text(preset.label) }, modifier = Modifier.weight(1f))
                                    }
                                }
                            }
                        }
                        "Adjust" -> {
                            MediaEditorSlider("Brightness", edits.brightness, -.3f.. .3f, !exporting) { edits = edits.copy(brightness = it) }
                            MediaEditorSlider("Contrast", edits.contrast, .7f..1.3f, !exporting) { edits = edits.copy(contrast = it) }
                            MediaEditorSlider("Saturation", edits.saturation, 0f..1.5f, !exporting) { edits = edits.copy(saturation = it) }
                            MediaEditorSlider("Warmth", edits.warmth, -.2f.. .2f, !exporting) { edits = edits.copy(warmth = it) }
                        }
                        "Trim" -> if (duration > 0) {
                            Text("Drag the waveform to move your clip. Adjust the dots to change its length. Up to ${maximumVideoMs / 1000} seconds.", style = MaterialTheme.typography.bodySmall)
                        }
                        "Crop" -> {
                            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                listOf("Original" to null, "Square" to 1f, "Portrait" to .8f, "Story" to (9f / 16f), "Wide" to (16f / 9f)).forEach { (name, ratio) ->
                                    FilterChip(edits.aspect == ratio, { edits = edits.copy(aspect = ratio, zoom = 1f, panX = 0f, panY = 0f) }, enabled = !exporting, label = { Text(name) })
                                }
                            }
                            OutlinedButton(onClick = { edits = edits.copy(rotation = (edits.rotation + 90) % 360) }, enabled = !exporting) { Text("Rotate") }
                            MediaEditorSlider("Zoom / crop", edits.zoom, 1f..3f, !exporting) { edits = edits.copy(zoom = it) }
                            MediaEditorSlider("Horizontal framing", edits.panX, -1f..1f, !exporting) { edits = edits.copy(panX = it) }
                            MediaEditorSlider("Vertical framing", edits.panY, -1f..1f, !exporting) { edits = edits.copy(panY = it) }
                        }
                    }
                    TextButton(onClick = { edits = NativeImageEdits(); filter = NativePhotoFilter.Original }, enabled = !exporting) { Text("Reset all edits") }
                    Spacer(Modifier.height(12.dp))
                }
            }
        }
    }
}

@Composable
private fun MediaEditorSlider(label: String, value: Float, range: ClosedFloatingPointRange<Float>, enabled: Boolean, onChange: (Float) -> Unit) {
    Column {
        Text(label, style = MaterialTheme.typography.labelLarge)
        Slider(value = value.coerceIn(range.start, range.endInclusive), onValueChange = onChange, valueRange = range, enabled = enabled)
    }
}

private fun mediaTime(milliseconds: Long): String {
    val seconds = milliseconds / 1000L
    return "%d:%02d".format(seconds / 60L, seconds % 60L)
}

@Composable
internal fun NativeComposerMediaPreview(uri: Uri, video: Boolean, label: String, audio: com.sautilink.nativeapp.feature.music.NativeAudioSelection? = null) {
    if (uri == Uri.EMPTY) return
    val context = LocalContext.current
    var thumbnail by remember(uri) { mutableStateOf<Bitmap?>(null) }
    var playing by remember(uri) { mutableStateOf(false) }
    var failed by remember(uri) { mutableStateOf(false) }
    LaunchedEffect(uri, video) {
        try { thumbnail = if (video) localVideoThumbnail(context, uri) else loadEditableBitmap(context, uri, 1024) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { failed = true }
    }
    Box(Modifier.fillMaxWidth().height(210.dp).clip(SautiShape.Card).background(MaterialTheme.colorScheme.surfaceContainerHighest)
        .then(if (video) Modifier.clickable { playing = true } else Modifier), contentAlignment = Alignment.Center) {
        thumbnail?.let { Image(it.asImageBitmap(), "$label preview", Modifier.fillMaxSize(), contentScale = ContentScale.Fit) }
        if (video) FilledIconButton(onClick = { playing = true }) { Icon(Icons.Rounded.PlayArrow, "Play selected video") }
        else if (thumbnail == null && !failed) CircularProgressIndicator()
        if (failed) Text("Preview unavailable. You can remove or reselect this file.", Modifier.padding(12.dp), style = MaterialTheme.typography.bodySmall)
    }
    if (playing) Dialog(onDismissRequest = { playing = false }) {
        Surface(shape = SautiShape.Card) {
            Column(Modifier.fillMaxWidth().padding(12.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    IconButton(onClick = { playing = false }) { Icon(Icons.Rounded.Close, "Close video preview") }
                }
                LocalVideoPlayer(uri, modifier = Modifier.fillMaxWidth().height(340.dp), playOnOpen = true, audio = audio)
            }
        }
    }
}

@Composable
@androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])
internal fun LocalVideoPlayer(uri: Uri, startMs: Long = 0L, endMs: Long? = null, modifier: Modifier = Modifier, playOnOpen: Boolean = false,
    edits: NativeImageEdits = NativeImageEdits(), videoSize: NativeVideoSize? = null,
    audio: com.sautilink.nativeapp.feature.music.NativeAudioSelection? = null,
    playbackAllowed: Boolean = true, loop: Boolean = false, onPosition: ((Long) -> Unit)? = null) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val player = remember(context, uri) { ExoPlayer.Builder(context).build().apply { setVideoEffects(emptyList()) } }
    val soundtrack = remember(context, uri) { ExoPlayer.Builder(context).build() }
    val latestAudio by rememberUpdatedState(audio)
    val positionCallback by rememberUpdatedState(onPosition)
    LaunchedEffect(player, onPosition != null) {
        if (onPosition != null) while (true) { positionCallback?.invoke(player.currentPosition); delay(40) }
    }
    LaunchedEffect(audio, soundtrack, player) {
        player.volume = audio?.originalVolume ?: 1f
        if (audio == null) soundtrack.stop() else {
            if (soundtrack.currentMediaItem?.localConfiguration?.uri?.toString() != audio.previewUrl()) {
                soundtrack.setMediaItem(MediaItem.fromUri(audio.previewUrl())); soundtrack.prepare()
                soundtrack.repeatMode = Player.REPEAT_MODE_ONE
            }
            soundtrack.volume = audio.musicVolume
            soundtrack.seekTo(player.currentPosition % audio.durationMs)
            soundtrack.playWhenReady = player.isPlaying
        }
    }
    DisposableEffect(soundtrack, player) {
        val sync = object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (latestAudio != null) soundtrack.playWhenReady = isPlaying else soundtrack.pause()
            }
            override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) {
                latestAudio?.let { soundtrack.seekTo(newPosition.positionMs % it.durationMs) }
            }
        }
        player.addListener(sync)
        onDispose { player.removeListener(sync); soundtrack.release() }
    }
    var playing by remember(player) { mutableStateOf(false) }
    var pausePosition by remember(player) { mutableLongStateOf(0L) }
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) { playing = isPlaying; if (!isPlaying) pausePosition = player.currentPosition }
            override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) {
                if (!player.isPlaying) pausePosition = newPosition.positionMs
            }
        }
        player.addListener(listener)
        onDispose { player.removeListener(listener) }
    }
    val pausedFrame by produceState<Bitmap?>(null, uri, startMs, pausePosition, playing, videoSize) {
        if (!playing && videoSize != null) {
            try { value = creatorPausedFrame(context, uri, startMs + pausePosition, videoSize) }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { value = null }
        }
    }
    val editedFrame by produceState<Bitmap?>(null, pausedFrame, edits) {
        val frame = pausedFrame ?: return@produceState
        value = withContext(Dispatchers.IO) { renderEditedBitmap(frame, edits, context) }
    }
    LaunchedEffect(player, uri, startMs, endMs, playOnOpen) {
        player.pause()
        val builder = MediaItem.Builder().setUri(uri)
        if (endMs != null) builder.setClippingConfiguration(MediaItem.ClippingConfiguration.Builder()
            .setStartPositionMs(startMs).setEndPositionMs(endMs).build())
        player.setMediaItem(builder.build()); player.prepare()
        player.repeatMode = if (loop) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
        if (playOnOpen && playbackAllowed) player.play()
    }
    LaunchedEffect(player, playbackAllowed) {
        if (!playbackAllowed) player.pause() else if (playOnOpen) player.play()
    }
    LaunchedEffect(player, edits, videoSize) {
        if (videoSize != null) {
            delay(100)
            player.setVideoEffects(creatorVideoEffects(context, edits, videoSize))
            if (!player.isPlaying) player.seekTo(player.currentPosition)
        }
    }
    DisposableEffect(player, lifecycle) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) player.pause() }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); player.release() }
    }
    Box(modifier, contentAlignment = Alignment.Center) {
        AndroidView(factory = { PlayerView(it).apply { this.player = player; useController = videoSize == null } },
            update = { it.player = player }, modifier = Modifier.fillMaxSize())
        if (videoSize != null && !playing) editedFrame?.let { frame ->
            Image(frame.asImageBitmap(), "Edited video preview", Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color.Black), contentScale = ContentScale.Fit)
        }
        if (videoSize != null) FilledIconButton(onClick = { if (playing) player.pause() else player.play() }, enabled = playbackAllowed,
            modifier = Modifier.align(Alignment.BottomEnd).padding(8.dp)) {
            Icon(if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow, if (playing) "Pause edited video" else "Play edited video")
        }
    }
}
