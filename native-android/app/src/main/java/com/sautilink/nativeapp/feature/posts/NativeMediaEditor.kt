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
    var trim by remember(uri) { mutableStateOf(NativeMediaEditPolicy.Trim(0, 0)) }
    var failure by remember(uri) { mutableStateOf<String?>(null) }
    var exporting by remember { mutableStateOf(false) }
    var progress by remember { mutableIntStateOf(0) }
    var exportJob by remember { mutableStateOf<Job?>(null) }
    LaunchedEffect(uri) {
        try {
            if (video) { duration = localVideoDuration(context, uri); trim = NativeMediaEditPolicy.trim(duration, lengthMs = maximumVideoMs, maximumMs = maximumVideoMs) }
            else source = loadEditableBitmap(context, uri, 1024)
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) { failure = error.message ?: "This media could not be opened." }
    }
    val preview by produceState<Bitmap?>(null, source, edits) {
        val original = source ?: return@produceState
        delay(100)
        value = withContext(Dispatchers.IO) { renderEditedBitmap(original, edits) }
    }
    fun cancel() { exportJob?.cancel(); onExportActivity(false); onCancel() }
    Dialog(onDismissRequest = { cancel() }, properties = DialogProperties(usePlatformDefaultWidth = false,
        dismissOnClickOutside = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
            Column(Modifier.fillMaxSize().safeDrawingPadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { cancel() }) { Icon(Icons.Rounded.Close, "Cancel media editing") }
                    Text(if (video) "Trim video" else "Edit image", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                    TextButton(onClick = {
                        failure = null; exporting = true; progress = 0; onExportActivity(true)
                        exportJob = scope.launch {
                            var unusedExport: NativeEditedMedia? = null
                            try {
                                val result = if (video) exportTrimmedVideo(context, uri, duration, trim, maximumVideoMs) { progress = it }
                                else {
                                    val original = loadEditableBitmap(context, uri)
                                    try { exportEditedImage(context, original, edits, if (storyPhoto) 8L * 1024 * 1024 else NativePostMediaPolicy.MAX_IMAGE_BYTES) } finally { original.recycle() }
                                }
                                unusedExport = result
                                ensureActive()
                                onUse(result)
                                unusedExport = null
                            } catch (cancelled: CancellationException) { throw cancelled }
                            catch (error: Exception) { failure = error.message ?: "Could not prepare media. Try again." }
                            finally { unusedExport?.ownedFile?.delete(); exporting = false; onExportActivity(false) }
                        }
                    }, enabled = !exporting && if (video) duration > 0L else source != null) {
                        Icon(Icons.Rounded.Check, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Use media")
                    }
                }
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (video && duration > 0) {
                        LocalVideoPlayer(uri, trim.startMs, trim.endMs, Modifier.fillMaxWidth().height(280.dp))
                        Text("Select up to ${maximumVideoMs / 1000} seconds. Only your selected clip will upload.", style = MaterialTheme.typography.bodyMedium)
                        Text("${mediaTime(trim.startMs)} — ${mediaTime(trim.endMs)} · ${mediaTime(trim.durationMs)} selected",
                            style = MaterialTheme.typography.titleMedium)
                        if (duration > 1_000L) {
                            MediaEditorSlider("Start", trim.startMs.toFloat(), 0f..(duration - 1_000L).toFloat(), !exporting) {
                                trim = NativeMediaEditPolicy.trim(duration, it.toLong(), trim.durationMs, maximumVideoMs)
                            }
                            val endMinimum = trim.startMs + minOf(1_000L, duration)
                            val endMaximum = minOf(duration, trim.startMs + maximumVideoMs)
                            if (endMaximum > endMinimum) MediaEditorSlider("End", trim.endMs.toFloat(), endMinimum.toFloat()..endMaximum.toFloat(), !exporting) {
                                trim = trim.copy(endMs = it.toLong())
                            }
                        }
                    } else if (!video) {
                        val rendered = preview
                        if (rendered != null) Image(rendered.asImageBitmap(), "Edited image preview", contentScale = ContentScale.Fit,
                            modifier = Modifier.fillMaxWidth().height(280.dp).clip(SautiShape.Card).background(MaterialTheme.colorScheme.surfaceContainer))
                        else Box(Modifier.fillMaxWidth().height(240.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf("Original" to null, "Square" to 1f, "Portrait" to .8f, "Story" to (9f / 16f), "Wide" to (16f / 9f)).forEach { (label, ratio) ->
                                FilterChip(selected = edits.aspect == ratio, onClick = { edits = edits.copy(aspect = ratio, zoom = 1f, panX = 0f, panY = 0f) },
                                    enabled = !exporting, label = { Text(label) }, leadingIcon = { Icon(Icons.Rounded.Crop, null, Modifier.size(18.dp)) })
                            }
                        }
                        if (storyPhoto) {
                            Text("Photo filters", style = MaterialTheme.typography.titleSmall)
                            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                NativePhotoFilter.entries.forEach { preset ->
                                    FilterChip(selected = filter == preset, onClick = { filter = preset; edits = preset.applyTo(edits) },
                                        enabled = !exporting, label = { Text(preset.label) },
                                        leadingIcon = { Icon(Icons.Rounded.AutoAwesome, null, Modifier.size(17.dp)) })
                                }
                            }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = { edits = edits.copy(rotation = (edits.rotation + 90) % 360) }, enabled = !exporting) {
                                Icon(Icons.Rounded.RotateRight, null, Modifier.size(19.dp)); Spacer(Modifier.width(6.dp)); Text("Rotate")
                            }
                            TextButton(onClick = { edits = NativeImageEdits(); filter = NativePhotoFilter.Original }, enabled = !exporting) { Text("Reset") }
                        }
                        MediaEditorSlider("Zoom / crop", edits.zoom, 1f..3f, !exporting) { edits = edits.copy(zoom = it) }
                        MediaEditorSlider("Horizontal framing", edits.panX, -1f..1f, !exporting) { edits = edits.copy(panX = it) }
                        MediaEditorSlider("Vertical framing", edits.panY, -1f..1f, !exporting) { edits = edits.copy(panY = it) }
                        MediaEditorSlider("Brightness", edits.brightness, -0.3f..0.3f, !exporting) { edits = edits.copy(brightness = it) }
                        MediaEditorSlider("Contrast", edits.contrast, .7f..1.3f, !exporting) { edits = edits.copy(contrast = it) }
                    } else if (failure == null) CircularProgressIndicator()
                    if (failure != null) Text(failure.orEmpty(), color = MaterialTheme.colorScheme.error)
                    if (exporting) {
                        LinearProgressIndicator(Modifier.fillMaxWidth())
                        Text(if (video) "Preparing clip… $progress%" else "Saving your edits…", style = MaterialTheme.typography.bodySmall)
                    }
                    Text("Your original stays unchanged.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
internal fun NativeComposerMediaPreview(uri: Uri, video: Boolean, label: String) {
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
                LocalVideoPlayer(uri, modifier = Modifier.fillMaxWidth().height(340.dp), playOnOpen = true)
            }
        }
    }
}

@Composable
@androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])
private fun LocalVideoPlayer(uri: Uri, startMs: Long = 0L, endMs: Long? = null, modifier: Modifier = Modifier, playOnOpen: Boolean = false) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val player = remember(context, uri) { ExoPlayer.Builder(context).build() }
    LaunchedEffect(player, uri, startMs, endMs, playOnOpen) {
        player.pause()
        val builder = MediaItem.Builder().setUri(uri)
        if (endMs != null) builder.setClippingConfiguration(MediaItem.ClippingConfiguration.Builder()
            .setStartPositionMs(startMs).setEndPositionMs(endMs).build())
        player.setMediaItem(builder.build()); player.prepare()
        if (playOnOpen) player.play()
    }
    DisposableEffect(player, lifecycle) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) player.pause() }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); player.release() }
    }
    AndroidView(factory = { PlayerView(it).apply { this.player = player; useController = true } },
        update = { it.player = player }, modifier = modifier)
}
