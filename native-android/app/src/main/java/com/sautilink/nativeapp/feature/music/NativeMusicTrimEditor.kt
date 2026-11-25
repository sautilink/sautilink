package com.sautilink.nativeapp.feature.music

import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.sautilink.nativeapp.feature.posts.loadEditableBitmap
import com.sautilink.nativeapp.ui.theme.SautiHeaderFont
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

@Composable
internal fun NativeMusicTrimEditor(track: NativeMusicTrack, initial: NativeAudioSelection?,
    previewUri: Uri?, previewVideo: Boolean, loadPeaks: suspend () -> List<Float>,
    musicVolume: Float = 1f, originalVolume: Float = 1f,
    onBack: () -> Unit, onUse: (NativeAudioSelection) -> Unit) {
    val bounds = remember(track.id) { NativeAudioTrimBounds(track.windowStartMs, track.windowEndMs, track.maxClipMs) }
    var range by remember(track.id) { mutableStateOf(bounds.clip(initial?.startMs ?: track.windowStartMs,
        initial?.durationMs ?: minOf(30_000L, bounds.maximumDuration))) }
    val player = rememberPreviewPlayer()
    var playing by remember { mutableStateOf(false) }
    var scrubbing by remember { mutableStateOf(false) }
    var wantsPlayback by remember { mutableStateOf(true) }
    var playhead by remember { mutableLongStateOf(0L) }
    var peaks by remember(track.id) { mutableStateOf(emptyList<Float>()) }
    var loading by remember { mutableStateOf(true) }
    var waveformRetry by remember { mutableIntStateOf(0) }
    var waveformFailed by remember { mutableStateOf(false) }
    var playbackError by remember { mutableStateOf<String?>(null) }
    var durationMenu by remember { mutableStateOf(false) }
    val currentRange by rememberUpdatedState(range)
    LaunchedEffect(track.id, waveformRetry) {
        loading = true; waveformFailed = false
        try { peaks = loadPeaks(); waveformFailed = peaks.isEmpty() }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { waveformFailed = true }
        finally { loading = false }
    }
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) { playing = isPlaying }
            override fun onPlayerError(error: PlaybackException) { playbackError = "Audio couldn't play. Tap play to try again." }
        }
        player.addListener(listener)
        onDispose { player.removeListener(listener) }
    }
    LaunchedEffect(track.id, range, scrubbing, wantsPlayback) {
        if (scrubbing) { player.pause(); playhead = 0; return@LaunchedEffect }
        val selection = track.selection(range.startMs, range.durationMs)
        preparePostSoundtrack(player, track.id, selection.previewUrl())
        player.volume = musicVolume
        if (wantsPlayback) player.play() else player.pause()
    }
    LaunchedEffect(player) {
        while (true) { if (!scrubbing) playhead = player.currentPosition.coerceIn(0, currentRange.durationMs); delay(40) }
    }
    val scrub = { player.pause(); scrubbing = true; playbackError = null }
    val scrubEnd = { scrubbing = false; wantsPlayback = true; playbackError = null }
    val confirm = {
        player.pause()
        onUse(track.selection(range.startMs, range.durationMs).copy(
            musicVolume = musicVolume, originalVolume = originalVolume))
    }
    Dialog(onDismissRequest = { player.pause(); onBack() }, properties = DialogProperties(
        usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        val view = androidx.compose.ui.platform.LocalView.current
        DisposableEffect(view) {
            val window = (view.parent as? androidx.compose.ui.window.DialogWindowProvider)?.window
            window?.let { androidx.core.view.WindowCompat.getInsetsController(it, view).apply {
                isAppearanceLightStatusBars = false; isAppearanceLightNavigationBars = false
            } }
            onDispose { }
        }
        BoxWithConstraints(Modifier.fillMaxSize().background(Color.Black).systemBarsPadding()) {
            val editorHeight = maxOf(maxHeight, 680.dp)
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            BoxWithConstraints(Modifier.fillMaxWidth().height(editorHeight)) {
            val previewHeight = maxHeight * .70f
            Box(Modifier.fillMaxWidth().height(previewHeight).clip(RoundedCornerShape(bottomStart = 28.dp, bottomEnd = 28.dp))) {
                TrimMediaBackdrop(track.id, previewUri, previewVideo, playing, range, Modifier.fillMaxSize())
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = .20f),
                    Color.Transparent, Color.Black.copy(alpha = .52f)))))
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { player.pause(); onBack() }, modifier = Modifier.background(Color.Black.copy(alpha = .32f), CircleShape)) {
                    Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Change audio", tint = Color.White)
                }
                Spacer(Modifier.width(12.dp))
                Text("Trim audio", Modifier.weight(1f), color = Color.White, fontFamily = SautiHeaderFont,
                    style = MaterialTheme.typography.titleMedium)
                TextButton(onClick = confirm, colors = ButtonDefaults.textButtonColors(contentColor = Color.White)) { Text("Done") }
            }
            Column(Modifier.fillMaxWidth().offset(y = (previewHeight - 108.dp).coerceAtLeast(80.dp)),
                horizontalAlignment = Alignment.CenterHorizontally) {
                Box {
                    Text(audioTrimTime(range.durationMs), color = Color.Black, fontWeight = FontWeight.Bold,
                        fontSize = 14.sp, lineHeight = 18.sp, modifier = Modifier.clip(RoundedCornerShape(24.dp)).background(Color.White)
                            .clickable { durationMenu = true }.semantics { contentDescription = "Clip duration"; stateDescription = audioTrimTime(range.durationMs) }
                            .padding(horizontal = 12.dp, vertical = 6.dp))
                    DropdownMenu(durationMenu, { durationMenu = false }) {
                        (listOf(15_000L, 30_000L, 60_000L, 90_000L, 120_000L, 180_000L, bounds.maximumDuration)
                            .filter { it <= bounds.maximumDuration }.distinct().sorted()).forEach { length ->
                            DropdownMenuItem(text = { Text(audioTrimTime(length)) }, onClick = {
                                scrub(); range = bounds.clip(range.startMs, length); durationMenu = false; scrubEnd()
                            })
                        }
                    }
                }
                Spacer(Modifier.height(0.dp))
                NativeAudioTrimOverview(bounds, range, playhead, Modifier.fillMaxWidth(.67f).widthIn(max = 360.dp).padding(horizontal = 8.dp),
                    onChange = { range = it }, onScrub = scrub, onScrubEnd = scrubEnd)
            }
            NativeAudioWaveform(bounds, range, peaks, track.durationMs, playhead,
                Modifier.offset(y = previewHeight - 32.dp), onChange = { range = it }, onScrub = scrub, onScrubEnd = scrubEnd)
            Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(horizontal = 24.dp, vertical = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("${audioTrimTime(range.startMs)} — ${audioTrimTime(range.endMs)}", color = Color.White.copy(alpha = .75f),
                    style = MaterialTheme.typography.labelMedium)
                if (loading) LinearProgressIndicator(Modifier.width(64.dp).height(2.dp), color = Color.White)
                else if (waveformFailed) TextButton(onClick = { waveformRetry++ }) {
                    Text("Reload waveform", color = Color.White.copy(alpha = .7f))
                } else Text("Drag the waveform to choose your section", color = Color.White.copy(alpha = .55f), fontSize = 11.sp)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    FilledIconButton(onClick = {
                        playbackError = null
                        wantsPlayback = !playing
                        if (wantsPlayback) { preparePostSoundtrack(player, track.id, track.selection(range.startMs, range.durationMs).previewUrl()); player.play() }
                        else player.pause()
                    }, modifier = Modifier.size(48.dp), colors = IconButtonDefaults.filledIconButtonColors(containerColor = Color(0xFF242424), contentColor = Color.White)) {
                        Icon(if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow, if (playing) "Pause selected audio" else "Play selected audio")
                    }
                    Column(Modifier.weight(1f)) {
                        Text(track.title, color = Color.White, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(track.artist, color = Color.White.copy(alpha = .55f), style = MaterialTheme.typography.bodySmall,
                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Button(onClick = confirm, shape = RoundedCornerShape(24.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Color.Black)) { Text("Use audio") }
                }
                playbackError?.let { Text(it, color = Color(0xFFFFADAC), style = MaterialTheme.typography.bodySmall) }
            }
            }
            }
        }
    }
}

@Composable
@androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])
private fun TrimMediaBackdrop(trackId: String, uri: Uri?, video: Boolean, playing: Boolean, restartKey: NativeAudioTrimRange, modifier: Modifier) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var bitmap by remember(uri) { mutableStateOf<Bitmap?>(null) }
    if (uri != null && !video) {
        LaunchedEffect(uri) {
            try { bitmap = loadEditableBitmap(context, uri, 1440) }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { }
        }
        bitmap?.let { Image(it.asImageBitmap(), "Selected photo preview", modifier, contentScale = ContentScale.Crop) }
            ?: NativeMusicCover(trackId, modifier)
    } else if (uri != null) {
        val player = remember(uri) { ExoPlayer.Builder(context).build().apply {
            volume = 0f; repeatMode = Player.REPEAT_MODE_ONE; setMediaItem(MediaItem.fromUri(uri)); prepare()
        } }
        LaunchedEffect(player, restartKey) { player.seekTo(0) }
        LaunchedEffect(player, playing) { player.playWhenReady = playing }
        DisposableEffect(player, lifecycle) {
            val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) player.pause() }
            lifecycle.addObserver(observer)
            onDispose { lifecycle.removeObserver(observer); player.release() }
        }
        AndroidView(factory = { PlayerView(it).apply { this.player = player; useController = false; resizeMode = AspectRatioFrameLayout.RESIZE_MODE_ZOOM } },
            update = { it.player = player }, onRelease = { it.player = null }, modifier = modifier)
    } else NativeMusicCover(trackId, modifier)
}
